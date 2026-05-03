export interface CitedParagraph {
  page: number;
  text: string;
  aspect: string;
}

export interface AlternativeMethod {
  method_name: string;
  feasibility: string;
  trade_off: string;
}

export interface MethodAnalysis {
  method_name: string;
  method_selection_summary: string;
  assumptions: string[];
  critique: string;
  result_justification_summary: string;
  cited_paragraphs: CitedParagraph[];
}

export interface CausalQueryResponse {
  paper_name: string;
  causal_query: string;
  causal_graph_mermaid: string;
  methods: MethodAnalysis[];
  alternative_methods: AlternativeMethod[];
  suggested_questions: string[];
}

export interface APIAnalysisResponse {
    analysis: CausalQueryResponse;
    full_text: string;
}

// ── DAG Playground Types ─────────────────────────────────────────────────

export interface ExampleDAG {
  id: string;
  name: string;
  description: string;
  concept: string;
  nodes: Array<{
    id: string;
    label: string;
    position: { x: number; y: number };
    isLatent?: boolean;
  }>;
  edges: Array<{ source: string; target: string }>;
}

export interface PathInfo {
  path: string[];
  path_type: string;
  contains_collider: boolean;
  collider_nodes: string[];
  confounders: string[];
}

export interface PathsResponse {
  directed_paths: PathInfo[];
  backdoor_paths: PathInfo[];
  all_paths: PathInfo[];
}

export interface DSeparationResult {
  d_separated: boolean;
  explanation: string;
  active_paths: string[][];
}

export interface DAGAnalysisResult {
  feedback: string;
  confounders: string[];
  colliders: string[];
  suggested_adjustments: string[];
  faithfulness_notes: string;
}

export interface AnalysisPathInfo {
  path: string[];
  path_type: string;
  is_blocked: boolean;
  block_reason: string | null;
  collider_nodes: string[];
}

export interface CausalAnalysisResult {
  paths: AnalysisPathInfo[];
  d_separated: boolean;
  active_paths: string[][];
  backdoor_satisfied: boolean;
  backdoor_issues: string[];
  minimal_adjustment_set: string[] | null;
  explanation: string;
}

// ── Dataset Sandbox Types ────────────────────────────────────────────────

export interface SandboxQuery {
  id: string;
  title: string;
  concept_highlight: string;
  query: string;
  dataset_description: string;
  method: string;
  dataset_path: string;
  effect: number;
  treatment_var: string;
  outcome_var: string;
  control_variables: string[];
  instrument_var: string | null;
  running_var: string | null;
  cutoff: number | null;
  temporal_var: string | null;
  state_var: string | null;
  mediator_var: string | null;
  domain: string;
}

export interface QueriesResponse {
  queries: SandboxQuery[];
}

export interface SandboxDatasetPreview {
  columns: string[];
  dtypes: string[];
  n_rows: number;
  sample_rows: Record<string, unknown>[];
}

export interface VariableSelection {
  treatment: string;
  outcome: string;
  controls: string[];
  instrument?: string | null;
  running_var?: string | null;
  cutoff?: number | null;
  temporal_var?: string | null;
  state_var?: string | null;
  mediator?: string | null;
}

export interface GroundTruthComparison {
  effect: number;
  delta: number | null;
  within_ci: boolean | null;
}

export interface ForestTerm {
  name: string;
  coef: number;
  ci_low: number;
  ci_high: number;
  is_treatment: boolean;
}

export interface ForestPlotData {
  terms: ForestTerm[];
}

export interface ParallelTrendsPlotData {
  periods: (number | string)[];
  treated_mean: number[];
  control_mean: number[];
  treatment_start: number;
  diagnostics: {
    slope_treated?: number;
    slope_control?: number;
    delta?: number;
    pooled_sd?: number;
  };
}

export interface FirstStagePlotData {
  scatter: { z: number; t: number }[];
  fit_line: { z: number; t_hat: number }[];
  f_stat: number;
  instrument: string;
  treatment: string;
}

export interface DiscontinuityPlotData {
  scatter: { r: number; y: number }[];
  left_fit: { r: number; y: number }[];
  right_fit: { r: number; y: number }[];
  cutoff: number;
  bandwidth: number;
  running_var: string;
  outcome_var: string;
}

export interface CovariateBalancePlotData {
  covariates: string[];
  smd_before: { covariate: string; smd: number }[];
  smd_after: { covariate: string; smd: number }[];
  threshold: number;
}

export interface MediationPlotData {
  treatment: string;
  mediator: string;
  outcome: string;
  t_to_m: number;
  m_to_y: number;
  t_to_y_direct: number;
  indirect: number;
}

export interface EstimateResponse {
  method: string;
  estimate: number | null;
  std_error: number | null;
  ci_low: number | null;
  ci_high: number | null;
  p_value: number | null;
  n_obs: number;
  ground_truth: GroundTruthComparison;
  warnings: string[];
  assumptions: string[];
  plot_type: string;
  plot_data: Record<string, unknown>;
}
