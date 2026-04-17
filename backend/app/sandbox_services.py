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
    InterpretRequest,
)

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

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

def validate_variables(method: str, v: VariableSelection) -> List[str]:
    """Return warnings (empty list if OK). Blocking issues return a warning; the estimator then returns estimate=None."""
    warnings = []
    if method == "iv" and not v.instrument:
        warnings.append("IV requires an instrument variable. Pick one from the dataset.")
    if method == "did":
        if not v.temporal_var:
            warnings.append("DiD requires a time variable (temporal_var).")
        if not v.state_var:
            warnings.append("DiD requires a unit/entity variable (state_var).")
    if method == "rdd" and not v.running_var:
        warnings.append("RDD requires a running variable.")
    if method == "frontdoor" and not v.mediator:
        warnings.append("Frontdoor requires a mediator variable.")
    if method == "matching" and not v.controls:
        warnings.append("Matching requires at least one covariate.")
    return warnings


def _blocking(method: str, warnings: List[str]) -> bool:
    """Check if warnings block estimation."""
    for w in warnings:
        if "requires" in w:
            return True
    return False


# ── Estimators ────────────────────────────────────────────────────────

def _sanitize_cols(df: pd.DataFrame, cols: List[str]) -> List[str]:
    return [c for c in cols if c in df.columns]


def estimate_ols(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    controls = _sanitize_cols(df, v.controls)
    X_cols = [v.treatment] + controls
    X = df[X_cols].astype(float)
    X = sm.add_constant(X)
    y = df[v.outcome].astype(float)

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
        "n_obs": int(len(df)),
        "plot_type": "forest",
        "plot_data": {"terms": terms},
    }


def estimate_did(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.formula.api as smf

    # Identify treated units
    unit_max = df.groupby(v.state_var)[v.treatment].max()
    treated_units = unit_max[unit_max == 1].index
    df = df.copy()
    df["__treated_group__"] = df[v.state_var].isin(treated_units).astype(int)

    # Treatment start: earliest time where any unit has T=1
    if (df[v.treatment] == 1).any():
        treatment_start = int(df.loc[df[v.treatment] == 1, v.temporal_var].min())
    else:
        treatment_start = int(df[v.temporal_var].median())

    # TWFE regression with treatment-period interaction
    # Rename columns to avoid patsy issues with spaces
    df_f = df.rename(columns={v.treatment: "T", v.outcome: "Y", v.temporal_var: "TIME", v.state_var: "UNIT"})
    controls = _sanitize_cols(df, v.controls)
    for c in controls:
        df_f = df_f.rename(columns={c: f"C_{c}"}) if c in df_f.columns else df_f
    c_formula = " + ".join(f"C_{c}" for c in controls) if controls else ""
    formula = "Y ~ T + C(UNIT) + C(TIME)"
    if c_formula:
        formula += f" + {c_formula}"
    model = smf.ols(formula=formula, data=df_f).fit()

    coef = float(model.params["T"])
    se = float(model.bse["T"])
    pval = float(model.pvalues["T"])
    ci = model.conf_int().loc["T"].tolist()

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
    pt_warning, pt_diag = _check_parallel_trends(df, v, pre_periods, treated_mean, control_mean, periods)

    warnings_extra = [pt_warning] if pt_warning else []

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
        "_extra_warnings": warnings_extra,
    }


def _check_parallel_trends(df, v, pre_periods, treated_mean, control_mean, periods) -> Tuple[Optional[str], Dict[str, Any]]:
    if len(pre_periods) < 2:
        return "Parallel trends unidentified (fewer than 2 pre-treatment periods).", {}

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
        return f"Parallel trends likely violated (slope diff {delta:.2f}, {pct}% of outcome SD).", diag
    return None, diag


def estimate_iv(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    from linearmodels.iv import IV2SLS
    import statsmodels.api as sm

    controls = _sanitize_cols(df, v.controls)
    df_clean = df[[v.outcome, v.treatment, v.instrument] + controls].dropna().astype(float)

    # IV2SLS: Y ~ 1 + controls + [T ~ Z]
    exog_cols = ["const"] + controls
    exog = sm.add_constant(df_clean[controls]) if controls else pd.DataFrame({"const": np.ones(len(df_clean))}, index=df_clean.index)
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
    X_fs = sm.add_constant(df_clean[[v.instrument] + controls])
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
        extras.append(f"Weak instrument: first-stage F = {f_stat:.2f} (< 10). Estimate may be biased.")

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
        "_extra_warnings": extras,
    }


def estimate_rdd(df: pd.DataFrame, v: VariableSelection) -> Dict[str, Any]:
    import statsmodels.api as sm

    R = v.running_var
    c = v.cutoff if v.cutoff is not None else float(df[R].median())

    # Bandwidth: Silverman's rule
    sigma = float(df[R].std())
    n = len(df)
    h = 1.06 * sigma * (n ** (-1 / 5))

    window = df[(df[R] >= c - h) & (df[R] <= c + h)].copy()
    window["__above__"] = (window[R] >= c).astype(int)
    window["__R_centered__"] = window[R] - c
    window["__interaction__"] = window["__above__"] * window["__R_centered__"]

    # Local linear: Y = a + b*above + gamma*(R-c) + delta*above*(R-c) + errors
    X = sm.add_constant(window[["__above__", "__R_centered__", "__interaction__"]])
    y = window[v.outcome].astype(float)
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
    bins = np.linspace(df[R].min(), df[R].max(), n_bins + 1)
    df["__bin__"] = pd.cut(df[R], bins, include_lowest=True)
    binned = df.groupby("__bin__").agg(r=(R, "mean"), y=(v.outcome, "mean")).dropna().reset_index(drop=True)
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

    controls = _sanitize_cols(df, v.controls)
    X = df[controls].astype(float).values
    T = df[v.treatment].astype(int).values
    Y = df[v.outcome].astype(float).values

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
    controls = _sanitize_cols(df, v.controls)

    df_clean = df[[T, M, Y] + controls].dropna().astype(float)

    # Stage 1: M ~ T (+ controls) → coef a
    X1 = sm.add_constant(df_clean[[T] + controls])
    m1 = sm.OLS(df_clean[M], X1).fit()
    a = float(m1.params[T])
    a_se = float(m1.bse[T])

    # Stage 2: Y ~ M + T (+ controls) → coef b on M
    X2 = sm.add_constant(df_clean[[M, T] + controls])
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


def estimate(qid: str, method: str, variables: VariableSelection) -> EstimateResponse:
    q = get_query_by_id(qid)
    if q is None:
        raise ValueError(f"Unknown query id: {qid}")

    method = method.lower()
    if method not in ESTIMATORS:
        raise ValueError(f"Unknown method: {method}")

    warnings = validate_variables(method, variables)
    gt = GroundTruthComparison(effect=q.effect)

    if _blocking(method, warnings):
        return EstimateResponse(
            method=method,
            n_obs=0,
            ground_truth=gt,
            warnings=warnings,
            assumptions=ASSUMPTIONS[method],
            plot_type="none",
            plot_data={},
        )

    df = load_df(q.dataset_path)

    try:
        out = ESTIMATORS[method](df, variables)
    except Exception as e:
        return EstimateResponse(
            method=method,
            n_obs=int(len(df)),
            ground_truth=gt,
            warnings=warnings + [f"Estimation error: {str(e)[:200]}"],
            assumptions=ASSUMPTIONS[method],
            plot_type="none",
            plot_data={},
        )

    # Merge extra warnings from estimator
    extra = out.pop("_extra_warnings", [])
    warnings.extend(extra)

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


async def interpret_result(req: InterpretRequest):
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

    completion = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": INTERPRET_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        stream=True,
    )
    return completion
