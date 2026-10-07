"""Primer content: structured sections with markdown text and optional DAG definitions.

Each section has:
  id          – slug identifier
  title       – display heading
  markdown    – the body text (supports headings, lists, bold, etc.)
  dag         – optional single interactive DAG: dict with nodes/edges
  dags        – optional list of small DAGs shown together in a grid, each
                as {"id", "label", "dag": {...}} — used when several
                diagrams need to sit side by side (e.g. d-separation's
                four structures crossed with active/inactive, or a
                before/after do-intervention pair). Currently unused —
                d-separation and interventions use static `image`s instead
                while the grid layout gets revisited.
  dagsLayout  – optional {"rows", "cols"} hint for arranging `dags`
  image       – optional base64 data URL or static path, shown in the side
                panel when there's no `dag`/`dags`

Node objects (in `dag` or any entry of `dags`) support:
  isLatent    – bool, renders as a dashed-outline circle
  conditioned – bool, renders as a filled/accent-colored node instead of
                an outlined one (used to show a variable being conditioned on)

Edge objects support:
  type: "severed" – renders as a dashed, muted-grey arrow instead of a
                     solid accent-colored one (used to show an edge cut by
                     a do-intervention)
"""

import base64
import os
from typing import Optional

PRIMER_SECTIONS: list[dict] = [
    {
        "id": "why-causality-matters",
        "title": "Why Causality Matters",
        "markdown": (
            "*(Reference: Bijan Mazaheri, Principles of Causality)*\n\n"
            "Helmets increase head injuries. Faster drivers arrive later. Hospital "
            "patients are less likely to have cancer when their bones are broken. "
            "But don't throw your helmet, break your leg, or invest in transportation "
            "inefficiency just yet... Causality is the foundation of science and "
            "policy, but causal relationships can be obscured by a labyrinth of "
            "correlations.\n\n"
            "Causality is, at its core, about disentangling signals: causal from "
            "spurious (false), direct from indirect, and anomalies from different "
            "root causes. To show you how dangerous it can be to confuse correlation "
            "in your data with real cause and effect, we can study an example: "
            "Simpson's Paradox.\n\n"
            "Simpson's Paradox occurs when a trend that appears in different groups "
            "of data reverses or disappears when the groups are combined.\n\n"
            "### Case Study: Berkeley Admissions\n\n"
            "In 1973, UC Berkeley was sued for sex discrimination: 44% of male "
            "applicants were admitted, versus only 35% of female students. But "
            "broken down department by department, the vast majority of departments "
            "actually admitted women at *higher* rates than men, and the ones that "
            "did admit more men were only barely out-admitting the women!\n\n"
            "| Department | Men | Women |\n"
            "|---|---|---|\n"
            "| Not-Selective | 100 applied, 90% accepted | 10 applied, 100% accepted |\n"
            "| Selective | 10 applied, 10% accepted | 100 applied, 20% accepted |\n\n"
            "*Table 1: A simplified specification of counts for the Berkeley "
            "admissions data demonstrating Simpson's Paradox.*\n\n"
            "As it turns out, women applied disproportionately to the more "
            "selective departments: pooling the departments together buried the "
            "true per-department pattern.\n\n"
            "This tells us that more data, if pooled the wrong way, can create a "
            "paradox out of thin air. The idea is to know which variable is really "
            "causing the other, and that is exactly what a causal diagram tells you."
        ),
    },
    {
        "id": "what-is-a-dag",
        "title": "What is a DAG?",
        "markdown": (
            "A causal diagram, or a DAG (**D**irected **A**cyclic **G**raph) is the "
            "visualization of your system: nodes represent variables (e.g., gender, "
            "acceptance rate) and the arrows represent a direct causal influence. "
            "Causal arrows always have a direction, and that direction matters. "
            "Consider: Raining → Umbrella. Those two variables are highly "
            "correlated, but if we intervene on the weather (e.g., seed the "
            "clouds), the use of umbrellas changes. But if we intervene on the "
            "umbrella, the rain does not change. This tells us that causality is "
            "fundamentally asymmetric.\n\n"
            "Every causal diagram, no matter how large, is built from three basic "
            "three-node shapes."
        ),
        "dag": {
            "nodes": [
                {"id": "A", "data": {"label": "Raining"}, "position": {"x": 80, "y": 200}},
                {"id": "C", "data": {"label": "Umbrella"}, "position": {"x": 300, "y": 200}},
            ],
            "edges": [
                {"id": "e1", "source": "A", "target": "C", "type": "deletable"},
            ],
        },
    },
    {
        "id": "confounders",
        "title": "Confounders",
        "markdown": (
            "Confounders, or forks, represent a common cause where *B* causes both "
            "*A* and *C*, creating a spurious correlation between them. In this "
            "kind of structure, *conditioning* (i.e., holding a variable constant, "
            "or restricting to a specific value) is good. By holding the "
            "confounder constant, we block the spurious correlation between "
            "them.\n\n"
            "**Example:** A global health study might find that cholesterol is "
            "negatively associated with mortality! But this is only because "
            "malnutrition (low cholesterol, high mortality) is driving both. This "
            "means we need to evaluate the real causal effect by looking at the "
            "data \"per nutrition level\"."
        ),
        "dag": {
            "nodes": [
                {"id": "B", "data": {"label": "B"}, "position": {"x": 220, "y": 40}},
                {"id": "A", "data": {"label": "A"}, "position": {"x": 80, "y": 200}},
                {"id": "C", "data": {"label": "C"}, "position": {"x": 360, "y": 200}},
            ],
            "edges": [
                {"id": "e1", "source": "B", "target": "A", "type": "deletable"},
                {"id": "e2", "source": "B", "target": "C", "type": "deletable"},
            ],
        },
    },
    {
        "id": "colliders",
        "title": "Colliders",
        "markdown": (
            "Colliders, also known as common effects, happen when two variables "
            "share a common effect. In this case, conditioning on the common "
            "effect ends up *creating* a spurious dependence between two otherwise "
            "independent variables. This is sometimes known as Berkson's "
            "Paradox, or selection bias.\n\n"
            "**Example:** Early during COVID-19, hospital records showed that "
            "smokers had *fewer* COVID-19 cases. But this data looks only at "
            "hospital records! Here, admittance to the hospital acts as a "
            "collider: patients need to be in the hospital for some reason, and "
            "if you don't have COVID-19, it may be that you were admitted due to "
            "smoking-related illness, creating a spurious negative association "
            "between smoking and COVID-19."
        ),
        "dag": {
            "nodes": [
                {"id": "A", "data": {"label": "A"}, "position": {"x": 80, "y": 40}},
                {"id": "C", "data": {"label": "C"}, "position": {"x": 360, "y": 40}},
                {"id": "B", "data": {"label": "B"}, "position": {"x": 220, "y": 200}},
            ],
            "edges": [
                {"id": "e1", "source": "A", "target": "B", "type": "deletable"},
                {"id": "e2", "source": "C", "target": "B", "type": "deletable"},
            ],
        },
    },
    {
        "id": "mediators",
        "title": "Mediators",
        "markdown": (
            "Mediators, or chains, are what happens when a variable causes "
            "another, which in turn causes another. Conditioning on the mediator "
            "(the intermediate variable) blocks the flow of association, part of "
            "the very effect you are trying to measure.\n\n"
            "**Example:** Getting some tutoring on the side will improve your "
            "study habits, which in turn improves your exam score. This "
            "correlation represents the total effect of tutoring. If you "
            "condition on the study habits, you block the very pathway that "
            "tutoring uses to help you."
        ),
        "dag": {
            "nodes": [
                {"id": "A", "data": {"label": "A"}, "position": {"x": 40, "y": 120}},
                {"id": "B", "data": {"label": "B"}, "position": {"x": 240, "y": 120}},
                {"id": "C", "data": {"label": "C"}, "position": {"x": 440, "y": 120}},
            ],
            "edges": [
                {"id": "e1", "source": "A", "target": "B", "type": "deletable"},
                {"id": "e2", "source": "B", "target": "C", "type": "deletable"},
            ],
        },
    },
    {
        "id": "d-separation",
        "title": "D-Separation",
        "markdown": (
            "Association flows freely through unconditioned chains and forks, "
            "but is naturally blocked by unconditioned colliders. Conditioning "
            "reverses this: it blocks chains and forks, but *unblocks* "
            "colliders.\n\n"
            "Notice that we have introduced a fourth structure: a conditioned "
            "descendant of a collider. Because a descendant is essentially a noisy "
            "measurement of the collider, conditioning on it partially unblocks "
            "the collider, allowing some dependence to leak through.\n\n"
            "| Structure | Unconditioned | Conditioned |\n"
            "|---|---|---|\n"
            "| Chain (A → B → C) | Active | Blocked |\n"
            "| Fork (A ← B → C) | Active | Blocked |\n"
            "| Collider (A → B ← C) | Blocked | Active |\n"
            "| Descendant of a collider | Blocked | Partially active |\n\n"
            "*Table 2: The four atomic structures governing the flow of "
            "statistical dependence.*\n\n"
            "These atomic structures compose to explain how information flows "
            "through long sequences of variables. This gives rise to "
            "**d-separation** (directed separation), providing a definitive algorithmic "
            "test for whether two variables are dependent or independent in a "
            "DAG.\n\n"
            "Given a DAG, two variables are **d-separated** given a conditioning "
            "set *Z* if there are no active paths between them. If at least one "
            "active path remains relative to *Z*, the variables are "
            "**d-connected**."
        ),
        "image": None,  # set below — expects diagrams/dseparation.png
    },
    {
        "id": "backdoor-criterion",
        "title": "Backdoor Paths & the Backdoor Criterion",
        "markdown": (
            "We have learned that an active path acts like an open channel that carries statistical "
            "dependence, and d-separation corresponds to the absence of that dependence.\n\n"
            "Whenever an association is detected between a treatment *A* and an "
            "outcome *Y*, it usually stems from a blend of two distinct "
            "forces:\n\n"
            "1. **Causal channels**: Directed routes progressing directly from *A* "
            "to *Y* (e.g., A → Y).\n"
            "2. **Backdoor channels**: spurious, non-causal routes featuring an "
            "arrow pointing directly *into* A (e.g., A ← C → Y).\n\n"
            "Finding the true causal effect requires adjusting for a set of "
            "variables that blocks every backdoor path, paths that sneak in "
            "through the \"back door\" of the treatment node (pointing into *A*) "
            "to create undirected, spurious correlations.\n\n"
            "A set of variables *X* satisfies the **backdoor criterion** with "
            "respect to treatment *A* and outcome *Y* if:\n\n"
            "1. No node in *X* is a descendant of *A* (we do not condition on "
            "effects of the treatment).\n"
            "2. *X* blocks every backdoor path from *A* to *Y* (via standard "
            "d-separation rules)."
        ),
        "dag": {
            "nodes": [
                {"id": "C", "data": {"label": "C"}, "position": {"x": 220, "y": 40}},
                {"id": "A", "data": {"label": "A"}, "position": {"x": 80, "y": 200}},
                {"id": "Y", "data": {"label": "Y"}, "position": {"x": 360, "y": 200}},
            ],
            "edges": [
                {"id": "e1", "source": "C", "target": "A", "type": "deletable"},
                {"id": "e2", "source": "C", "target": "Y", "type": "deletable"},
                {"id": "e3", "source": "A", "target": "Y", "type": "deletable"},
            ],
        },
    },
    {
        "id": "pearls-ladder",
        "title": "Pearl's Ladder",
        "markdown": (
            "In 2009, Judea Pearl organized causal questions into three rungs of "
            "increasing difficulty, and required assumptions.\n\n"
            "1. **Association (seeing):** what does a survey tell us about the "
            "current world? This is standard probability, like $\\Pr(Y \\mid X)$. As seen "
            "in Simpson's Paradox, this rung is highly vulnerable to "
            "confounding.\n\n"
            "2. **Intervention (doing):** what *would* happen if we force a "
            "change in the world for a group of people? This is an interventional "
            "probability, denoted $\\Pr(Y \\mid \\text{do}(X))$. Answering these questions "
            "requires a causal diagram to know what variables to hold "
            "constant.\n\n"
            "3. **Counterfactuals (imagining):** what *would have* happened to "
            "this specific *individual* if things had been different? Answering "
            "these questions requires knowing the underlying structural equations "
            "of the system.\n\n"
            "| Rung | Question | Requires |\n"
            "|---|---|---|\n"
            "| 3. Counterfactuals (Imagining) | What if things had been "
            "different for this individual? | Structural Equations |\n"
            "| 2. Intervention (Doing) | What if we do X? How will the system "
            "react? | Causal Diagrams |\n"
            "| 1. Association (Seeing) | What might happen in the future? How "
            "are variables related? | — |\n\n"
            "*Table 3: Pearl's Ladder of Causation. Standard statistics "
            "operates entirely on Rung 1. Moving to Rung 2 requires a causal "
            "diagram, and moving to Rung 3 requires structural equations.*"
        ),
        "image": None,  # set below after module-level image load
    },
    {
        "id": "potential-outcomes",
        "title": "Potential Outcomes & Fundamental Problem",
        "markdown": (
            "Having established that answering individual counterfactual "
            "queries requires a deep understanding of the system's structural "
            "equation. To formalize these \"Imagining\" queries mathematically, "
            "statisticians like Jerzy Neyman and Donald Rubin developed the "
            "Potential Outcomes framework.\n\n"
            "We define two \"potential outcomes\" that represent the true "
            "outcome of a candidate if they were not treated "
            "($Y^{A=0} = Y(0)$) or treated ($Y^{A=1} = Y(1)$). The "
            "individual treatment effect (ITE) is the difference between "
            "these two parallel realities:\n\n"
            "$$\nITE = Y(1) - Y(0)\n$$\n\n"
            "However, in real life, we either give a patient treatment or we "
            "do not–we cannot rewind time, change the course of action, and "
            "observe the alternate reality. Because of this, causal inference "
            "is sometimes interpreted as a \"missing data\" problem.\n\n"
            "This dilemma is known as the \"fundamental problem of causal "
            "inference\".\n\n"
            "Instead of agonizing over the missing data for an individual, we "
            "can look at the expected value of the difference over a "
            "population. This aggregate metric is known as the Average "
            "Treatment Effect (ATE):\n\n"
            "$$\nATE = \\mathbb{E}[Y(1)] - \\mathbb{E}[Y(0)]\n$$\n\n"
            "If we could somehow replace the unobservable counterfactual "
            "expectation with the observable conditional expectation, we "
            "would be able to learn the ATE directly from our data.\n\n"
            "However, this fails whenever treatment is confounded. For "
            "instance, doctors usually prescribe heavy treatment to the "
            "sickest patients, yielding treated groups that are composed of "
            "significantly more severe cases than untreated groups.\n\n"
            "The classic fix is randomization: by randomly assigning "
            "treatment, we ensure that, in the limit of a large sample size, "
            "the expected baseline characteristics of both groups are "
            "perfectly identical."
        ),
    },
    {
        "id": "structural-causal-models",
        "title": "Structural Causal Models",
        "markdown": (
            "A structural causal model (SCM) formalizes how the world generates "
            "data. Each variable is represented as some function of its parents "
            "in the graph, plus background or external noise (exogenous) that "
            "introduces randomness or unobserved influence."
        ),
    },
    {
        "id": "noise-term",
        "title": "Why the Noise Term Matters",
        "markdown": (
            "It is those unobserved error terms that make observational causal "
            "inference mathematically possible. If we lacked an error term, a "
            "variable would be a purely deterministic function of its observed "
            "parents. By injecting this \"wobble\" (e.g., a doctor's subjective "
            "preference for a treatment, random traffic delays) into the "
            "equation, it grants us the overlap needed to compute "
            "counterfactuals.\n\n"
            "We also assume the unobserved background noise is completely "
            "independent of the background noise for every other variable."
        ),
    },
    {
        "id": "interventions",
        "title": "Interventions",
        "markdown": (
            "What if we actively manipulate the natural data-generating "
            "process? The classic manipulation is the **do-intervention** "
            "(often called a \"hard\" intervention). After intervening on a "
            "variable, all incoming edges into it are severed, therefore "
            "mutilating the DAG.\n\n"
            "When we apply $\\text{do}(A = a)$, we reach into the system and force *A* "
            "to take on a specific, deterministic value *a*, regardless of "
            "whatever natural causes usually influence it.\n\n"
            "A **soft intervention**, by contrast, is when the new mechanism "
            "still depends on the variable's natural parents, just shifted."
        ),
        "image": None,  # set below — expects diagrams/dointervention.png
    },
    {
        "id": "counterfactuals",
        "title": "Counterfactuals",
        "markdown": (
            "Computing a counterfactual involves Pearl's three-step "
            "procedure:\n\n"
            "1. **Abduct** the noise term from a given observation by "
            "substituting into the structural equation.\n"
            "2. **Act** by intervening on the variable of interest.\n"
            "3. **Predict** by running the structural equations forward using "
            "the abducted noise to get the counterfactual outcome."
        ),
    },
]

# Load diagram images as base64 data URLs and attach them to sections.
# Save your source PNGs into diagrams/ with these exact filenames.
_diagrams_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "diagrams")

with open(os.path.join(_diagrams_dir, "causalladder.png"), "rb") as _f:
    _causalladder_b64 = base64.b64encode(_f.read()).decode()
with open(os.path.join(_diagrams_dir, "scmdiagram.png"), "rb") as _f:
    _scmdiagram_b64 = base64.b64encode(_f.read()).decode()
with open(os.path.join(_diagrams_dir, "dseparation.png"), "rb") as _f:
    _dseparation_b64 = base64.b64encode(_f.read()).decode()
with open(os.path.join(_diagrams_dir, "dointervention.png"), "rb") as _f:
    _dointervention_b64 = base64.b64encode(_f.read()).decode()

for _s in PRIMER_SECTIONS:
    if _s["id"] == "pearls-ladder":
        _s["image"] = f"data:image/png;base64,{_causalladder_b64}"
    elif _s["id"] == "structural-causal-models":
        _s["image"] = f"data:image/png;base64,{_scmdiagram_b64}"
    elif _s["id"] == "d-separation":
        _s["image"] = f"data:image/png;base64,{_dseparation_b64}"
    elif _s["id"] == "interventions":
        _s["image"] = f"data:image/png;base64,{_dointervention_b64}"