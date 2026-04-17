from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ── Curated query metadata ─────────────────────────────────────────────

class Query(BaseModel):
    id: str
    title: str
    concept_highlight: str
    query: str
    dataset_description: str
    method: str
    dataset_path: str
    effect: float
    treatment_var: str
    outcome_var: str
    control_variables: List[str] = Field(default_factory=list)
    instrument_var: Optional[str] = None
    running_var: Optional[str] = None
    cutoff: Optional[float] = None
    temporal_var: Optional[str] = None
    state_var: Optional[str] = None
    mediator_var: Optional[str] = None
    domain: str


class QueriesResponse(BaseModel):
    queries: List[Query]


# ── Dataset preview ────────────────────────────────────────────────────

class DatasetPreview(BaseModel):
    columns: List[str]
    dtypes: List[str]
    n_rows: int
    sample_rows: List[Dict[str, Any]]


# ── Estimation ─────────────────────────────────────────────────────────

class VariableSelection(BaseModel):
    treatment: str
    outcome: str
    controls: List[str] = Field(default_factory=list)
    instrument: Optional[str] = None
    running_var: Optional[str] = None
    cutoff: Optional[float] = None
    temporal_var: Optional[str] = None
    state_var: Optional[str] = None
    mediator: Optional[str] = None


class EstimateRequest(BaseModel):
    id: str
    method: str
    variables: VariableSelection


class GroundTruthComparison(BaseModel):
    effect: float
    delta: Optional[float] = None
    within_ci: Optional[bool] = None


class EstimateResponse(BaseModel):
    method: str
    estimate: Optional[float] = None
    std_error: Optional[float] = None
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    p_value: Optional[float] = None
    n_obs: int = 0
    ground_truth: GroundTruthComparison
    warnings: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    plot_type: str
    plot_data: Dict[str, Any] = Field(default_factory=dict)


# ── LLM interpretation ─────────────────────────────────────────────────

class InterpretRequest(BaseModel):
    result: EstimateResponse
    query: str
    dataset_description: str
