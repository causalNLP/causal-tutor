import os
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional

from openai import AsyncOpenAI, Timeout

LLMProvider = Literal["openai", "openrouter"]

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_PROVIDER: LLMProvider = "openai"


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    # Max input tokens the model accepts (not the full context window when the
    # provider reserves part of it for output).
    input_tokens: int
    # True when the model reads PDF `file` content parts natively. Models without
    # it get locally extracted text instead (see services.py).
    pdf_input: bool


# Curated model lists. Every entry must support Chat Completions *with* function
# calling, since paper analysis relies on a forced tool call.
#
# Sources (checked 2026-10-09):
# - OpenAI: developers.openai.com/api/docs/models. Pro variants are Responses-API
#   only; GPT-6 Sol / 6.1 Sol / 6 Luna restrict function calling on Chat
#   Completions, so they are excluded from the direct-OpenAI list. gpt-5.4-nano
#   is deprecated. PDF inputs work on every vision model (gpt-4o and later).
# - OpenRouter: openrouter.ai/api/v1/models. `pdf_input` mirrors whether
#   `architecture.input_modalities` contains "file".
_MODEL_SPECS: Dict[LLMProvider, List[ModelSpec]] = {
    "openai": [
        ModelSpec("gpt-6-astra", "OpenAI GPT-6 Astra", 922_000, True),
        ModelSpec("gpt-5.6-sol", "OpenAI GPT-5.6 Sol", 922_000, True),
        ModelSpec("gpt-5.6-terra", "OpenAI GPT-5.6 Terra", 922_000, True),
        ModelSpec("gpt-5.6-luna", "OpenAI GPT-5.6 Luna", 922_000, True),
        ModelSpec("gpt-5.5", "OpenAI GPT-5.5", 922_000, True),
        ModelSpec("gpt-5.4-mini", "OpenAI GPT-5.4 Mini", 272_000, True),
        ModelSpec("gpt-4o", "OpenAI GPT-4o", 128_000, True),
        ModelSpec("gpt-4o-mini", "OpenAI GPT-4o Mini", 128_000, True),
    ],
    "openrouter": [
        # OpenAI
        ModelSpec("openai/gpt-6.1-sol", "OpenAI GPT-6.1 Sol", 922_000, True),
        ModelSpec("openai/gpt-6-astra", "OpenAI GPT-6 Astra", 922_000, True),
        ModelSpec("openai/gpt-5.6-sol", "OpenAI GPT-5.6 Sol", 922_000, True),
        ModelSpec("openai/gpt-5.6-terra", "OpenAI GPT-5.6 Terra", 922_000, True),
        ModelSpec("openai/gpt-5.6-luna", "OpenAI GPT-5.6 Luna", 922_000, True),
        ModelSpec("openai/gpt-5.5", "OpenAI GPT-5.5", 922_000, True),
        ModelSpec("openai/gpt-5.4-mini", "OpenAI GPT-5.4 Mini", 272_000, True),
        ModelSpec("openai/gpt-4o", "OpenAI GPT-4o", 128_000, True),
        ModelSpec("openai/gpt-4o-mini", "OpenAI GPT-4o Mini", 128_000, True),

        # Anthropic
        ModelSpec("anthropic/claude-fable-5.1", "Anthropic Claude Fable 5.1", 1_000_000, True),
        ModelSpec("anthropic/claude-opus-5.5", "Anthropic Claude Opus 5.5", 1_000_000, True),
        ModelSpec("anthropic/claude-sonnet-5.5", "Anthropic Claude Sonnet 5.5", 1_000_000, True),
        ModelSpec("anthropic/claude-haiku-5.5", "Anthropic Claude Haiku 5.5", 1_000_000, True),

        # Google
        ModelSpec("google/gemini-3.1-pro-preview", "Google Gemini 3.1 Pro (Preview)", 1_048_576, True),
        ModelSpec("google/gemini-3.8-flash", "Google Gemini 3.8 Flash", 1_048_576, True),

        # xAI
        ModelSpec("x-ai/grok-4.7", "xAI Grok 4.7", 500_000, True),

        # The models below have no native file input: PDFs are sent as extracted text.
        # DeepSeek
        ModelSpec("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", 1_024_000, False),
        ModelSpec("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 1_048_576, False),

        # Z.ai
        ModelSpec("z-ai/glm-5.3", "Z.ai GLM 5.3", 1_048_576, False),

        # Moonshot AI
        ModelSpec("moonshotai/kimi-k3", "Moonshot Kimi K3", 1_048_576, False),
    ],
}

_MODEL_OPTIONS: Dict[LLMProvider, List[Dict[str, object]]] = {
    provider: [{"id": s.id, "label": s.label, "supports_pdf": s.pdf_input} for s in specs]
    for provider, specs in _MODEL_SPECS.items()
}

# Model ids the UI used to offer that are still valid upstream aliases.
_OPENAI_ALIASES = {"gpt-5.6": "gpt-5.6-sol"}

_OPENAI_TO_OPENROUTER = {spec.id: f"openai/{spec.id}" for spec in _MODEL_SPECS["openai"]}
_OPENROUTER_TO_OPENAI = {v: k for k, v in _OPENAI_TO_OPENROUTER.items()}
_OPENAI_TO_OPENROUTER.update({alias: f"openai/{target}" for alias, target in _OPENAI_ALIASES.items()})
_MODEL_IDS = {
    provider: {option["id"] for option in options}
    for provider, options in _MODEL_OPTIONS.items()
}
_SPECS_BY_ID = {
    provider: {spec.id: spec for spec in specs}
    for provider, specs in _MODEL_SPECS.items()
}

# Used for model ids outside the curated list: assume a small context and no
# native PDF reading, so we never send a file the model can't handle.
_UNKNOWN_MODEL_INPUT_TOKENS = 128_000


def model_spec(provider: LLMProvider, model_id: str) -> ModelSpec:
    lookup = _OPENAI_ALIASES.get(model_id, model_id) if provider == "openai" else model_id
    spec = _SPECS_BY_ID[provider].get(lookup)
    if spec:
        return spec
    return ModelSpec(model_id, model_id, _UNKNOWN_MODEL_INPUT_TOKENS, False)


@dataclass(frozen=True)
class PdfLimits:
    # Max size of the base64-encoded PDF in the request body.
    max_base64_bytes: int
    max_pages: Optional[int]
    # Rough tokens per page on top of the extracted text (page images etc.).
    page_overhead_tokens: int


_MB = 1024 * 1024


def pdf_limits(provider: LLMProvider, model_id: str) -> PdfLimits:
    """Documented native-PDF limits for the upstream model family.

    - OpenAI: files under 50 MB, 50 MB per request; text plus a page image per page.
    - Anthropic: 32 MB per request; 600 pages (100 below a 1M context window);
      roughly 2.3k tokens per page in total.
    - Google: 50 MB or 1000 pages; 258 tokens per page.
    - Anything else (e.g. xAI via OpenRouter) gets the conservative Anthropic limits.
    """
    family = model_id.split("/", 1)[0] if provider == "openrouter" and "/" in model_id else "openai"
    if family == "openai":
        return PdfLimits(50 * _MB, None, 800)
    if family == "google":
        return PdfLimits(50 * _MB, 1000, 258)
    spec = model_spec(provider, model_id)
    max_pages = 600 if spec.input_tokens >= 1_000_000 else 100
    return PdfLimits(32 * _MB, max_pages, 1600)


@dataclass(frozen=True)
class LLMRequestContext:
    provider: LLMProvider
    api_key: str
    model: Optional[str] = None


def provider_label(provider: LLMProvider) -> str:
    return "OpenRouter" if provider == "openrouter" else "OpenAI"


def normalize_provider(raw_provider: Optional[str]) -> LLMProvider:
    value = (raw_provider or "").strip().lower()
    if value in {"openrouter", "open-router"}:
        return "openrouter"
    return "openai"


def model_options(provider: LLMProvider) -> List[Dict[str, str]]:
    return list(_MODEL_OPTIONS[provider])


def default_model_for(provider: LLMProvider, fallback_openai_model: str = "gpt-4o") -> str:
    if provider == "openai":
        return fallback_openai_model
    return _OPENAI_TO_OPENROUTER.get(fallback_openai_model, "openai/gpt-4o-mini")


def resolve_model(
    provider: LLMProvider,
    requested_model: Optional[str],
    fallback_openai_model: str = "gpt-4o",
) -> str:
    explicit = (requested_model or "").strip()
    if explicit:
        if provider == "openrouter":
            # If the browser has an OpenAI model id cached while OpenRouter is
            # selected, translate it to the equivalent OpenRouter id.
            if explicit in _OPENAI_TO_OPENROUTER:
                return _OPENAI_TO_OPENROUTER[explicit]
            return explicit

        # If the browser has an OpenRouter OpenAI-family id cached while the
        # OpenAI provider is selected, translate it back. Non-OpenAI
        # OpenRouter ids (anthropic/..., google/..., etc.) are not valid for
        # OpenAI and must fall back to a known OpenAI model.
        if explicit in _MODEL_IDS["openai"]:
            return explicit
        if explicit in _OPENROUTER_TO_OPENAI:
            return _OPENROUTER_TO_OPENAI[explicit]
        if "/" in explicit:
            return default_model_for(provider, fallback_openai_model=fallback_openai_model)
        return explicit
    return default_model_for(provider, fallback_openai_model=fallback_openai_model)


def build_async_client(
    provider: LLMProvider,
    api_key: str,
    timeout: Optional[Timeout] = None,
    max_retries: Optional[int] = None,
) -> AsyncOpenAI:
    # The SDK retries connection errors, 408/409/429 and 5xx with backoff
    # (2 retries by default) and times out after 10 minutes unless overridden.
    kwargs: dict = {"api_key": api_key}
    if provider == "openrouter":
        kwargs["base_url"] = OPENROUTER_BASE_URL
    if timeout is not None:
        kwargs["timeout"] = timeout
    if max_retries is not None:
        kwargs["max_retries"] = max_retries
    return AsyncOpenAI(**kwargs)


def env_key_for(provider: LLMProvider) -> str:
    if provider == "openrouter":
        return os.getenv("OPENROUTER_API_KEY", "") or ""
    return os.getenv("OPENAI_API_KEY", "") or ""
