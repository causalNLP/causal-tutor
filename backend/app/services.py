import base64
import binascii
import io
import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import UploadFile
from openai import APIStatusError, Timeout
from pydantic import ValidationError
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv
from .models import CausalGraph, CausalQueryResponse, DatasetSchema, ExamResponse, ExamQuestion
from .llm_provider import (
    LLMProvider,
    build_async_client,
    env_key_for,
    model_spec,
    pdf_limits,
    resolve_model,
)

# Load environment variables (used only as a local-dev convenience; the prefilled
# value lets the dev populate the UI input without retyping their key on every restart).
load_dotenv()

logger = logging.getLogger(__name__)

# Paper analysis can take minutes for long PDFs on reasoning models. Retrying a
# timed-out multi-minute request rarely helps, so allow a single SDK retry
# (still covers 429s and transient 5xx).
ANALYSIS_TIMEOUT = Timeout(480.0, connect=15.0)
ANALYSIS_MAX_RETRIES = 1
# For streaming chat the read timeout is the max gap between chunks.
CHAT_TIMEOUT = Timeout(300.0, connect=15.0)

# Tokens kept free for the system prompt, tool schema and the model's answer.
ANALYSIS_RESERVED_TOKENS = 40_000
CHAT_RESERVED_TOKENS = 24_000


def _get_client(
    provider: LLMProvider,
    api_key: Optional[str] = None,
    timeout: Optional[Timeout] = None,
    max_retries: Optional[int] = None,
):
    """Build a per-request OpenAI client. Endpoints in main.py reject requests
    that don't supply an API key (`_require_api_key`) before reaching this function,
    so `api_key` is normally non-empty here. Falls back to the env value if present
    purely as a safety net for dev tooling that bypasses the API layer."""
    effective = api_key or env_key_for(provider)
    if not effective:
        raise RuntimeError(
            "LLM API key not provided. The endpoint should reject this earlier; "
            "see main.py:_require_api_key."
        )
    return build_async_client(provider, effective, timeout=timeout, max_retries=max_retries)


class PdfError(ValueError):
    """The uploaded file can't be used as a paper. The message is user-facing."""


class AnalysisError(RuntimeError):
    """The model answered, but not with a usable analysis. The message is user-facing."""


async def generate_single_question(
    method_name: str,
    provider: LLMProvider = "openai",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ExamQuestion:
    prompt = f"""Generate exactly 1 high-quality multiple-choice exam question to test a student's understanding of the causal method: {method_name}.
    
    Focus on:
    1. Identification assumptions.
    2. Threats to validity.
    3. Interpretation of results.
    
    Return a JSON object with the question details."""
    
    tools = [
        {
            "type": "function",
            "function": {
                "name": "provide_exam_question",
                "description": "Generates a single exam question.",
                "parameters": ExamQuestion.model_json_schema()
            }
        }
    ]
    
    completion = await _get_client(provider, api_key).chat.completions.create(
        model=resolve_model(provider, model, fallback_openai_model="gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        tools=tools,
        tool_choice={"type": "function", "function": {"name": "provide_exam_question"}}
    )

    tool_call = completion.choices[0].message.tool_calls[0]
    return ExamQuestion(**json.loads(tool_call.function.arguments))

async def generate_exam_questions(
    method_name: str,
    num_questions: int = 15,
    provider: LLMProvider = "openai",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ExamResponse:
    # Use asyncio.gather to generate questions in parallel
    import asyncio

    # We generate num_questions (default 15) in parallel
    tasks = [
        generate_single_question(method_name, provider=provider, model=model, api_key=api_key)
        for _ in range(num_questions)
    ]
    questions = await asyncio.gather(*tasks)

    return ExamResponse(
        method_name=method_name,
        questions=list(questions)
    )

async def extract_csv_schema(file: UploadFile) -> DatasetSchema:
    contents = await file.read()
    # Read first 5 rows to get schema and sample
    df = pd.read_csv(io.BytesIO(contents), nrows=5)
    
    headers = df.columns.tolist()
    types = [str(t) for t in df.dtypes.tolist()]
    # Convert samples to dict, handling NaNs
    sample_rows = df.where(pd.notnull(df), None).to_dict(orient='records')
    
    return DatasetSchema(
        headers=headers,
        types=types,
        sample_rows=sample_rows
    )

async def extract_text_from_pdf(file: UploadFile) -> str:
    doc = await run_in_threadpool(load_pdf, await file.read(), file.filename or "paper.pdf")
    return doc.full_text


# ── PDF handling ──────────────────────────────────────────────────────────

_PAGE_MARKER = re.compile(r"^--- PAGE (\d+) ---\n", re.MULTILINE)
_MAX_PAGES = 5000


@dataclass
class PaperDocument:
    filename: str
    page_count: int
    # Extracted text per page (index 0 = page 1); empty string when a page has none.
    pages: List[str]
    pdf_base64: Optional[str] = None
    # Encrypted PDFs can sometimes be read locally (empty user password) but are
    # rejected by provider PDF parsers, so they always go the text route.
    encrypted: bool = False
    # False for free text (scenarios), which gets no page markers.
    paged: bool = True

    @classmethod
    def from_text(cls, text: str, filename: str) -> "PaperDocument":
        return cls(filename=filename, page_count=1, pages=[text], paged=False)

    @property
    def full_text(self) -> str:
        if not self.paged:
            return "".join(self.pages)
        return _join_pages(self.pages, len(self.pages))

    @property
    def has_text(self) -> bool:
        return any(p.strip() for p in self.pages)


def _join_pages(pages: List[str], upto: int) -> str:
    return "\n".join(
        f"--- PAGE {i + 1} ---\n{text}" for i, text in enumerate(pages[:upto]) if text
    )


def _open_pdf(contents: bytes) -> Tuple[PdfReader, bool]:
    if not contents:
        raise PdfError("The uploaded file is empty.")
    # PDF readers tolerate a little leading junk before the header, nothing more.
    if b"%PDF-" not in contents[:1024]:
        raise PdfError("The uploaded file is not a valid PDF.")
    try:
        reader = PdfReader(io.BytesIO(contents))
        encrypted = reader.is_encrypted
        # Owner-password-only PDFs open with an empty user password.
        if encrypted and not reader.decrypt(""):
            raise PdfError("This PDF is password-protected. Remove the password and upload it again.")
        page_count = len(reader.pages)
    except PdfError:
        raise
    except Exception as e:  # pypdf raises a wide range of errors on corrupt files
        logger.warning("Failed to open PDF: %s", e)
        raise PdfError("This PDF could not be read; it may be corrupted or incomplete.") from e
    if page_count == 0:
        raise PdfError("This PDF has no pages.")
    return reader, encrypted


def load_pdf(contents: bytes, filename: str) -> PaperDocument:
    """Validate an uploaded PDF and extract its text page by page. CPU-bound."""
    reader, encrypted = _open_pdf(contents)
    pages: List[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception as e:
            # One malformed page shouldn't sink the whole paper.
            logger.warning("Text extraction failed for a page of %s: %s", filename, e)
            pages.append("")
    return PaperDocument(
        filename=filename,
        page_count=len(pages),
        pages=pages,
        pdf_base64=base64.b64encode(contents).decode("ascii"),
        encrypted=encrypted,
    )


def document_from_chat(
    pdf_base64: Optional[str], pdf_filename: Optional[str], paper_text: str
) -> Optional[PaperDocument]:
    """Rebuild a PaperDocument for a chat turn from what the browser sends back.

    Re-extracting text on every turn would be slow for long papers, so the text
    comes from `paper_text` (the extraction returned by /analyze) and the PDF is
    only opened to validate it and count pages. Returns None for scenarios.
    """
    if not pdf_base64:
        if not paper_text.strip():
            return None
        if not _PAGE_MARKER.search(paper_text):
            return PaperDocument.from_text(paper_text, pdf_filename or "scenario")
    pages = _split_pages(paper_text) if paper_text else []
    if not pdf_base64:
        return PaperDocument(filename=pdf_filename or "paper", page_count=len(pages), pages=pages)
    try:
        contents = base64.b64decode(pdf_base64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise PdfError("The attached PDF data is corrupted. Re-upload the paper.") from e
    reader, encrypted = _open_pdf(contents)
    page_count = len(reader.pages)
    # Pad so a page index always maps to the same page number.
    pages += [""] * (page_count - len(pages))
    return PaperDocument(
        filename=pdf_filename or "paper.pdf",
        page_count=page_count,
        pages=pages,
        pdf_base64=pdf_base64,
        encrypted=encrypted,
    )


def _split_pages(text: str) -> List[str]:
    """Inverse of PaperDocument.full_text; unmarked text is treated as one page."""
    matches = list(_PAGE_MARKER.finditer(text))
    if not matches:
        return [text] if text.strip() else []
    # The text comes from the browser; don't trust page numbers to size the list.
    page_total = min(max(int(m.group(1)) for m in matches), _MAX_PAGES)
    pages: List[str] = [""] * page_total
    for m, nxt in zip(matches, matches[1:] + [None]):
        number = int(m.group(1))
        if 1 <= number <= page_total:
            end = nxt.start() if nxt else len(text)
            pages[number - 1] = text[m.end():end].rstrip("\n")
    return pages


@lru_cache(maxsize=1)
def _tokenizer():
    try:
        import tiktoken

        return tiktoken.get_encoding("o200k_base")
    except Exception as e:  # e.g. the encoding file can't be downloaded offline
        logger.warning("tiktoken unavailable, using a character-based token estimate: %s", e)
        return None


def estimate_tokens(text: str) -> int:
    enc = _tokenizer()
    if enc is None:
        return len(text) // 3  # deliberately pessimistic for non-OpenAI tokenizers
    # Other providers' tokenizers differ; pad the estimate by 15%.
    return int(len(enc.encode(text, disallowed_special=())) * 1.15)


@dataclass
class PaperInput:
    """How a paper is sent to a particular model."""

    mode: str  # "pdf" or "text"
    text: str = ""  # extracted text when mode == "text"
    warnings: List[str] = field(default_factory=list)


def plan_paper_input(
    doc: PaperDocument,
    provider: LLMProvider,
    model: str,
    reserved_tokens: int,
    force_text_reason: Optional[str] = None,
) -> PaperInput:
    """Decide between sending the original PDF and extracted text, within the
    model's documented PDF limits and input-token budget. Never truncates
    without recording a warning."""
    spec = model_spec(provider, model)
    limits = pdf_limits(provider, model)
    budget = spec.input_tokens - reserved_tokens
    page_tokens = [estimate_tokens(p) for p in doc.pages]
    text_tokens = sum(page_tokens)
    warnings: List[str] = []

    if force_text_reason:
        fallback_reason = force_text_reason
    elif not doc.pdf_base64:
        fallback_reason = None  # nothing to send but text
    elif not spec.pdf_input:
        fallback_reason = f"{spec.label} can't read PDF files directly"
    elif doc.encrypted:
        fallback_reason = "the PDF is encrypted, which model providers don't accept"
    elif len(doc.pdf_base64) > limits.max_base64_bytes:
        fallback_reason = (
            f"the file is larger than the {limits.max_base64_bytes // (1024 * 1024)} MB "
            f"PDF limit for {spec.label}"
        )
    elif limits.max_pages and doc.page_count > limits.max_pages:
        fallback_reason = (
            f"it has {doc.page_count} pages and {spec.label} accepts at most "
            f"{limits.max_pages} PDF pages"
        )
    elif text_tokens + doc.page_count * limits.page_overhead_tokens > budget:
        fallback_reason = f"the PDF (text plus page images) would exceed {spec.label}'s context window"
    else:
        return PaperInput(mode="pdf")

    if fallback_reason:
        warnings.append(
            f"The paper was sent as extracted text instead of the original PDF because "
            f"{fallback_reason}. Figures, tables and equations that are only images "
            f"were not visible to the model."
        )

    if not doc.has_text:
        if not doc.pdf_base64:
            raise PdfError("There is no paper text to work with.")
        if fallback_reason:
            raise PdfError(
                f"No text could be extracted from this PDF (it may be a scanned document), "
                f"and it can't be sent as a PDF because {fallback_reason}. "
                f"Try a model with PDF support, or a smaller or text-based PDF."
            )
        raise PdfError("No text could be extracted from this PDF.")

    if text_tokens <= budget:
        return PaperInput(mode="text", text=doc.full_text, warnings=warnings)

    # Too long even as text: keep whole pages from the start, and say so.
    used, kept = 0, 0
    for tokens in page_tokens:
        if used + tokens > budget:
            break
        used += tokens
        kept += 1
    if kept == 0:
        raise PdfError(f"This paper is too long for {spec.label}. Choose a model with a larger context window.")
    warnings.append(
        f"The paper is too long for {spec.label}'s context window, so only pages 1–{kept} "
        f"of {doc.page_count} were used. Pick a model with a larger context window to "
        f"cover the whole paper."
    )
    return PaperInput(mode="text", text=_join_pages(doc.pages, kept), warnings=warnings)


def _pdf_request_options(provider: LLMProvider) -> dict:
    # Without this, OpenRouter silently falls back to paid Mistral OCR when a route
    # lacks native file support. "native" makes it fail instead, and we retry with
    # our own extracted text.
    if provider == "openrouter":
        return {"extra_body": {"plugins": [{"id": "file-parser", "pdf": {"engine": "native"}}]}}
    return {}


# Statuses that mean "this request (probably the PDF) was rejected", as opposed to
# auth, rate-limit or server errors, which a text retry wouldn't fix.
_PDF_REJECTION_STATUSES = {400, 413, 415, 422}


def _is_pdf_rejection(exc: Exception) -> bool:
    return isinstance(exc, APIStatusError) and exc.status_code in _PDF_REJECTION_STATUSES


def provider_error_message(exc: APIStatusError) -> str:
    # The SDK unwraps `{"error": {...}}`, so `body` is the error object itself.
    body = exc.body
    if isinstance(body, dict) and body.get("message"):
        return str(body["message"])[:300]
    return str(exc.message)[:300]

SYSTEM_PROMPT = """You are an expert Causal Inference Scientist and Tutor. Your goal is to analyze research papers or scenarios to explain their causal methodology to graduate students.

You must go beyond simple summarization. You must CRITIQUE the study design and evaluate ALTERNATIVES.

Focus on:
1. **Core Causal Query**: What is $D \rightarrow Y$?
2. **Method Identification**: (DiD, IV, RDD, Propensity Score, etc.)
3. **Assumptions & Validity**: 
   - Explicitly list assumptions (e.g., Parallel Trends, Exclusion Restriction).
   - **CRITIQUE**: Does the paper convince you these hold? Are there unobserved confounders? (e.g., "The authors control for X, but Z is likely an unobserved confounder.")
4. **Alternative Methods**: What other methods *could* have been used? Why is the chosen one better (or worse)?
5. **Causal Graph (DAG)**:
   - Fill `causal_graph` with nodes and directed edges.
   - Mark unobserved/latent variables with `latent: true`, and biasing paths (e.g. confounding) with `biasing: true`.
   - Ensure the DAG represents the *identification strategy* (e.g., in IV, show Z -> D -> Y and U -> D, U -> Y).

6. **Educational Questions**: Socratic questions to test the student's understanding of the *design*.

CITATION RULES:
- If analyzing a PDF, extract exact quotes and page numbers for every claim.
- If analyzing a user-provided scenario (no page numbers), use page=0 and paraphrase.

Return the output in the specified JSON structure.
"""

_MERMAID_RESERVED = {
    "end", "graph", "flowchart", "subgraph", "style", "class", "classdef",
    "click", "linkstyle", "default", "direction", "call", "href",
}


def causal_graph_to_mermaid(graph: CausalGraph) -> str:
    """Render a CausalGraph as Mermaid that always parses, whatever the labels."""
    safe_ids: dict = {}

    def safe_id(raw: str) -> str:
        if raw not in safe_ids:
            base = re.sub(r"[^A-Za-z0-9_]", "_", raw.strip()) or "node"
            if not base[0].isascii() or not base[0].isalpha() or base.lower() in _MERMAID_RESERVED:
                base = f"n_{base}"
            candidate, i = base, 2
            while candidate in safe_ids.values():
                candidate, i = f"{base}_{i}", i + 1
            safe_ids[raw] = candidate
        return safe_ids[raw]

    def label(text: str) -> str:
        # Inside a quoted label only `"` is special; Mermaid's entity form is `#quot;`.
        return " ".join(text.split()).replace('"', "#quot;") or " "

    lines = ["graph LR"]
    latent = set()
    declared = set()
    for node in graph.nodes:
        if node.id in declared:
            continue
        declared.add(node.id)
        nid = safe_id(node.id)
        if node.latent:
            latent.add(node.id)
            lines.append(f'    {nid}(("{label(node.label)}"))')
        else:
            lines.append(f'    {nid}["{label(node.label)}"]')
    for edge in graph.edges:
        for end in (edge.source, edge.target):
            # Edges may reference ids the model forgot to declare.
            if end not in declared:
                declared.add(end)
                lines.append(f'    {safe_id(end)}["{label(end)}"]')
        arrow = "-.->" if edge.biasing or edge.source in latent else "-->"
        lines.append(f"    {safe_id(edge.source)} {arrow} {safe_id(edge.target)}")
    return "\n".join(lines)


def _pdf_file_part(pdf_base64: str, filename: str) -> dict:
    """Chat-completions file content part; supported by OpenAI and OpenRouter."""
    return {
        "type": "file",
        "file": {
            "filename": filename,
            "file_data": f"data:application/pdf;base64,{pdf_base64}",
        },
    }


@dataclass
class AnalysisResult:
    analysis: CausalQueryResponse
    # User-facing notes about how the paper was processed (text fallback, truncation).
    warnings: List[str] = field(default_factory=list)


async def analyze_paper(
    text: str,
    filename: str,
    provider: LLMProvider = "openai",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    document: Optional[PaperDocument] = None,
) -> AnalysisResult:
    """Analyze a paper. Pass `document` for PDF uploads (sent natively when the
    model supports it, as extracted text otherwise) or `text` for scenarios."""
    tools = [
        {
            "type": "function",
            "function": {
                "name": "provide_causal_analysis",
                "description": "Extracts causal methodology, critique, alternatives, and generates a DAG.",
                "parameters": CausalQueryResponse.model_json_schema()
            }
        }
    ]

    client = _get_client(provider, api_key, timeout=ANALYSIS_TIMEOUT, max_retries=ANALYSIS_MAX_RETRIES)
    resolved_model = resolve_model(provider, model, fallback_openai_model="gpt-4o")

    if document is None:
        document = PaperDocument.from_text(text, filename)
    plan = plan_paper_input(document, provider, resolved_model, ANALYSIS_RESERVED_TOKENS)

    try:
        analysis = await _run_analysis(client, resolved_model, tools, filename, document, plan, provider)
    except APIStatusError as e:
        if plan.mode != "pdf" or not _is_pdf_rejection(e):
            raise
        logger.warning("%s rejected the PDF for %s, retrying with text: %s", resolved_model, filename, e)
        plan = plan_paper_input(
            document,
            provider,
            resolved_model,
            ANALYSIS_RESERVED_TOKENS,
            force_text_reason=f"the provider rejected the PDF ({provider_error_message(e)})",
        )
        analysis = await _run_analysis(client, resolved_model, tools, filename, document, plan, provider)
    return AnalysisResult(analysis=analysis, warnings=plan.warnings)


def _paper_user_content(filename: str, document: PaperDocument, plan: PaperInput):
    if plan.mode == "pdf":
        return [
            {"type": "text", "text": f"Analyze the attached paper: {filename}"},
            _pdf_file_part(document.pdf_base64, filename),
        ]
    note = ""
    if plan.warnings:
        note = "\n\nNote on the input: " + " ".join(plan.warnings)
    return f"Analyze the following text/paper: {filename}{note}\n\n{plan.text}"


async def _run_analysis(client, model: str, tools, filename: str, document: PaperDocument, plan: PaperInput, provider: LLMProvider) -> CausalQueryResponse:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _paper_user_content(filename, document, plan)},
    ]
    extra = _pdf_request_options(provider) if plan.mode == "pdf" else {}

    # Models occasionally emit malformed tool-call JSON (e.g. stray strings inside
    # arrays, missing required fields). Retry once: every attempt re-sends the
    # whole paper, which is slow and costly for long PDFs.
    max_attempts = 2
    last_error: Optional[str] = None
    for _ in range(max_attempts):
        completion = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "provide_causal_analysis"}},
            **extra,
        )
        if not completion.choices:
            last_error = "the provider returned an empty response"
            continue
        choice = completion.choices[0]
        if choice.finish_reason == "length":
            # Retrying with the same limits would get cut off again.
            raise AnalysisError(
                "The model ran out of output tokens before finishing the analysis. "
                "Try again or pick a different model."
            )
        tool_calls = choice.message.tool_calls
        if not tool_calls:
            last_error = "the model did not return a structured analysis"
            continue
        try:
            analysis = CausalQueryResponse(**json.loads(tool_calls[0].function.arguments))
            analysis.causal_graph_mermaid = causal_graph_to_mermaid(analysis.causal_graph)
            return analysis
        except (json.JSONDecodeError, ValidationError, TypeError) as e:
            last_error = f"the model returned malformed output ({str(e)[:200]})"

    raise AnalysisError(
        f"Analysis failed after {max_attempts} attempts: {last_error}. "
        f"Try again or pick a different model."
    )


async def chat_with_paper(
    paper_text: str,
    analysis_context: Optional[str],
    messages: List[dict],
    model: Optional[str] = None,
    provider: LLMProvider = "openai",
    api_key: Optional[str] = None,
    pdf_base64: Optional[str] = None,
    pdf_filename: Optional[str] = None,
):
    resolved_model = resolve_model(provider, model, fallback_openai_model="gpt-4o")
    client = _get_client(provider, api_key, timeout=CHAT_TIMEOUT)

    # Drop empty turns (e.g. the analysis-report bubble): several providers reject
    # messages with empty content.
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str) and m["content"].strip()
    ]

    document = await run_in_threadpool(document_from_chat, pdf_base64, pdf_filename, paper_text)
    reserved = CHAT_RESERVED_TOKENS + estimate_tokens((analysis_context or "") + "".join(m["content"] for m in history))
    plan = plan_paper_input(document, provider, resolved_model, reserved) if document else PaperInput(mode="text")

    async def create(plan: PaperInput):
        return await client.chat.completions.create(
            model=resolved_model,
            messages=_chat_messages(analysis_context, history, document, plan),
            stream=True,
            **(_pdf_request_options(provider) if plan.mode == "pdf" else {}),
        )

    try:
        return await create(plan)
    except APIStatusError as e:
        if plan.mode != "pdf" or not _is_pdf_rejection(e):
            raise
        logger.warning("%s rejected the PDF in chat, retrying with text: %s", resolved_model, e)
        plan = plan_paper_input(
            document, provider, resolved_model, reserved,
            force_text_reason=f"the provider rejected the PDF ({provider_error_message(e)})",
        )
        return await create(plan)


def _chat_messages(
    analysis_context: Optional[str],
    history: List[dict],
    document: Optional[PaperDocument],
    plan: PaperInput,
) -> List[dict]:
    if document is None:
        reference_block = "No paper text is available; rely on the analysis context above."
    elif plan.mode == "pdf":
        reference_block = "The research paper is attached as a PDF in the first user message."
    else:
        reference_block = f"Reference Context:\n{plan.text}"
        if plan.warnings:
            reference_block += (
                "\n\nNote on the reference context: " + " ".join(plan.warnings)
                + " If the student asks about content you can't see, tell them so instead of guessing."
            )
    system_prompt_content = f"""You are a helpful and Socratic Causal Tutor. Your goal is to help students understand the causal inference methods used in the provided research paper or scenario.

Current Analysis Context:
{analysis_context if analysis_context else "No prior analysis available."}

---

{reference_block}

---

Instructions for Tutor:
1. **Be Socratic**: Don't just give answers. Ask "Why do you think..." or "What would happen if...".
2. **Focus on Identification**: When asked about results, first explain *how* they identified the effect.
3. **Math & Intuition**: Use LaTeX for math (e.g., $Y_{{it}} = \\alpha + \\beta D_{{it}} + \\epsilon_{{it}}$). Explain the intuition *before* the math.
4. **Critique**: Encourage the student to find flaws. "Do you believe the exclusion restriction holds here?"
5. **DAGs**: Refer to the Causal Graph in your explanations.
"""

    formatted_messages = [
        {"role": "system", "content": system_prompt_content}
    ]

    if plan.mode == "pdf":
        formatted_messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": "Here is the research paper we will discuss."},
                _pdf_file_part(document.pdf_base64, document.filename),
            ],
        })

    formatted_messages.extend(history)
    return formatted_messages
