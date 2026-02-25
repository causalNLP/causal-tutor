from typing import Dict, List, Any

# Curriculum Data Structure
# Defines the 10 Core Methods for the Learning Mode

CURRICULUM_METHODS: Dict[str, Dict[str, Any]] = {
    "difference_in_differences": {
        "title": "Difference-in-Differences (DiD)",
        "slug": "did",
        "description": "Difference-in-Differences (DiD) is a quasi-experimental approach that estimates the causal effect of a treatment or intervention. It does this by comparing the changes in outcomes over time between a group that is enrolled in a program (the treatment group) and a group that is not (the control group). The core intuition is that any baseline differences between the groups are 'differenced out', and any time trends that affect both groups equally are also 'differenced out'. What remains is the isolated effect of the treatment.",
        "key_assumptions": [
            "Parallel Trends: The most critical assumption. It states that in the absence of treatment, the difference between the treatment and control groups would have remained constant over time. If their trajectories were already diverging before the intervention, DiD will yield biased results.",
            "No Spillover Effects (SUTVA): The treatment of one unit does not affect the outcomes of the control units.",
            "No Anticipation: The treatment group does not change its behavior prior to the actual implementation of the policy in anticipation of it."
        ],
        "example_scenario": "Measuring the effect of a minimum wage increase in New Jersey (Treatment) by comparing it to Pennsylvania (Control, where it didn't change). By looking at employment levels before and after the law change in both states, researchers can isolate the effect of the wage hike.",
        "dag_mermaid": """graph LR
    U((Unobserved\nState Traits)) --> Group
    U --> Y
    T[Treatment] --> Y
    Time[Time] --> Y
    Group[Group ID] --> Y
    Group --> T
    Time --> T
    style T fill:#d1e7dd,stroke:#0f5132
    style Y fill:#e2e3e5,stroke:#41464b
"""
    },
    "instrumental_variables": {
        "title": "Instrumental Variables (IV)",
        "slug": "iv",
        "description": "Instrumental Variables (IV) is used to estimate causal relationships when the treatment variable is correlated with the error term (endogeneity). This often happens due to omitted variable bias or reverse causality. An 'instrument' (Z) is a third variable that induces variation in the treatment (D) but has no direct effect on the outcome (Y), other than through its effect on D.",
        "key_assumptions": [
            "Relevance: The instrument (Z) must be strongly correlated with the treatment (D). (Cov(Z, D) ≠ 0). If this correlation is weak, it is called a 'weak instrument', which can severely bias results.",
            "Exclusion Restriction: The instrument (Z) affects the outcome (Y) ONLY through the treatment (D). It cannot be correlated with any unobserved confounders (U). (Cov(Z, U) = 0).",
            "Monotonicity (for LATE): The instrument pushes everyone in the same direction. There are no 'defiers' who do the exact opposite of what the instrument encourages."
        ],
        "example_scenario": "Estimating the return to schooling (effect of Education on Wages). Education is endogenous because 'innate ability' affects both. We use 'Distance to the nearest college' as an instrument. It affects whether you go to college (Relevance), but shouldn't directly affect your future wages other than through education (Exclusion Restriction).",
        "dag_mermaid": """graph LR
    Z[Instrument:\nDistance] --> D[Treatment:\nEducation]
    D --> Y[Outcome:\nWages]
    U((Confounder:\nAbility)) -.-> D
    U -.-> Y
    Z -.-x Y
    Z -.-x U
    style Z fill:#cfe2ff,stroke:#084298
    style D fill:#d1e7dd,stroke:#0f5132
"""
    },
    "regression_discontinuity": {
        "title": "Regression Discontinuity Design (RDD)",
        "slug": "rdd",
        "description": "Regression Discontinuity Design (RDD) is a method that elicits causal effects by exploiting a strict cutoff or threshold in an assignment variable (also called a running variable). The intuition is that units just below the cutoff and just above the cutoff are virtually identical in all unobserved characteristics. Therefore, crossing the threshold acts like a randomized experiment localized around that specific point.",
        "key_assumptions": [
            "Continuity: The conditional expectation of the potential outcomes must be continuous at the cutoff. In other words, nothing else changes abruptly at the threshold except the treatment assignment.",
            "No Manipulation (McCrary Density Test): Individuals cannot precisely manipulate their assignment variable to push themselves over the threshold. If they can, the 'as-good-as-random' assignment is violated."
        ],
        "example_scenario": "Estimating the effect of receiving a merit-based scholarship on future earnings. The scholarship is awarded strictly to students who score > 80 on an exam. We compare students who scored 79.9 (didn't get it) with students who scored 80.1 (got it), assuming these two groups are fundamentally identical.",
        "dag_mermaid": """graph LR
    R[Running Variable:\nTest Score] --> T[Treatment:\nScholarship]
    T --> Y[Outcome:\nEarnings]
    R --> Y
    U((Confounder:\nAbility)) -.-> Y
    U -.-> R
    style R fill:#fff3cd,stroke:#664d03
    style T fill:#d1e7dd,stroke:#0f5132
"""
    },
    "propensity_score_matching": {
        "title": "Propensity Score Matching (PSM)",
        "slug": "psm",
        "description": "PSM attempts to estimate the effect of a treatment by accounting for the covariates that predict receiving the treatment. It reduces a high-dimensional set of covariates into a single score: the 'propensity score' (the probability of receiving treatment). Treated units are then matched to control units with similar propensity scores to create a balanced comparison.",
        "key_assumptions": [
            "Conditional Independence Assumption (CIA) / Unconfoundedness: All variables that affect both treatment assignment and the outcome are observed and included in the model. There is no unmeasured confounding.",
            "Common Support: There must be an overlap in the propensity score distributions between the treated and control groups. For every treated unit, there must be a comparable control unit."
        ],
        "example_scenario": "Evaluating the impact of a voluntary job training program on wages. Because workers choose to participate, the treated group is fundamentally different. We calculate the propensity to join the program based on age, education, and past income, and match treated workers to non-treated workers with identical scores.",
        "dag_mermaid": """graph LR
    X[Observed\nCovariates] --> T[Treatment]
    X --> Y[Outcome]
    T --> Y
    U((Unobserved\nConfounders)) -.-x T
    style X fill:#e2e3e5,stroke:#41464b
    style T fill:#d1e7dd,stroke:#0f5132
"""
    },
    "synthetic_control": {
        "title": "Synthetic Control Method",
        "slug": "synthetic-control",
        "description": "The Synthetic Control method is an evolution of DiD used primarily for comparative case studies when there is only one (or very few) treated units (e.g., a state or country). Instead of picking a single control region or a simple average of all regions, it uses an algorithm to construct a 'synthetic' counterfactual unit by finding the optimal weighted combination of untreated units that perfectly mimics the treated unit's behavior before the intervention.",
        "key_assumptions": [
            "Perfect Pre-Trend Fit: The synthetic unit must closely track the treated unit in the pre-intervention period for an extended amount of time.",
            "No Spillover: The treatment in the affected unit must not affect the outcomes in the 'donor pool' of control units used to build the synthetic counterfactual.",
            "No Structural Breaks: The relationship between the treated unit and the donor pool must remain stable post-intervention (except for the treatment effect)."
        ],
        "example_scenario": "Estimating the effect of California's Proposition 99 (a massive tobacco tax) on cigarette sales. Researchers created a 'Synthetic California' out of a weighted average of other states (e.g., 20% Nevada, 30% Utah, etc.) that exactly matched California's smoking trends before the tax.",
        "dag_mermaid": """graph LR
    W[Optimal Weights] --> S[Synthetic Control]
    S --> Y0[Counterfactual\nOutcome]
    T[Treatment\nUnit] --> Y1[Observed\nOutcome]
    Y1 --- Y0
    linkStyle 3 stroke-width:0px,fill:none
"""
    },
    "frontdoor_criterion": {
        "title": "Frontdoor Criterion",
        "slug": "frontdoor",
        "description": "A less common but powerful method introduced by Judea Pearl. It allows for causal identification even when there is unobserved confounding between the treatment and outcome. It works by finding a 'mediator' variable that lies entirely on the causal path between treatment and outcome.",
        "key_assumptions": [
            "Exhaustive Mechanism: The treatment affects the outcome ONLY through the mediator (M). There are no direct paths from T to Y.",
            "No Unblocked Backdoors to Mediator: There is no unobserved confounding between the Treatment (T) and the Mediator (M), OR between the Mediator (M) and the Outcome (Y)."
        ],
        "example_scenario": "Does smoking (T) cause lung cancer (Y)? There is an unobserved genetic confounder (U) that makes people crave nicotine AND independently causes cancer. However, smoking causes the accumulation of Tar (M) in the lungs, and Tar causes cancer. If genetics do not directly cause Tar accumulation, we can use the Frontdoor Criterion to calculate the true effect.",
        "dag_mermaid": """graph LR
    T[Treatment:\nSmoking] --> M[Mediator:\nTar]
    M --> Y[Outcome:\nCancer]
    U((Confounder:\nGenetics)) -.-> T
    U -.-> Y
    style M fill:#d1e7dd,stroke:#0f5132
"""
    },
    "randomized_control_trial": {
        "title": "Randomized Control Trial (RCT)",
        "slug": "rct",
        "description": "RCTs are the 'gold standard' of causal inference. By randomly assigning subjects to treatment and control groups, researchers ensure that the two groups are statistically identical on average, in both observed and unobserved characteristics. This eliminates selection bias entirely.",
        "key_assumptions": [
            "SUTVA (Stable Unit Treatment Value Assumption): The treatment assigned to one unit does not affect the potential outcomes of another unit. (No interference/spillover).",
            "Perfect Compliance: Subjects actually receive the treatment they were assigned to (no non-compliance or attrition).",
            "Excludability: The assignment itself does not affect the outcome, only the actual treatment does (hence the need for Placebos/Blinding)."
        ],
        "example_scenario": "Testing the efficacy of a new drug. 1,000 patients are randomly assigned to either receive the active drug or an identical-looking sugar pill (placebo). Because of randomization, we can assume the groups have identical health backgrounds.",
        "dag_mermaid": """graph LR
    R[Random\nAssignment] --> T[Treatment]
    T --> Y[Outcome]
    U((Unobserved\nConfounders)) -.-> Y
    R -.-x U
    style R fill:#d1e7dd,stroke:#0f5132
"""
    },
    "fixed_effects": {
        "title": "Fixed Effects (Panel Data)",
        "slug": "fixed-effects",
        "description": "Fixed Effects models are used with panel data (data where the same individuals or entities are observed over multiple time periods). They control for all unobserved variables that are constant over time within an entity, effectively using each entity as its own control.",
        "key_assumptions": [
            "Strict Exogeneity: The idiosyncratic error term must be uncorrelated with the treatment variable across all time periods.",
            "Time-Invariant Confounders Only: This method ONLY controls for unobserved factors that do not change over time (e.g., innate intelligence, geographic location). It does NOT control for time-varying confounders (e.g., a sudden change in health)."
        ],
        "example_scenario": "Estimating the effect of getting married on men's wages. 'Innate drive' might cause both marriage and higher wages (a confounder). By tracking the *same* men before and after they get married (person-fixed effects), we difference out their constant innate drive.",
        "dag_mermaid": """graph LR
    T[Treatment\nin year t] --> Y[Outcome\nin year t]
    U((Time-Invariant\nUnobserved\ne.g. Ability)) -.-> T
    U -.-> Y
    V((Time-Varying\nUnobserved)) -.-> T
    V -.-> Y
    style U stroke-dasharray: 5 5
"""
    },
    "selection_models": {
        "title": "Heckman Selection Model",
        "slug": "heckman",
        "description": "The Heckman correction addresses sample selection bias, which occurs when the data we observe is not a random sample of the population. It uses a two-step statistical approach: first, it models the probability that an observation is included in the sample (the selection equation), and second, it incorporates this probability into the main outcome equation.",
        "key_assumptions": [
            "Exclusion Restriction: You need at least one variable (Z) that strongly predicts whether an observation is selected into the sample, but has NO direct effect on the main outcome of interest (Y).",
            "Joint Normality: Classical Heckman relies on the strong assumption that the error terms of the selection equation and the outcome equation are jointly normally distributed."
        ],
        "example_scenario": "Estimating the effect of education on wage offers for women. The problem: we only observe wages for women who choose to work. Women with very low wage offers might choose to stay home, skewing the observed data upwards. We use 'number of young children' as an exclusion restriction—it affects the decision to work (selection), but theoretically shouldn't affect the wage offer itself.",
        "dag_mermaid": """graph LR
    Z[Selection Var:\nNum Children] --> S[Selected into\nSample?]
    T[Treatment:\nEducation] --> Y[Outcome:\nWage Offer]
    Y -.-> S
    U((Unobserved\nFactors)) -.-> S
    U -.-> Y
    style S fill:#fff3cd,stroke:#664d03
"""
    },
    "causal_forests": {
        "title": "Causal Forests (Machine Learning)",
        "slug": "causal-forests",
        "description": "Causal Forests are an extension of Random Forests designed to estimate Heterogeneous Treatment Effects (HTE). Instead of calculating one average treatment effect for everyone, it uses machine learning to figure out how the treatment effect varies across different subgroups based on a high number of covariates.",
        "key_assumptions": [
            "Unconfoundedness (CIA): Just like Propensity Score Matching, Causal Forests assume that all confounders are observed. There can be no hidden variables driving both treatment and outcome.",
            "Overlap (Positivity): Every type of person in the dataset must have a non-zero probability of receiving the treatment and a non-zero probability of being in the control group."
        ],
        "example_scenario": "A tech company wants to know the effect of sending a discount email. Instead of asking 'Did it work on average?', they use a Causal Forest to discover that the email was highly effective for users under 30 who haven't purchased in 3 months, but actually decreased purchasing among users over 50.",
        "dag_mermaid": """graph LR
    X[High-Dim\nCovariates] --> T[Treatment]
    X --> Y[Outcome]
    T --> Y
    X -.-> effect((Treatment\nEffect Size))
    effect -.-> Y
    style X fill:#cfe2ff,stroke:#084298
"""
    }
}
