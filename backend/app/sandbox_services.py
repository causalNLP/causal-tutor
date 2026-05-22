import json
import os
import math
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

import numpy as np
import pandas as pd
from openai import AsyncOpenAI
from dotenv import load_dotenv

from .sandbox_models import (
    Query, QueriesResponse, DatasetPreview,
    VariableSelection, EstimateResponse, GroundTruthComparison,
    InterpretRequest, SandboxIssue,
)

load_dotenv()


def _get_client(api_key: Optional[str] = None) -> AsyncOpenAI:
    """Build a per-request OpenAI client. Endpoints in main.py reject requests
    that don't supply an API key (`_require_api_key`) before reaching this function."""
    effective = api_key or os.getenv("OPENAI_API_KEY")
    if not effective:
        raise RuntimeError("OpenAI API key not provided.")
    return AsyncOpenAI(api_key=effective)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CURATED_JSON = DATA_DIR / "curated_queries.json"

# ── Metadata loader (cached) ──────────────────────────────────────────

_QUERIES_CACHE: Optional[List[Query]] = None


def load_queries() -> List[Query]:
    global _QUERIES_CACHE
    if _QUERIES_CACHE is None:
        with open(CURATED_JSON, "r", encoding="utf-8") as f:
            raw = json.load(f)
        _QUERIES_CACHE = [Query(**q) for q in raw]
    return _QUERIES_CACHE


def get_query_by_id(qid: str) -> Optional[Query]:
    for q in load_queries():
        if q.id == qid:
            return q
    return None


def load_df(dataset_path: str) -> pd.DataFrame:
    """Load CSV safely — reject path traversal."""
    # dataset_path is like "synthetic_data/rct_data_7.csv"
    target = (DATA_DIR / dataset_path).resolve()
    if not str(target).startswith(str(DATA_DIR.resolve())):
        raise ValueError("Path traversal rejected")
    if not target.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")
    return pd.read_csv(target)


# ── Dataset preview ───────────────────────────────────────────────────

def preview_dataset(qid: str, limit: int = 50) -> DatasetPreview:
    q = get_query_by_id(qid)
    if q is None:
        raise ValueError(f"Unknown query id: {qid}")
    df = load_df(q.dataset_path)
    sample = df.head(limit)
    sample_rows = []
    for _, row in sample.iterrows():
        d = {}
        for col in df.columns:
            v = row[col]
            if isinstance(v, (np.integer,)):
                d[col] = int(v)
            elif isinstance(v, (np.floating,)):
                d[col] = None if np.isnan(v) else float(v)
            else:
                d[col] = v
        sample_rows.append(d)
    return DatasetPreview(
        columns=list(df.columns),
        dtypes=[str(t) for t in df.dtypes],
        n_rows=len(df),
        sample_rows=sample_rows,
    )


# ── Assumption catalog per method ──────────────────────────────────────

ASSUMPTIONS = {
    "ols": [
        "Linearity of the outcome in treatment and controls",
        "No unobserved confounders (conditional independence)",
        "Homoskedastic, uncorrelated errors",
    ],
    "did": [
        "Parallel trends in the absence of treatment",
        "No anticipation of treatment",
        "SUTVA (no spillovers between units)",
        "Stable composition of treated/control groups",
    ],
    "iv": [
        "Relevance: the instrument predicts the treatment (first-stage F > 10)",
        "Exclusion restriction: the instrument affects the outcome only through treatment",
        "Monotonicity: no 'defiers'",
    ],
    "rdd": [
        "Continuity of potential outcomes at the cutoff",
        "No manipulation of the running variable around the cutoff",
        "Sharp assignment rule (treatment is determined by the cutoff)",
    ],
    "matching": [
        "Conditional ignorability given observed covariates",
        "Common support / overlap (positivity)",
        "Correctly specified propensity score model",
    ],
    "frontdoor": [
        "The mediator fully captures the effect of treatment on outcome",
        "No unblocked back-door from treatment to mediator",
        "All back-doors from mediator to outcome are blocked by treatment",
    ],
}


# ── Method-requirement validation ──────────────────────────────────────

METHOD_LABELS = {
    "ols": "OLS",
    "did": "Difference-in-Differences",
    "iv": "Instrumental Variables",
    "rdd": "Regression Discontinuity",
    "matching": "Propensity Score Matching",
    "frontdoor": "Front-door",
}


def _issue(
    severity: str,
    title: str,
    message: str,
    fix_steps: List[str],
    field: Optional[str] = None,
) -> SandboxIssue:
    return SandboxIssue(
        severity=severity,
        title=title,
        message=message,
        fix_steps=fix_steps,
        field=field,
    )


def _issue_to_warning(issue: SandboxIssue) -> str:
    steps = " ".join(f"{i + 1}. {step}" for i, step in enumerate(issue.fix_steps))
    return f"{issue.title}: {issue.message}" + (f" Steps to fix: {steps}" if steps else "")


def _warnings_from_issues(issues: List[SandboxIssue]) -> List[str]:
    return [_issue_to_warning(issue) for issue in issues]


def _field_values(v: VariableSelection) -> List[Tuple[str, Optional[str]]]:
    return [
        ("treatment", v.treatment),
        ("outcome", v.outcome),
        ("instrument", v.instrument),
        ("running_var", v.running_var),
        ("temporal_var", v.temporal_var),
        ("state_var", v.state_var),
        ("mediator", v.mediator),
    ]


def _required_columns(method: str, v: VariableSelection) -> List[str]:
    controls = _controls_for_method(method, v)
    cols = [v.treatment, v.outcome] + controls
    if method == "iv" and v.instrument:
        cols.append(v.instrument)
    if method == "did":
        if v.temporal_var:
            cols.append(v.temporal_var)
        if v.state_var:
            cols.append(v.state_var)
    if method == "rdd" and v.running_var:
        cols.append(v.running_var)
    if method == "frontdoor" and v.mediator:
        cols.append(v.mediator)
    return _unique_cols([c for c in cols if c])


def _numeric_fields(method: str, v: VariableSelection) -> List[Tuple[str, Optional[str]]]:
    fields = [("treatment", v.treatment), ("outcome", v.outcome)]
    fields.extend(("controls", c) for c in _controls_for_method(method, v))
    if method == "iv":
        fields.append(("instrument", v.instrument))
    if method == "did":
        fields.append(("temporal_var", v.temporal_var))
    if method == "rdd":
        fields.append(("running_var", v.running_var))
    if method == "frontdoor":
        fields.append(("mediator", v.mediator))
    return fields


def _controls_for_method(method: str, v: VariableSelection) -> List[str]:
    excluded = {
        v.treatment,
        v.outcome,
        v.instrument,
        v.running_var,
        v.temporal_var,
        v.state_var,
        v.mediator,
        None,
        "",
    }

    controls = []
    seen = set()
    for c in v.controls:
        if not c or c in excluded or c in seen:
            continue
        controls.append(c)
        seen.add(c)
    return controls


def validate_variables(method: str, v: VariableSelection, df: pd.DataFrame) -> List[SandboxIssue]:
    """Return structured learner-facing issues. Blocking issues prevent estimation."""
    issues: List[SandboxIssue] = []

    if not v.treatment:
        issues.append(_issue(
            "blocking",
            "Choose a treatment variable",
            "The treatment is the exposure, policy, or action whose causal effect you want to estimate.",
            [
                "Use the Treatment dropdown to choose the column named in the research question.",
                "If you are using a curated example, click Reset to restore the recommended treatment.",
            ],
            "treatment",
        ))
    if not v.outcome:
        issues.append(_issue(
            "blocking",
            "Choose an outcome variable",
            "The outcome is the result that may change because of the treatment.",
            [
                "Use the Outcome dropdown to choose the result column named in the research question.",
                "If you are using a curated example, click Reset to restore the recommended outcome.",
            ],
            "outcome",
        ))

    if method == "iv" and not v.instrument:
        issues.append(_issue(
            "blocking",
            "Choose an instrument for IV",
            "Instrumental Variables needs a separate column Z that predicts treatment but should not affect the outcome except through treatment.",
            [
                "Open the Instrument dropdown.",
                "Pick the column described as the source of as-if random variation in treatment.",
                "If you are unsure, click Reset to use the curated instrument for this dataset.",
            ],
            "instrument",
        ))
    if method == "did":
        if not v.temporal_var:
            issues.append(_issue(
                "blocking",
                "Choose a time variable for DiD",
                "Difference-in-Differences compares treated and control units before and after treatment, so it needs a time column.",
                [
                    "Open the Time variable dropdown.",
                    "Choose the year, date, wave, or period column.",
                    "Click Reset if you want the dataset's recommended DiD setup.",
                ],
                "temporal_var",
            ))
        if not v.state_var:
            issues.append(_issue(
                "blocking",
                "Choose a unit variable for DiD",
                "Difference-in-Differences needs an entity column so the model knows which rows belong to the same school, state, person, or other unit.",
                [
                    "Open the Unit variable dropdown.",
                    "Choose the stable entity identifier, such as school_id, state, person_id, or firm_id.",
                    "Avoid choosing the outcome, treatment, or a numeric control as the unit identifier.",
                ],
                "state_var",
            ))
    if method == "rdd" and not v.running_var:
        issues.append(_issue(
            "blocking",
            "Choose a running variable for RDD",
            "Regression Discontinuity needs the assignment variable that determines which observations fall just below or above the cutoff.",
            [
                "Open the Running var dropdown.",
                "Choose the score, index, age, income, GPA, or other assignment column used for the cutoff rule.",
                "Enter the cutoff if you know it, or leave it blank to use the dataset median.",
            ],
            "running_var",
        ))
    if method == "frontdoor" and not v.mediator:
        issues.append(_issue(
            "blocking",
            "Choose a mediator for front-door",
            "Front-door estimation needs a mediator M on the causal pathway from treatment to outcome.",
            [
                "Open the Mediator dropdown.",
                "Pick a post-treatment column that the treatment changes and that then affects the outcome.",
                "Do not choose a pre-treatment control or the outcome itself as the mediator.",
            ],
            "mediator",
        ))
    if method == "matching" and not _controls_for_method(method, v):
        issues.append(_issue(
            "blocking",
            "Choose covariates for matching",
            "Propensity score matching needs observed pre-treatment covariates to compare treated and untreated units that look similar.",
            [
                "Check at least one covariate in the Controls list.",
                "Prefer variables measured before treatment that predict treatment and outcome.",
                "Do not use the treatment, outcome, or post-treatment variables as controls.",
            ],
            "controls",
        ))

    role_values = [
        ("treatment", v.treatment),
        ("outcome", v.outcome),
    ]
    if method == "iv":
        role_values.append(("instrument", v.instrument))
    if method == "did":
        role_values.extend([("time variable", v.temporal_var), ("unit variable", v.state_var)])
    if method == "rdd":
        role_values.append(("running variable", v.running_var))
    if method == "frontdoor":
        role_values.append(("mediator", v.mediator))

    by_column: Dict[str, List[str]] = {}
    for role, col in role_values:
        if col:
            by_column.setdefault(col, []).append(role)
    duplicated_roles = {col: roles for col, roles in by_column.items() if len(roles) > 1}
    if duplicated_roles:
        details = "; ".join(f"{col} is selected as {', '.join(roles)}" for col, roles in duplicated_roles.items())
        issues.append(_issue(
            "blocking",
            "A variable is assigned to more than one role",
            f"Each causal role needs its own column. {details}.",
            [
                "Choose separate columns for treatment, outcome, and method-specific variables.",
                "If you are exploring, change one selector at a time and run again.",
                "Click Reset to restore the curated variable roles.",
            ],
        ))

    selected_missing = [
        (field, value)
        for field, value in _field_values(v)
        if value and value not in df.columns
    ]
    selected_missing.extend(("controls", c) for c in v.controls if c not in df.columns)
    if selected_missing:
        missing_names = ", ".join(sorted({value for _, value in selected_missing if value}))
        issues.append(_issue(
            "blocking",
            "One or more selected columns are not in the dataset",
            f"The current dataset does not contain: {missing_names}. This can happen after switching examples or changing methods.",
            [
                "Click Reset to restore variables from the selected example.",
                "Or choose replacement variables from the visible dataset columns.",
            ],
        ))
        return issues

    if any(issue.severity == "blocking" for issue in issues):
        return issues

    non_numeric = []
    for field, col in _numeric_fields(method, v):
        if col and col in df.columns and not pd.api.types.is_numeric_dtype(df[col]):
            non_numeric.append((field, col))
    if non_numeric:
        bad = ", ".join(sorted({col for _, col in non_numeric}))
        issues.append(_issue(
            "blocking",
            "Use numeric variables for this estimator",
            f"The estimator needs numeric columns, but these selected columns are not numeric: {bad}.",
            [
                "Choose numeric columns from the dataset table.",
                "For DiD, the unit variable may be text, but treatment, outcome, controls, and time should be numeric.",
                "Click Reset to restore a working variable set for the curated example.",
            ],
        ))

    required = _required_columns(method, v)
    if required and df[required].dropna().empty:
        issues.append(_issue(
            "blocking",
            "No usable rows after removing missing values",
            "After keeping only the selected variables, every row has at least one missing value.",
            [
                "Remove controls that have many blank values.",
                "Choose variables with visible non-missing values in the dataset preview.",
                "Click Reset to restore the curated variables.",
            ],
        ))

    if method in {"matching", "did", "rdd"} and v.treatment in df.columns:
        treatment_values = set(df[v.treatment].dropna().unique().tolist())
        if treatment_values != {0, 1}:
            issues.append(_issue(
                "blocking",
                "Treatment must be a 0/1 indicator",
                f"{METHOD_LABELS[method]} needs a treatment column with exactly two values: 0 for untreated and 1 for treated.",
                [
                    "Choose a binary treatment column with both 0 and 1 values.",
                    "Check the dataset preview to confirm both groups appear.",
                    "Click Reset to restore the recommended treatment.",
                ],
                "treatment",
            ))

    if method == "rdd" and v.running_var and v.running_var in df.columns and pd.api.types.is_numeric_dtype(df[v.running_var]):
        c = v.cutoff if v.cutoff is not None else float(df[v.running_var].median())
        sigma = float(df[v.running_var].std())
        n = len(df)
        h = 1.06 * sigma * (n ** (-1 / 5)) if n > 0 else 0
        if not math.isfinite(h) or h <= 0:
            issues.append(_issue(
                "blocking",
                "RDD needs variation around the cutoff",
                "The running variable has too little variation to build a local comparison around the cutoff.",
                [
                    "Choose a running variable with many different numeric values.",
                    "Check that the cutoff is inside the range shown in the data.",
                    "Click Reset to use the curated running variable and cutoff.",
                ],
                "running_var",
            ))
        else:
            window = df[(df[v.running_var] >= c - h) & (df[v.running_var] <= c + h)]
            if len(window) < 10:
                issues.append(_issue(
                    "blocking",
                    "RDD has too few observations near the cutoff",
                    "The local bandwidth around the cutoff contains too few rows to estimate the jump reliably.",
                    [
                        "Check that the cutoff is correct and inside the running variable's range.",
                        "Try leaving the cutoff blank so the sandbox uses the median.",
                        "Click Reset to restore the curated RDD setup.",
                    ],
                    "cutoff",
                ))
            elif window[v.running_var].lt(c).sum() == 0 or window[v.running_var].ge(c).sum() == 0:
                issues.append(_issue(
                    "blocking",
                    "RDD needs observations on both sides of the cutoff",
                    "The local comparison window only contains observations from one side of the cutoff.",
                    [
                        "Check that the cutoff is inside the running variable's range.",
                        "Try leaving the cutoff blank so the sandbox uses the median.",
                        "Choose a running variable with observations just below and just above the cutoff.",
                    ],
                    "cutoff",
                ))

    return issues


def _blocking(method: str, issues: List[SandboxIssue]) -> bool:
    """Check if issues block estimation."""
    return any(issue.severity == "blocking" for issue in issues)


# ── Estimators ────────────────────────────────────────────────────────

def _sanitize_cols(df: pd.DataFrame, cols: List[str]) -> List[str]:
    out = []
    seen = set()
    for c in cols:
        if c in df.columns and c not in seen:
            out.append(c)
            seen.add(c)
    return out


def _unique_cols(cols: List[str]) -> List[str]:
    out = []
    seen = set()
    for c in cols:
        if c and c not in seen:
            out.append(c)
            seen.add(c)
    return out


def _clean_numeric_frame(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
    cols = _unique_cols(cols)
    cleaned = df[cols].dropna().copy()
    if cleaned.empty:
        raise ValueError("No usable observations after dropping rows with missing selected variables.")
    return cleaned.astype(float)


def _require_min_rows(df: pd.DataFrame, min_rows: int, method_label: str) -> None:
    if len(df) < min_rows:
        raise ValueError(f"{method_label} needs at least {min_rows} usable observations after filtering.")


def estimate_ols(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    controls = _sanitize_cols(df, _controls_for_method("ols", v))
    X_cols = [v.treatment] + controls
    df_clean = _clean_numeric_frame(df, [v.outcome] + X_cols)
    _require_min_rows(df_clean, max(3, len(X_cols) + 2), "OLS")
    X = df_clean[X_cols]
    X = sm.add_constant(X, has_constant="add")
    y = df_clean[v.outcome]

    model = sm.OLS(y, X).fit()
    t_idx = X.columns.get_loc(v.treatment)
    coef = float(model.params.iloc[t_idx])
    se = float(model.bse.iloc[t_idx])
    pval = float(model.pvalues.iloc[t_idx])
    ci = model.conf_int().iloc[t_idx].tolist()

    # Forest plot: all coefs with CIs (exclude constant)
    terms = []
    for i, name in enumerate(X.columns):
        if name == "const":
            continue
        cl, ch = model.conf_int().iloc[i].tolist()
        terms.append({
            "name": name,
            "coef": float(model.params.iloc[i]),
            "ci_low": float(cl),
            "ci_high": float(ch),
            "is_treatment": name == v.treatment,
        })

    return {
        "estimate": coef,
        "std_error": se,
        "ci_low": float(ci[0]),
        "ci_high": float(ci[1]),
        "p_value": pval,
        "n_obs": int(len(df_clean)),
        "plot_type": "forest",
        "plot_data": {"terms": terms},
    }


def estimate_did(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    controls = _sanitize_cols(df, _controls_for_method("did", v))
    model_cols = [v.outcome, v.treatment, v.temporal_var, v.state_var] + controls
    df = df[model_cols].dropna().copy()
    _require_min_rows(df, max(6, len(controls) + 4), "Difference-in-Differences")
    df[v.treatment] = df[v.treatment].astype(float)
    df[v.outcome] = df[v.outcome].astype(float)
    if controls:
        df[controls] = df[controls].astype(float)

    # Identify treated units
    unit_max = df.groupby(v.state_var)[v.treatment].max()
    treated_units = unit_max[unit_max == 1].index
    if len(treated_units) == 0 or len(treated_units) == len(unit_max):
        raise ValueError("DiD needs at least one ever-treated unit and one never-treated control unit.")
    df["__treated_group__"] = df[v.state_var].isin(treated_units).astype(int)

    # Treatment start: earliest time where any unit has T=1
    if (df[v.treatment] == 1).any():
        treatment_start = int(df.loc[df[v.treatment] == 1, v.temporal_var].min())
    else:
        treatment_start = int(df[v.temporal_var].median())

    # TWFE regression: build the design matrix directly so arbitrary column
    # names and user role-switching cannot break a Patsy formula.
    X_parts = [df[[v.treatment]].astype(float).rename(columns={v.treatment: "__treatment__"})]
    if controls:
        X_parts.append(df[controls].astype(float))
    X_parts.append(pd.get_dummies(df[v.state_var], prefix="unit", drop_first=True, dtype=float))
    X_parts.append(pd.get_dummies(df[v.temporal_var], prefix="time", drop_first=True, dtype=float))
    X = pd.concat(X_parts, axis=1)
    X = sm.add_constant(X, has_constant="add")
    y = df[v.outcome].astype(float)
    model = sm.OLS(y, X).fit()

    coef = float(model.params["__treatment__"])
    se = float(model.bse["__treatment__"])
    pval = float(model.pvalues["__treatment__"])
    ci = model.conf_int().loc["__treatment__"].tolist()

    # Parallel trends plot data
    periods = sorted(df[v.temporal_var].unique())
    treated_mean = []
    control_mean = []
    for t in periods:
        sub = df[df[v.temporal_var] == t]
        treated_mean.append(float(sub.loc[sub["__treated_group__"] == 1, v.outcome].mean()))
        control_mean.append(float(sub.loc[sub["__treated_group__"] == 0, v.outcome].mean()))

    # Parallel trends violation check on pre-treatment periods
    pre_periods = [t for t in periods if t < treatment_start]
    pt_issue, pt_diag = _check_parallel_trends(df, v, pre_periods, treated_mean, control_mean, periods)

    issues_extra = [pt_issue] if pt_issue else []

    return {
        "estimate": coef,
        "std_error": se,
        "ci_low": float(ci[0]),
        "ci_high": float(ci[1]),
        "p_value": pval,
        "n_obs": int(len(df)),
        "plot_type": "parallel_trends",
        "plot_data": {
            "periods": [int(t) if isinstance(t, (np.integer, int)) else float(t) for t in periods],
            "treated_mean": treated_mean,
            "control_mean": control_mean,
            "treatment_start": treatment_start,
            "diagnostics": pt_diag,
        },
        "_extra_issues": issues_extra,
    }


def _check_parallel_trends(df, v, pre_periods, treated_mean, control_mean, periods) -> Tuple[Optional[SandboxIssue], Dict[str, Any]]:
    if len(pre_periods) < 2:
        return _issue(
            "warning",
            "Parallel trends cannot be checked",
            "DiD needs at least two pre-treatment periods to compare the treated and control trends before treatment.",
            [
                "Use a panel dataset with more pre-treatment time periods if available.",
                "Treat this estimate as a demonstration, not strong evidence, until pre-trends can be assessed.",
                "Inspect the diagnostic plot and ask whether the groups looked similar before treatment.",
            ],
            "temporal_var",
        ), {}

    pre_idx = [periods.index(t) for t in pre_periods]
    t_arr = np.array(pre_periods, dtype=float)
    y_t = np.array([treated_mean[i] for i in pre_idx])
    y_c = np.array([control_mean[i] for i in pre_idx])

    # OLS slopes
    def slope(x, y):
        x_mean = x.mean()
        y_mean = y.mean()
        num = ((x - x_mean) * (y - y_mean)).sum()
        den = ((x - x_mean) ** 2).sum()
        return float(num / den) if den > 0 else 0.0

    s_t = slope(t_arr, y_t)
    s_c = slope(t_arr, y_c)
    delta = abs(s_t - s_c)

    pre_df = df[df[v.temporal_var].isin(pre_periods)]
    pooled_sd = float(pre_df[v.outcome].std())
    diag = {
        "slope_treated": s_t,
        "slope_control": s_c,
        "delta": delta,
        "pooled_sd": pooled_sd,
    }

    if pooled_sd > 0 and (delta / pooled_sd) > 0.1:
        pct = int(round((delta / pooled_sd) * 100))
        return _issue(
            "warning",
            "Parallel trends may be violated",
            f"Before treatment, the treated and control trends differ by {delta:.2f}, about {pct}% of the outcome standard deviation.",
            [
                "Inspect the parallel-trends plot before interpreting the estimate causally.",
                "Try adding relevant pre-treatment controls if the dataset supports them.",
                "Consider a different comparison group or method if the pre-treatment trends are not similar.",
            ],
        ), diag
    return None, diag


def estimate_iv(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    from linearmodels.iv import IV2SLS
    import statsmodels.api as sm

    controls = _sanitize_cols(df, _controls_for_method("iv", v))
    df_clean = _clean_numeric_frame(df, [v.outcome, v.treatment, v.instrument] + controls)
    _require_min_rows(df_clean, max(10, len(controls) + 4), "IV")
    if df_clean[v.instrument].nunique() < 2:
        raise ValueError("IV needs an instrument with variation; the selected instrument is constant after filtering.")

    # IV2SLS: Y ~ 1 + controls + [T ~ Z]
    exog = sm.add_constant(df_clean[controls], has_constant="add") if controls else pd.DataFrame({"const": np.ones(len(df_clean))}, index=df_clean.index)
    endog = df_clean[[v.treatment]]
    instruments = df_clean[[v.instrument]]
    dep = df_clean[v.outcome]

    model = IV2SLS(dep, exog, endog, instruments).fit(cov_type="robust")
    coef = float(model.params[v.treatment])
    se = float(model.std_errors[v.treatment])
    pval = float(model.pvalues[v.treatment])
    ci_arr = model.conf_int().loc[v.treatment]
    ci_low = float(ci_arr.iloc[0])
    ci_high = float(ci_arr.iloc[1])

    # First-stage F (regress T on Z + controls)
    X_fs = sm.add_constant(df_clean[[v.instrument] + controls], has_constant="add")
    fs_model = sm.OLS(df_clean[v.treatment], X_fs).fit()
    # F-test for instrument being zero
    f_stat = float(fs_model.tvalues[v.instrument] ** 2)

    # First-stage plot: downsample to 300 points
    n = len(df_clean)
    idx = np.random.RandomState(42).choice(n, size=min(300, n), replace=False)
    scatter = [
        {"z": float(df_clean.iloc[i][v.instrument]), "t": float(df_clean.iloc[i][v.treatment])}
        for i in idx
    ]
    # Fit line through z-range
    z_min, z_max = df_clean[v.instrument].min(), df_clean[v.instrument].max()
    z_range = np.linspace(z_min, z_max, 20)
    beta_z = float(fs_model.params[v.instrument])
    beta_0 = float(fs_model.params["const"])
    # Plug in mean of controls for the line
    ctrl_contrib = 0.0
    for c in controls:
        ctrl_contrib += float(fs_model.params[c]) * float(df_clean[c].mean())
    fit_line = [{"z": float(z), "t_hat": beta_0 + beta_z * float(z) + ctrl_contrib} for z in z_range]

    extras = []
    if f_stat < 10:
        extras.append(_issue(
            "warning",
            "Instrument looks weak",
            f"The first-stage F-statistic is {f_stat:.2f}, below the common rule-of-thumb threshold of 10.",
            [
                "Interpret the IV estimate cautiously because weak instruments can make estimates biased and unstable.",
                "Try a stronger instrument if the dataset has one.",
                "Use the first-stage plot to check whether the instrument visibly predicts the treatment.",
            ],
            "instrument",
        ))

    return {
        "estimate": coef,
        "std_error": se,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "p_value": pval,
        "n_obs": int(n),
        "plot_type": "first_stage",
        "plot_data": {
            "scatter": scatter,
            "fit_line": fit_line,
            "f_stat": f_stat,
            "instrument": v.instrument,
            "treatment": v.treatment,
        },
        "_extra_issues": extras,
    }


def estimate_rdd(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    R = v.running_var
    df_clean = _clean_numeric_frame(df, [v.outcome, v.treatment, R])
    _require_min_rows(df_clean, 10, "RDD")
    c = v.cutoff if v.cutoff is not None else float(df_clean[R].median())

    # Bandwidth: Silverman's rule
    sigma = float(df_clean[R].std())
    n = len(df_clean)
    h = 1.06 * sigma * (n ** (-1 / 5))
    if not math.isfinite(h) or h <= 0:
        raise ValueError("RDD needs variation in the running variable.")

    window = df_clean[(df_clean[R] >= c - h) & (df_clean[R] <= c + h)].copy()
    _require_min_rows(window, 10, "RDD")
    window["__above__"] = (window[R] >= c).astype(int)
    if window["__above__"].nunique() < 2:
        raise ValueError("RDD needs observations on both sides of the cutoff within the local bandwidth.")
    window["__R_centered__"] = window[R] - c
    window["__interaction__"] = window["__above__"] * window["__R_centered__"]

    # Local linear: Y = a + b*above + gamma*(R-c) + delta*above*(R-c) + errors
    X = sm.add_constant(window[["__above__", "__R_centered__", "__interaction__"]], has_constant="add")
    y = window[v.outcome]
    model = sm.OLS(y, X).fit()

    # Identify which side is treated by correlating above with treatment
    treated_above = window.groupby("__above__")[v.treatment].mean()
    # If treated group is below cutoff (above==0), flip sign
    sign = 1.0
    if treated_above.get(0, 0) > treated_above.get(1, 0):
        sign = -1.0

    coef_raw = float(model.params["__above__"])
    se = float(model.bse["__above__"])
    pval = float(model.pvalues["__above__"])
    ci = model.conf_int().loc["__above__"].tolist()

    coef = sign * coef_raw
    ci_low = sign * float(ci[1]) if sign < 0 else float(ci[0])
    ci_high = sign * float(ci[0]) if sign < 0 else float(ci[1])
    if ci_low > ci_high:
        ci_low, ci_high = ci_high, ci_low

    # Discontinuity plot: binned scatter + two fits
    n_bins = 20
    plot_df = df_clean.copy()
    bins = np.linspace(plot_df[R].min(), plot_df[R].max(), n_bins + 1)
    plot_df["__bin__"] = pd.cut(plot_df[R], bins, include_lowest=True)
    binned = plot_df.groupby("__bin__").agg(r=(R, "mean"), y=(v.outcome, "mean")).dropna().reset_index(drop=True)
    scatter = [{"r": float(row["r"]), "y": float(row["y"])} for _, row in binned.iterrows()]

    # Fit lines over window
    r_left = np.linspace(c - h, c, 15)
    r_right = np.linspace(c, c + h, 15)
    params = model.params
    left_fit = [{"r": float(r), "y": float(params["const"] + params["__R_centered__"] * (r - c))} for r in r_left]
    right_fit = [
        {"r": float(r), "y": float(params["const"] + params["__above__"] + (params["__R_centered__"] + params["__interaction__"]) * (r - c))}
        for r in r_right
    ]

    return {
        "estimate": coef,
        "std_error": se,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "p_value": pval,
        "n_obs": int(len(window)),
        "plot_type": "discontinuity",
        "plot_data": {
            "scatter": scatter,
            "left_fit": left_fit,
            "right_fit": right_fit,
            "cutoff": float(c),
            "bandwidth": float(h),
            "running_var": R,
            "outcome_var": v.outcome,
        },
    }


def estimate_matching(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import NearestNeighbors

    controls = _sanitize_cols(df, _controls_for_method("matching", v))
    df_clean = _clean_numeric_frame(df, [v.outcome, v.treatment] + controls)
    _require_min_rows(df_clean, 10, "Matching")
    X = df_clean[controls].values
    T_raw = df_clean[v.treatment].values
    unique_t = set(np.unique(T_raw).tolist())
    if unique_t != {0, 1}:
        raise ValueError("Matching needs a binary treatment column with exactly 0 and 1 values after filtering.")
    T = T_raw.astype(int)
    Y = df_clean[v.outcome].values

    # Fit propensity score
    pmodel = LogisticRegression(max_iter=1000).fit(X, T)
    pscore = pmodel.predict_proba(X)[:, 1]

    treated_idx = np.where(T == 1)[0]
    control_idx = np.where(T == 0)[0]

    # 1:1 nearest neighbor matching on propensity score (with replacement)
    treated_p = pscore[treated_idx].reshape(-1, 1)
    control_p = pscore[control_idx].reshape(-1, 1)

    nn = NearestNeighbors(n_neighbors=1).fit(control_p)
    _, nn_idx = nn.kneighbors(treated_p)
    matched_control_idx = control_idx[nn_idx.flatten()]

    # ATT: mean(Y_treated) - mean(Y_matched_control)
    y_treated = Y[treated_idx]
    y_matched = Y[matched_control_idx]
    att = float(np.mean(y_treated - y_matched))

    # Bootstrap SE
    rng = np.random.RandomState(42)
    boots = []
    n_treated = len(treated_idx)
    for _ in range(200):
        samp = rng.choice(n_treated, size=n_treated, replace=True)
        boots.append(np.mean(y_treated[samp] - y_matched[samp]))
    boots = np.array(boots)
    se = float(boots.std(ddof=1))
    ci_low = float(np.percentile(boots, 2.5))
    ci_high = float(np.percentile(boots, 97.5))

    # Covariate balance: SMD before and after
    def smd(a: np.ndarray, b: np.ndarray) -> float:
        pooled = math.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
        if pooled == 0:
            return 0.0
        return float((a.mean() - b.mean()) / pooled)

    smd_before, smd_after = [], []
    for i, col in enumerate(controls):
        a_pre = X[treated_idx, i]
        b_pre = X[control_idx, i]
        a_post = X[treated_idx, i]
        b_post = X[matched_control_idx, i]
        smd_before.append({"covariate": col, "smd": smd(a_pre, b_pre)})
        smd_after.append({"covariate": col, "smd": smd(a_post, b_post)})

    return {
        "estimate": att,
        "std_error": se,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "p_value": None,
        "n_obs": int(len(treated_idx) + len(matched_control_idx)),
        "plot_type": "covariate_balance",
        "plot_data": {
            "covariates": controls,
            "smd_before": smd_before,
            "smd_after": smd_after,
            "threshold": 0.1,
        },
    }


def estimate_frontdoor(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    M = v.mediator
    T = v.treatment
    Y = v.outcome
    controls = _sanitize_cols(df, _controls_for_method("frontdoor", v))

    df_clean = _clean_numeric_frame(df, [T, M, Y] + controls)
    _require_min_rows(df_clean, max(10, len(controls) + 4), "Front-door")

    # Stage 1: M ~ T (+ controls) → coef a
    X1 = sm.add_constant(df_clean[[T] + controls], has_constant="add")
    m1 = sm.OLS(df_clean[M], X1).fit()
    a = float(m1.params[T])
    a_se = float(m1.bse[T])

    # Stage 2: Y ~ M + T (+ controls) → coef b on M
    X2 = sm.add_constant(df_clean[[M, T] + controls], has_constant="add")
    m2 = sm.OLS(df_clean[Y], X2).fit()
    b = float(m2.params[M])
    b_se = float(m2.bse[M])
    direct = float(m2.params[T])

    # Front-door indirect effect = a * b
    indirect = a * b

    # Delta-method SE
    se = math.sqrt((a * b_se) ** 2 + (b * a_se) ** 2)
    ci_low = indirect - 1.96 * se
    ci_high = indirect + 1.96 * se

    return {
        "estimate": indirect,
        "std_error": se,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "p_value": None,
        "n_obs": int(len(df_clean)),
        "plot_type": "mediation",
        "plot_data": {
            "treatment": T,
            "mediator": M,
            "outcome": Y,
            "t_to_m": a,
            "m_to_y": b,
            "t_to_y_direct": direct,
            "indirect": indirect,
        },
    }


# ── Top-level dispatcher ──────────────────────────────────────────────

ESTIMATORS = {
    "ols": estimate_ols,
    "did": estimate_did,
    "iv": estimate_iv,
    "rdd": estimate_rdd,
    "matching": estimate_matching,
    "frontdoor": estimate_frontdoor,
}


def _estimation_failure_issue(method: str, exc: Exception) -> SandboxIssue:
    detail = str(exc)[:200] or exc.__class__.__name__
    lower = detail.lower()

    if "could not convert" in lower or "astype" in lower:
        return _issue(
            "blocking",
            "One selected variable cannot be used as a number",
            "This estimator needs numeric columns for the selected treatment, outcome, controls, and method-specific variables.",
            [
                "Check the selected variables against the dataset preview.",
                "Replace text columns with numeric columns, except for the DiD unit identifier.",
                f"If this still fails, Technical Detail: {detail}",
            ],
        )
    if "0 sample" in lower or "empty" in lower or "zero-size" in lower or "no observations" in lower:
        return _issue(
            "blocking",
            "No usable observations for this method",
            "After the sandbox applied the method's filtering rules, there were not enough rows left to estimate the effect.",
            [
                "Remove controls with many missing values.",
                "Choose variables that have visible data in the preview.",
                f"If this still fails, Technical Detail: {detail}",
            ],
        )
    if "needs at least" in lower or "needs observations" in lower or "needs a binary" in lower or "needs an instrument with variation" in lower:
        return _issue(
            "blocking",
            "The selected variables do not meet this method's data requirements",
            detail,
            [
                "Click Reset to restore the curated variable choices.",
                "Check that the method-specific variable is different from treatment, outcome, and controls.",
                "Use variables with enough non-missing rows and variation.",
            ],
        )
    if "only one class" in lower:
        return _issue(
            "blocking",
            "Matching needs both treated and untreated units",
            "The selected treatment column only has one group after filtering, so matching cannot form treated-control pairs.",
            [
                "Choose a binary treatment column with both 0 and 1 values.",
                "Remove controls that drop one group because of missing values.",
                f"If this still fails, Technical Detail: {detail}",
            ],
            "treatment",
        )
    if "singular" in lower or "rank" in lower or "collinear" in lower:
        return _issue(
            "blocking",
            "The selected variables duplicate too much information",
            "The model cannot separate the effect because some selected variables are perfectly or nearly perfectly redundant.",
            [
                "Remove one or more controls that measure the same thing.",
                "Do not include the treatment itself as a control.",
                f"If this still fails, Technical Detail: {detail}",
            ],
        )
    if "not defined" in lower or "nameerror" in lower:
        return _issue(
            "blocking",
            "The model received a stale variable name",
            "A variable name from an earlier selection was still being used when the estimator ran.",
            [
                "Click Reset to restore the curated variable choices.",
                "If you changed methods, re-check the method-specific fields and controls.",
                f"If this still fails, Technical Detail: {detail}",
            ],
        )

    return _issue(
        "blocking",
        f"{METHOD_LABELS.get(method, method.upper())} could not run",
        "The estimator failed after the variables passed the basic checks.",
        [
            "Click Reset to restore the curated variable choices.",
            "If you changed variables, try one change at a time and run again.",
            f"If this still fails, Technical Detail: {detail}",
        ],
    )


def estimate(qid: str, method: str, variables: VariableSelection) -> EstimateResponse:
    q = get_query_by_id(qid)
    if q is None:
        raise ValueError(f"Unknown query id: {qid}")

    method = method.lower()
    if method not in ESTIMATORS:
        raise ValueError(f"Unknown method: {method}")

    gt = GroundTruthComparison(effect=q.effect)
    df = load_df(q.dataset_path)
    issues = validate_variables(method, variables, df)
    warnings = _warnings_from_issues(issues)

    if _blocking(method, issues):
        return EstimateResponse(
            method=method,
            n_obs=0,
            ground_truth=gt,
            warnings=warnings,
            issues=issues,
            assumptions=ASSUMPTIONS[method],
            plot_type="none",
            plot_data={},
        )

    try:
        out = ESTIMATORS[method](df, variables)
    except Exception as e:
        failure = _estimation_failure_issue(method, e)
        failed_issues = issues + [failure]
        return EstimateResponse(
            method=method,
            n_obs=int(len(df)),
            ground_truth=gt,
            warnings=_warnings_from_issues(failed_issues),
            issues=failed_issues,
            assumptions=ASSUMPTIONS[method],
            plot_type="none",
            plot_data={},
        )

    # Merge extra warnings/issues from estimator.
    extra_issues = out.pop("_extra_issues", [])
    extra_warnings = out.pop("_extra_warnings", [])
    issues.extend(extra_issues)
    warnings = _warnings_from_issues(issues) + extra_warnings

    # Ground-truth comparison
    est = out.get("estimate")
    if est is not None:
        gt.delta = float(est - q.effect)
        cl = out.get("ci_low")
        ch = out.get("ci_high")
        if cl is not None and ch is not None:
            gt.within_ci = bool(cl <= q.effect <= ch)

    return EstimateResponse(
        method=method,
        ground_truth=gt,
        warnings=warnings,
        issues=issues,
        assumptions=ASSUMPTIONS[method],
        **out,
    )


# ── LLM interpretation (streaming) ─────────────────────────────────────

INTERPRET_SYSTEM_PROMPT = """You are a causal inference tutor writing for a university student with minimal math background. Given the causal query, dataset description, and the estimation result, write a brief 2-3 paragraph interpretation.

Cover:
1. What the estimate means in plain language (what it says about the real-world question).
2. How it compares to the ground-truth effect stored in metadata. Is it close? Why or why not? If warnings flag violated assumptions, mention them.
3. Which identifying assumption is most at risk for this method + data, and what would make it more believable.

Style:
- Plain language. Use LaTeX for any math, wrapped in $...$.
- Be Socratic and encouraging — pose follow-up questions where relevant.
- Keep it under ~300 words.
"""


async def interpret_result(req: InterpretRequest, api_key: Optional[str] = None):
    result = req.result
    warnings_block = "\n".join(f"- {w}" for w in result.warnings) or "(none)"
    assumptions_block = "\n".join(f"- {a}" for a in result.assumptions)

    user_prompt = f"""Causal query: {req.query}

Dataset: {req.dataset_description}

Method: {result.method.upper()}

Estimate: {result.estimate}
95% CI: [{result.ci_low}, {result.ci_high}]
Standard error: {result.std_error}
p-value: {result.p_value}
Observations: {result.n_obs}

Ground-truth effect (from metadata): {result.ground_truth.effect}
Delta (estimate - ground_truth): {result.ground_truth.delta}
Estimate within 95% CI of ground truth: {result.ground_truth.within_ci}

Warnings:
{warnings_block}

Identifying assumptions for {result.method.upper()}:
{assumptions_block}
"""

    completion = await _get_client(api_key).chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": INTERPRET_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        stream=True,
    )
    return completion
