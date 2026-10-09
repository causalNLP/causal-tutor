import os
from typing import Dict, List, NoReturn, Optional, Union

import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError as OpenAIAuthError,
    RateLimitError,
)
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from .curriculum_data import CURRICULUM_METHODS
from .primer_data import PRIMER_SECTIONS
from .dag_models import (
    CausalAnalysisRequest,
    CausalAnalysisResponse,
    DAGAnalyzeRequest,
    DAGAnalyzeResponse,
    DAGChatRequest,
    DAGEdge,
    DAGGraph,
    DAGNode,
    DAGValidateRequest,
    DAGValidateResponse,
    DSeparationRequest,
    DSeparationResponse,
    PathsRequest,
    PathsResponse,
)
from .dag_services import (
    analyze_dag_with_gpt,
    causal_analysis,
    chat_about_dag,
    check_d_separation,
    find_all_paths,
    validate_dag,
)
from .llm_provider import (
    DEFAULT_PROVIDER,
    LLMProvider,
    LLMRequestContext,
    build_async_client,
    default_model_for,
    model_options,
    normalize_provider,
    provider_label,
)
from .models import APIAnalysisResponse, AnalyzeTextRequest, ExamResponse
from .sandbox_models import (
    DatasetPreview,
    EstimateRequest,
    EstimateResponse,
    InterpretRequest,
    QueriesResponse,
)
from .sandbox_services import estimate as sandbox_estimate
from .sandbox_services import interpret_result, load_queries, preview_dataset
from .scm_evaluator import (
    abduce_noise,
    apply_intervention,
    build_computation_trace,
    chat_about_scm,
    compute_counterfactual,
    compute_histogram,
    compute_kde,
    compute_stats,
    compute_treatment_response,
    evaluate_scm,
)
from .scm_model import HardIntervention, SCMSchema, SoftIntervention, TraceLine
from .services import (
    AnalysisError,
    PdfError,
    analyze_paper,
    chat_with_paper,
    extract_csv_schema,
    extract_text_from_pdf,
    generate_exam_questions,
    load_pdf,
    provider_error_message,
)

load_dotenv()

app = FastAPI(title="Causal Tutor API", description="AI-powered causal inference tutor")

# CORS for frontend.
# Set ALLOWED_ORIGINS to a comma-separated list of allowed origins in production
# (e.g. "https://causal-tutor.vercel.app"). Defaults to "*" for local dev.
_origins_env = os.getenv("ALLOWED_ORIGINS", "*").strip()
_origins = (
    ["*"]
    if _origins_env == "*"
    else [o.strip() for o in _origins_env.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # When origins is "*", browsers reject responses that also set
    # Access-Control-Allow-Credentials: true - so disable credentials in that case.
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _missing_key_msg(provider: LLMProvider) -> str:
    return (
        f"{provider_label(provider)} API key not set. Open the API key settings (key icon, bottom-left of the "
        "sidebar) and save your key."
    )


def _invalid_key_msg(provider: LLMProvider) -> str:
    return (
        f"Invalid {provider_label(provider)} API key. Open the API key settings (key icon, bottom-left) and "
        "update your key."
    )


def _raise_auth_failure(provider: LLMProvider):
    raise HTTPException(status_code=401, detail=_invalid_key_msg(provider))


def _is_auth_error(exc: Exception) -> bool:
    if isinstance(exc, OpenAIAuthError):
        return True
    if isinstance(exc, APIStatusError) and exc.status_code in {401, 403}:
        return True
    status = getattr(exc, "status_code", None)
    return status in {401, 403}


def _raise_llm_failure(exc: Exception, llm: LLMRequestContext) -> NoReturn:
    """Turn paper-processing and LLM provider errors into actionable HTTP errors."""
    label = provider_label(llm.provider)
    if isinstance(exc, PdfError):
        raise HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, AnalysisError):
        raise HTTPException(status_code=502, detail=str(exc))
    if _is_auth_error(exc):
        _raise_auth_failure(llm.provider)
    if isinstance(exc, RateLimitError):
        raise HTTPException(
            status_code=429,
            detail=f"{label} rate limit or quota reached. Wait a moment and try again, or check your plan and credits.",
        )
    if isinstance(exc, APITimeoutError):
        raise HTTPException(
            status_code=504,
            detail=f"{label} took too long to respond. Long papers can take several minutes; try again or pick a faster model.",
        )
    if isinstance(exc, APIConnectionError):
        raise HTTPException(status_code=502, detail=f"Couldn't reach {label}. Check your connection and try again.")
    if isinstance(exc, APIStatusError):
        message = provider_error_message(exc)
        if exc.status_code == 402:
            raise HTTPException(status_code=402, detail=f"{label} reports insufficient credits: {message}")
        if exc.status_code == 404:
            raise HTTPException(
                status_code=400,
                detail=f"The model '{llm.model or 'default'}' isn't available on {label}. Pick another model in the API key settings. ({message})",
            )
        if exc.status_code < 500:
            raise HTTPException(status_code=400, detail=f"{label} rejected the request: {message}")
        raise HTTPException(status_code=502, detail=f"{label} had a server error. Try again in a moment. ({message})")
    import traceback

    traceback.print_exc()
    raise HTTPException(status_code=500, detail=str(exc))


# Uploaded papers are held in memory and re-sent with every chat turn.
MAX_PDF_UPLOAD_BYTES = int(os.getenv("MAX_PDF_UPLOAD_MB", "50")) * 1024 * 1024


async def _read_pdf_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    contents = await file.read(MAX_PDF_UPLOAD_BYTES + 1)
    if len(contents) > MAX_PDF_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"This PDF is larger than the {MAX_PDF_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
        )
    return contents


def _stream_text(stream) -> StreamingResponse:
    async def generate():
        try:
            async for chunk in stream:
                # Some providers send keep-alive/usage chunks without choices.
                if not chunk.choices:
                    continue
                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except Exception as e:
            # Headers are already sent, so the error can only go in the body.
            import traceback

            traceback.print_exc()
            yield f"\n\n**Error:** the response was interrupted ({str(e)[:200]}). Please try again."

    return StreamingResponse(generate(), media_type="text/event-stream")


def require_llm_context(
    x_llm_provider: Optional[str] = Header(None, alias="X-LLM-Provider"),
    x_llm_model: Optional[str] = Header(None, alias="X-LLM-Model"),
    x_openai_key: Optional[str] = Header(None, alias="X-OpenAI-Key"),
    x_openrouter_key: Optional[str] = Header(None, alias="X-OpenRouter-Key"),
) -> LLMRequestContext:
    provider = normalize_provider(x_llm_provider)
    raw_key = x_openrouter_key if provider == "openrouter" else x_openai_key
    if not raw_key or not raw_key.strip():
        raise HTTPException(status_code=401, detail=_missing_key_msg(provider))
    model = (x_llm_model or "").strip() or None
    return LLMRequestContext(provider=provider, api_key=raw_key.strip(), model=model)


@app.get("/")
def read_root():
    return {"message": "Causal Tutor API is running"}


@app.get("/curriculum-methods")
async def get_curriculum_methods():
    return CURRICULUM_METHODS


@app.get("/primer-sections")
async def get_primer_sections():
    return PRIMER_SECTIONS


@app.get("/config/openai-key")
def get_openai_key_config():
    """Backwards-compatible endpoint for legacy frontend key prefill."""
    env_key = os.getenv("OPENAI_API_KEY", "") or ""
    return {"api_key": env_key, "has_env_key": bool(env_key)}


@app.get("/config/llm-config")
def get_llm_config():
    providers: List[dict] = []
    for provider in ("openai", "openrouter"):
        pid: LLMProvider = normalize_provider(provider)
        env_var = "OPENROUTER_API_KEY" if pid == "openrouter" else "OPENAI_API_KEY"
        env_key = os.getenv(env_var, "") or ""
        providers.append(
            {
                "id": pid,
                "label": provider_label(pid),
                "default_model": default_model_for(pid, fallback_openai_model="gpt-4o"),
                "models": model_options(pid),
                "env_api_key": env_key,
                "has_env_key": bool(env_key),
            }
        )
    return {"default_provider": DEFAULT_PROVIDER, "providers": providers}


class ValidateKeyRequest(BaseModel):
    provider: str = DEFAULT_PROVIDER
    api_key: str


@app.post("/config/validate-key")
async def validate_key(request: ValidateKeyRequest):
    provider = normalize_provider(request.provider)
    if not request.api_key or not request.api_key.strip():
        return {"valid": False, "error": "API key is empty."}
    try:
        test_client = build_async_client(provider, request.api_key.strip())
        await test_client.models.list()
        return {"valid": True}
    except OpenAIAuthError:
        return {"valid": False, "error": f"Invalid API key ({provider_label(provider)} rejected it)."}
    except APIStatusError as e:
        if e.status_code in {401, 403}:
            return {"valid": False, "error": f"Invalid API key ({provider_label(provider)} rejected it)."}
        return {"valid": False, "error": f"Validation failed: HTTP {e.status_code}"}
    except Exception as e:
        return {"valid": False, "error": f"Validation failed: {str(e)[:200]}"}


@app.post("/generate-exam", response_model=ExamResponse)
async def generate_exam_endpoint(
    method_name: str,
    num_questions: int = 5,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        return await generate_exam_questions(
            method_name,
            num_questions,
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
        )
    except HTTPException:
        raise
    except Exception as e:
        if _is_auth_error(e):
            _raise_auth_failure(llm.provider)
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze-project")
async def analyze_project_endpoint(
    rq_text: str = Form(...),
    pdf_file: Optional[UploadFile] = File(None),
    csv_file: Optional[UploadFile] = File(None),
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        # 1. Process PDF if present
        pdf_text = None
        if pdf_file and pdf_file.filename.endswith(".pdf"):
            pdf_text = await extract_text_from_pdf(pdf_file)

        # 2. Process CSV if present
        dataset_schema = None
        if csv_file and csv_file.filename.endswith(".csv"):
            dataset_schema = await extract_csv_schema(csv_file)

        # 3. Construct Synthesis Prompt for Analysis
        synthesis_text = f"Research Question: {rq_text}\n\n"

        if dataset_schema:
            synthesis_text += (
                f"Available Dataset Schema:\nHeaders: {dataset_schema.headers}\n"
                f"Sample Data: {dataset_schema.sample_rows}\n\n"
            )

        if pdf_text:
            synthesis_text += f"Reference Paper Content:\n{pdf_text[:50000]}"

        analysis = (
            await analyze_paper(
                synthesis_text,
                "Research Design Project",
                provider=llm.provider,
                model=llm.model,
                api_key=llm.api_key,
            )
        ).analysis

        return {
            "project": {
                "rq_text": rq_text,
                "pdf_text": pdf_text,
                "dataset_schema": dataset_schema,
                "analysis": analysis,
            },
            "analysis": analysis,
            "full_text": synthesis_text,
        }
    except HTTPException:
        raise
    except Exception as e:
        _raise_llm_failure(e, llm)


@app.post("/analyze", response_model=APIAnalysisResponse)
async def analyze_endpoint(
    file: UploadFile = File(...),
    llm: LLMRequestContext = Depends(require_llm_context),
):
    contents = await _read_pdf_upload(file)
    try:
        # Validates the PDF and extracts its text. The text is the fallback for
        # models without native PDF input (or PDFs over their limits), and for chat
        # once the PDF bytes are gone from the browser (they aren't persisted).
        document = await run_in_threadpool(load_pdf, contents, file.filename)
        result = await analyze_paper(
            "",
            file.filename,
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
            document=document,
        )
        return APIAnalysisResponse(
            analysis=result.analysis,
            full_text=document.full_text,
            pdf_base64=document.pdf_base64,
            pdf_filename=file.filename,
            page_count=document.page_count,
            warnings=result.warnings,
        )
    except HTTPException:
        raise
    except Exception as e:
        _raise_llm_failure(e, llm)
    finally:
        await file.close()


@app.post("/analyze-scenario", response_model=APIAnalysisResponse)
async def analyze_scenario_endpoint(
    request: AnalyzeTextRequest,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        result = await analyze_paper(
            request.text,
            request.scenario_name,
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
        )
        return APIAnalysisResponse(analysis=result.analysis, full_text=request.text, warnings=result.warnings)
    except HTTPException:
        raise
    except Exception as e:
        _raise_llm_failure(e, llm)


class ChatInput(BaseModel):
    message: str
    history: List[dict]
    paper_text: str = ""
    pdf_base64: Optional[str] = None
    pdf_filename: Optional[str] = None
    analysis_context: Optional[str] = None


@app.post("/chat")
async def chat_endpoint(
    request: ChatInput,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    messages = request.history + [{"role": "user", "content": request.message}]
    try:
        stream = await chat_with_paper(
            request.paper_text,
            request.analysis_context,
            messages,
            model=llm.model,
            provider=llm.provider,
            api_key=llm.api_key,
            pdf_base64=request.pdf_base64,
            pdf_filename=request.pdf_filename,
        )
    except HTTPException:
        raise
    except Exception as e:
        _raise_llm_failure(e, llm)

    return _stream_text(stream)


@app.post("/dag/validate", response_model=DAGValidateResponse)
async def dag_validate(request: DAGValidateRequest):
    try:
        return validate_dag(request.graph)
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/d-separation", response_model=DSeparationResponse)
async def dag_d_separation(request: DSeparationRequest):
    try:
        return check_d_separation(request.graph, request.node_a, request.node_b, request.conditioning_set)
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/paths", response_model=PathsResponse)
async def dag_paths(request: PathsRequest):
    try:
        return find_all_paths(request.graph, request.source, request.target)
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/causal-analysis", response_model=CausalAnalysisResponse)
async def dag_causal_analysis(request: CausalAnalysisRequest):
    try:
        return causal_analysis(
            request.graph,
            request.treatment,
            request.outcome,
            request.conditioning_set,
            request.latent_nodes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/analyze", response_model=DAGAnalyzeResponse)
async def dag_analyze(
    request: DAGAnalyzeRequest,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        return await analyze_dag_with_gpt(
            request.graph,
            request.research_question,
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
        )
    except HTTPException:
        raise
    except Exception as e:
        if _is_auth_error(e):
            _raise_auth_failure(llm.provider)
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/chat")
async def dag_chat(
    request: DAGChatRequest,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        stream = await chat_about_dag(
            request.graph,
            request.history + [{"role": "user", "content": request.message}],
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
        )
    except HTTPException:
        raise
    except Exception as e:
        if _is_auth_error(e):
            _raise_auth_failure(llm.provider)
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    return _stream_text(stream)


@app.get("/sandbox/queries", response_model=QueriesResponse)
async def sandbox_queries():
    try:
        return QueriesResponse(queries=load_queries())
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sandbox/dataset", response_model=DatasetPreview)
async def sandbox_dataset(id: str, limit: int = 50):
    try:
        return preview_dataset(id, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sandbox/estimate", response_model=EstimateResponse)
async def sandbox_estimate_endpoint(request: EstimateRequest):
    try:
        return sandbox_estimate(request.id, request.method, request.variables)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sandbox/interpret")
async def sandbox_interpret(
    request: InterpretRequest,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        stream = await interpret_result(
            request,
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
        )
    except HTTPException:
        raise
    except Exception as e:
        if _is_auth_error(e):
            _raise_auth_failure(llm.provider)
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    return _stream_text(stream)


# --- SCM endpoints ---

class SCMSampleRequest(BaseModel):
    scm_schema: SCMSchema
    n_samples: int = 1000
    seed: Optional[int] = None
    intervention: Optional[Union[HardIntervention, SoftIntervention]] = None


class SCMVariableResult(BaseModel):
    id: str
    equation_display: str
    stats: dict
    histogram: dict
    kde: dict
    raw_samples: list[float]


class SCMSampleResponse(BaseModel):
    results: dict[str, SCMVariableResult]
    # for overlayed histogram
    intervened_results: Optional[dict[str, SCMVariableResult]] = None


@app.post("/scm/sample", response_model=SCMSampleResponse)
def sample_scm(payload: SCMSampleRequest):
    effective_seed = payload.seed if payload.seed is not None else int(np.random.randint(0, 2**31 - 1))

    try:
        samples = evaluate_scm(payload.scm_schema, payload.n_samples, effective_seed)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    def build_results(schema, samples):
        return {
            var_id: SCMVariableResult(
                id=var_id,
                equation_display=schema.equation_display(var_id),
                stats=compute_stats(data),
                histogram=compute_histogram(data),
                kde=compute_kde(data),
                raw_samples=data.tolist(),
            )
            for var_id, data in samples.items()
        }

    results = build_results(payload.scm_schema, samples)

    intervened_results = None
    if payload.intervention:
        try:
            intervened_schema = apply_intervention(payload.scm_schema, payload.intervention)
            intervened_samples = evaluate_scm(intervened_schema, payload.n_samples, effective_seed)
            intervened_results = build_results(intervened_schema, intervened_samples)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    return SCMSampleResponse(results=results, intervened_results=intervened_results)

class AbductionRequest(BaseModel):
    scm_schema: SCMSchema
    observed_values: Dict[str, float]

class AbductionResponse(BaseModel):
    observed_values: Dict[str, float]
    abduced_noise: Dict[str, float]
    warnings: list[str] = []


@app.post("/scm/abduct", response_model=AbductionResponse)
def abduct_scm(payload: AbductionRequest):
    try:
        noise, warnings = abduce_noise(payload.scm_schema, payload.observed_values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AbductionResponse(observed_values=payload.observed_values, abduced_noise=noise, warnings=warnings)

class CounterfactualRequest(BaseModel):
    scm_schema: SCMSchema
    abduced_noise: Dict[str, float]
    intervene_id: str
    intervene_value: float


class CounterfactualResponse(BaseModel):
    counterfactual_values: Dict[str, float]


@app.post("/scm/counterfactual", response_model=CounterfactualResponse)
def counterfactual_scm(payload: CounterfactualRequest):
    try:
        values = compute_counterfactual(
            payload.scm_schema,
            payload.abduced_noise,
            payload.intervene_id,
            payload.intervene_value,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return CounterfactualResponse(counterfactual_values=values)

class TreatmentResponseRequest(BaseModel):
    scm_schema: SCMSchema
    abduced_noise: Dict[str, float]
    intervene_id: str
    query_id: str
    value_range: List[float]


class TreatmentResponseResponse(BaseModel):
    points: List[Dict[str, float]]


@app.post("/scm/treatment-response", response_model=TreatmentResponseResponse)
def treatment_response(payload: TreatmentResponseRequest):
    try:
        points = compute_treatment_response(
            payload.scm_schema, payload.abduced_noise, payload.intervene_id, payload.query_id, payload.value_range
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return TreatmentResponseResponse(points=points)


class ComputationTraceRequest(BaseModel):
    scm_schema: SCMSchema
    observed_values: Dict[str, float]
    abduced_noise: Dict[str, float]
    intervene_id: str
    intervene_value: float


class ComputationTraceResponse(BaseModel):
    structural_equations: List[str]
    abduction: List[TraceLine]
    action: Dict[str, float | str]
    prediction: List[TraceLine]
    final_values: Dict[str, float]


@app.post("/scm/computation-trace", response_model=ComputationTraceResponse)
def computation_trace(payload: ComputationTraceRequest):
    try:
        trace = build_computation_trace(
            payload.scm_schema,
            payload.observed_values,
            payload.abduced_noise,
            payload.intervene_id,
            payload.intervene_value,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ComputationTraceResponse(**trace)


class SCMChatRequest(BaseModel):
    scm_schema: SCMSchema
    message: str
    history: List[Dict[str, str]] = []
    active_tab: Optional[str] = None
    observational: Optional[dict] = None
    intervention: Optional[dict] = None
    counterfactual: Optional[dict] = None
    sandbox: Optional[dict] = None


@app.post("/scm/chat")
async def scm_chat(
    request: SCMChatRequest,
    llm: LLMRequestContext = Depends(require_llm_context),
):
    try:
        stream = await chat_about_scm(
            request.scm_schema,
            request.history + [{"role": "user", "content": request.message}],
            provider=llm.provider,
            model=llm.model,
            api_key=llm.api_key,
            active_tab=request.active_tab,
            intervention=request.intervention,
            observational=request.observational,
            counterfactual=request.counterfactual,
            sandbox=request.sandbox,
        )

    except HTTPException:
        raise
    except Exception as e:
        if _is_auth_error(e):
            _raise_auth_failure(llm.provider)
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    return _stream_text(stream)
