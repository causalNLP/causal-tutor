import json
import os
from typing import List, Optional
from itertools import combinations

import networkx as nx
from openai import AsyncOpenAI
from dotenv import load_dotenv

from .dag_models import (
    DAGGraph, DAGNode, DAGEdge,
    DAGValidateResponse,
    DSeparationResponse,
    PathInfo, PathsResponse,
    DAGAnalyzeResponse,
    AnalysisPathInfo, CausalAnalysisResponse,
)

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ---------------------------------------------------------------------------
# Helper: Pydantic -> networkx
# ---------------------------------------------------------------------------

def build_networkx_graph(graph: DAGGraph) -> nx.DiGraph:
    G = nx.DiGraph()
    for n in graph.nodes:
        G.add_node(n.id, label=n.label)
    for e in graph.edges:
        G.add_edge(e.source, e.target)
    return G


def _node_label_map(graph: DAGGraph) -> dict:
    return {n.id: n.label for n in graph.nodes}


# ---------------------------------------------------------------------------
# 1. Validate (acyclicity)
# ---------------------------------------------------------------------------

def validate_dag(graph: DAGGraph) -> DAGValidateResponse:
    G = build_networkx_graph(graph)
    if nx.is_directed_acyclic_graph(G):
        return DAGValidateResponse(
            is_acyclic=True,
            topological_order=list(nx.topological_sort(G)),
        )
    else:
        try:
            cycle = list(nx.find_cycle(G, orientation="original"))
            cycle_nodes = list(dict.fromkeys([u for u, v, _ in cycle] + [cycle[-1][1]]))
        except nx.NetworkXNoCycle:
            cycle_nodes = []
        return DAGValidateResponse(is_acyclic=False, cycle=cycle_nodes)


# ---------------------------------------------------------------------------
# 2. D-separation
# ---------------------------------------------------------------------------

def _find_all_undirected_paths(G: nx.DiGraph, source: str, target: str, cutoff: int = 10) -> List[List[str]]:
    """Find all simple paths in the underlying undirected skeleton."""
    U = G.to_undirected()
    return list(nx.all_simple_paths(U, source, target, cutoff=cutoff))


def _is_collider(G: nx.DiGraph, prev_node: str, node: str, next_node: str) -> bool:
    """Check if node is a collider on the path segment prev -> node <- next."""
    return G.has_edge(prev_node, node) and G.has_edge(next_node, node)


def _descendants(G: nx.DiGraph, node: str) -> set:
    return nx.descendants(G, node)


def _is_path_active(G: nx.DiGraph, path: List[str], conditioning_set: set) -> bool:
    """Check if a path is active (not blocked) given a conditioning set using d-separation rules."""
    for i in range(1, len(path) - 1):
        prev_node, node, next_node = path[i - 1], path[i], path[i + 1]

        if _is_collider(G, prev_node, node, next_node):
            # Collider: path is blocked UNLESS the collider or a descendant is conditioned on
            desc = _descendants(G, node) | {node}
            if not desc.intersection(conditioning_set):
                return False
        else:
            # Non-collider (chain or fork): path is blocked IF the node is conditioned on
            if node in conditioning_set:
                return False

    return True


def check_d_separation(
    graph: DAGGraph, node_a: str, node_b: str, conditioning_set: List[str]
) -> DSeparationResponse:
    G = build_networkx_graph(graph)
    labels = _node_label_map(graph)
    cond_set = set(conditioning_set)

    # Use networkx built-in for the boolean answer
    try:
        d_sep = nx.d_separated(G, {node_a}, {node_b}, cond_set)
    except Exception:
        d_sep = None

    # Enumerate active paths for explanation
    all_paths = _find_all_undirected_paths(G, node_a, node_b)
    active_paths = [p for p in all_paths if _is_path_active(G, p, cond_set)]

    if d_sep is None:
        d_sep = len(active_paths) == 0

    # Build explanation
    label_a = labels.get(node_a, node_a)
    label_b = labels.get(node_b, node_b)
    cond_labels = [labels.get(c, c) for c in conditioning_set]

    if d_sep:
        if conditioning_set:
            explanation = (
                f"{label_a} and {label_b} are **d-separated** given "
                f"{{{', '.join(cond_labels)}}}. "
                f"All paths between them are blocked by the conditioning set, "
                f"implying conditional independence: {label_a} \u22A5 {label_b} | {{{', '.join(cond_labels)}}}."
            )
        else:
            explanation = (
                f"{label_a} and {label_b} are **d-separated** (unconditionally). "
                f"There are no active paths between them, implying marginal independence."
            )
    else:
        path_descriptions = []
        for p in active_paths:
            path_labels = [labels.get(n, n) for n in p]
            path_descriptions.append(" \u2192 ".join(path_labels))
        paths_text = "; ".join(path_descriptions) if path_descriptions else "unknown"
        if conditioning_set:
            explanation = (
                f"{label_a} and {label_b} are **NOT d-separated** given "
                f"{{{', '.join(cond_labels)}}}. "
                f"Active path(s): {paths_text}. "
                f"These variables are conditionally dependent."
            )
        else:
            explanation = (
                f"{label_a} and {label_b} are **NOT d-separated** (unconditionally). "
                f"Active path(s): {paths_text}. "
                f"These variables are marginally dependent."
            )

    return DSeparationResponse(
        d_separated=d_sep,
        explanation=explanation,
        active_paths=active_paths,
    )


# ---------------------------------------------------------------------------
# 3. Path finding & classification
# ---------------------------------------------------------------------------

def _classify_path(G: nx.DiGraph, path: List[str]) -> str:
    """Classify a path as directed, backdoor, or other."""
    # Directed: all edges follow the path direction
    is_directed = all(G.has_edge(path[i], path[i + 1]) for i in range(len(path) - 1))
    if is_directed:
        return "directed"

    # Backdoor: first edge goes INTO the source (i.e., path[1] -> path[0] exists)
    if len(path) >= 2 and G.has_edge(path[1], path[0]):
        return "backdoor"

    return "other"


def _find_colliders_on_path(G: nx.DiGraph, path: List[str]) -> List[str]:
    colliders = []
    for i in range(1, len(path) - 1):
        if _is_collider(G, path[i - 1], path[i], path[i + 1]):
            colliders.append(path[i])
    return colliders


def _find_confounders(G: nx.DiGraph, source: str, target: str) -> List[str]:
    """Find nodes that have directed paths to both source and target (common causes)."""
    confounders = []
    for node in G.nodes():
        if node == source or node == target:
            continue
        has_path_to_source = nx.has_path(G, node, source)
        has_path_to_target = nx.has_path(G, node, target)
        if has_path_to_source and has_path_to_target:
            confounders.append(node)
    return confounders


def find_all_paths(graph: DAGGraph, source: str, target: str) -> PathsResponse:
    G = build_networkx_graph(graph)

    # All undirected paths (to catch backdoor paths)
    all_undirected = _find_all_undirected_paths(G, source, target)
    confounders = _find_confounders(G, source, target)

    all_paths_info: List[PathInfo] = []
    directed_paths: List[PathInfo] = []
    backdoor_paths: List[PathInfo] = []

    for path in all_undirected:
        path_type = _classify_path(G, path)
        collider_nodes = _find_colliders_on_path(G, path)

        info = PathInfo(
            path=path,
            path_type=path_type,
            contains_collider=len(collider_nodes) > 0,
            collider_nodes=collider_nodes,
            confounders=confounders,
        )
        all_paths_info.append(info)

        if path_type == "directed":
            directed_paths.append(info)
        elif path_type == "backdoor":
            backdoor_paths.append(info)

    return PathsResponse(
        directed_paths=directed_paths,
        backdoor_paths=backdoor_paths,
        all_paths=all_paths_info,
    )


# ---------------------------------------------------------------------------
# 4. Causal Analysis (roles + backdoor criterion)
# ---------------------------------------------------------------------------

def _block_reason(G: nx.DiGraph, path: List[str], conditioning_set: set, labels: dict) -> Optional[str]:
    """Walk the path and produce a human-readable reason it's blocked, or None if open."""
    for i in range(1, len(path) - 1):
        prev_node, node, next_node = path[i - 1], path[i], path[i + 1]
        node_label = labels.get(node, node)

        if _is_collider(G, prev_node, node, next_node):
            desc = _descendants(G, node) | {node}
            if not desc.intersection(conditioning_set):
                return f"blocked at collider '{node_label}' (not in conditioning set)"
        else:
            if node in conditioning_set:
                kind = "fork" if (G.has_edge(node, prev_node) and G.has_edge(node, next_node)) else "chain"
                return f"blocked by conditioning on '{node_label}' ({kind})"
    return None


def _open_reason(G: nx.DiGraph, path: List[str], conditioning_set: set, labels: dict) -> Optional[str]:
    """If a path is open *because* a collider was opened by conditioning, surface that."""
    for i in range(1, len(path) - 1):
        prev_node, node, next_node = path[i - 1], path[i], path[i + 1]
        node_label = labels.get(node, node)
        if _is_collider(G, prev_node, node, next_node):
            desc = _descendants(G, node) | {node}
            if desc.intersection(conditioning_set):
                cond_label = labels.get(node, node) if node in conditioning_set else None
                if cond_label:
                    return f"collider '{node_label}' opened by conditioning"
                else:
                    # descendant of collider conditioned
                    return f"collider '{node_label}' opened (descendant in conditioning set)"
    return None


def _find_minimal_adjustment_set(
    G: nx.DiGraph, treatment: str, outcome: str, latent: set
) -> Optional[List[str]]:
    """Greedy search for a minimal adjustment set satisfying the backdoor criterion.

    Returns None if the graph is too large (>12 observable candidates) or if no
    valid set exists among observable nodes.
    """
    desc_T = _descendants(G, treatment) | {treatment}
    # Candidates: non-T, non-Y, non-latent, not descendants of T
    candidates = [
        n for n in G.nodes()
        if n != treatment and n != outcome and n not in desc_T and n not in latent
    ]
    if len(candidates) > 12:
        return None

    # Get all backdoor paths
    all_undirected = _find_all_undirected_paths(G, treatment, outcome)
    backdoor_paths = [p for p in all_undirected if _classify_path(G, p) == "backdoor"]

    def blocks_all_backdoors(z_set: set) -> bool:
        for p in backdoor_paths:
            if _is_path_active(G, p, z_set):
                return False
        return True

    # Try sets of increasing size
    from itertools import combinations as _combo
    for size in range(0, len(candidates) + 1):
        for combo in _combo(candidates, size):
            z = set(combo)
            if blocks_all_backdoors(z):
                return list(combo)
    return None


def causal_analysis(
    graph: DAGGraph,
    treatment: str,
    outcome: str,
    conditioning_set: List[str],
    latent_nodes: List[str],
) -> CausalAnalysisResponse:
    G = build_networkx_graph(graph)
    labels = _node_label_map(graph)
    cond_set = set(conditioning_set)
    latent = set(latent_nodes)

    if treatment not in G.nodes() or outcome not in G.nodes():
        raise ValueError("Treatment or outcome node not in graph")

    # 1. Enumerate all undirected paths
    all_undirected = _find_all_undirected_paths(G, treatment, outcome)

    # 2. Classify and check blocking
    paths_info: List[AnalysisPathInfo] = []
    active_paths: List[List[str]] = []
    for path in all_undirected:
        ptype = _classify_path(G, path)
        colliders = _find_colliders_on_path(G, path)
        is_blocked = not _is_path_active(G, path, cond_set)
        reason: Optional[str] = None
        if is_blocked:
            reason = _block_reason(G, path, cond_set, labels)
        else:
            reason = _open_reason(G, path, cond_set, labels)
        paths_info.append(AnalysisPathInfo(
            path=path,
            path_type=ptype,
            is_blocked=is_blocked,
            block_reason=reason,
            collider_nodes=colliders,
        ))
        if not is_blocked:
            active_paths.append(path)

    # 3. d-separation verdict (use networkx if possible)
    try:
        d_sep = bool(nx.d_separated(G, {treatment}, {outcome}, cond_set))
    except Exception:
        d_sep = len(active_paths) == 0

    # 4. Backdoor criterion
    backdoor_issues: List[str] = []
    desc_T = _descendants(G, treatment)
    descendant_violations = cond_set.intersection(desc_T)
    for n in descendant_violations:
        backdoor_issues.append(
            f"Z contains '{labels.get(n, n)}', a descendant of treatment — conditioning on it can introduce post-treatment bias."
        )
    # Latent in conditioning set
    latent_violations = cond_set.intersection(latent)
    for n in latent_violations:
        backdoor_issues.append(
            f"Z contains '{labels.get(n, n)}', which is unobservable (latent) — it can't be used in practice."
        )
    # Unblocked backdoor paths
    for info in paths_info:
        if info.path_type == "backdoor" and not info.is_blocked:
            path_str = " — ".join(labels.get(n, n) for n in info.path)
            backdoor_issues.append(
                f"Backdoor path ({path_str}) is not blocked by Z."
            )

    backdoor_satisfied = len(backdoor_issues) == 0

    # 5. Minimal adjustment set suggestion (only if not satisfied)
    minimal_set: Optional[List[str]] = None
    if not backdoor_satisfied:
        minimal_set = _find_minimal_adjustment_set(G, treatment, outcome, latent)

    # 6. Explanation
    label_T = labels.get(treatment, treatment)
    label_Y = labels.get(outcome, outcome)
    cond_str = "{" + ", ".join(labels.get(c, c) for c in conditioning_set) + "}" if conditioning_set else "{} (empty)"

    if backdoor_satisfied:
        if d_sep:
            explanation = (
                f"**Causal effect identifiable.** With conditioning set Z = {cond_str}, "
                f"{label_T} and {label_Y} are d-separated, meaning all backdoor paths are blocked "
                f"and there is no remaining causal pathway. (This is unusual — typically directed "
                f"paths from T to Y remain open, which is what we want for estimation.)"
            )
        else:
            explanation = (
                f"**Backdoor criterion satisfied.** With Z = {cond_str}, all backdoor paths from "
                f"{label_T} to {label_Y} are blocked, so the causal effect is identifiable via the "
                f"adjustment formula: $E[Y | do(T)] = \\sum_z E[Y | T, Z=z] P(Z=z)$. "
                f"Directed paths remain open (this is expected — they carry the causal effect)."
            )
    else:
        suggestion = ""
        if minimal_set is not None:
            if len(minimal_set) == 0:
                suggestion = " A minimal adjustment set is the empty set — no adjustment is needed once issues above are resolved."
            else:
                names = ", ".join(labels.get(n, n) for n in minimal_set)
                suggestion = f" A minimal sufficient adjustment set is **{{{names}}}**."
        explanation = (
            f"**Backdoor criterion not satisfied** for {label_T} → {label_Y} given Z = {cond_str}. "
            f"See issues below.{suggestion}"
        )

    return CausalAnalysisResponse(
        paths=paths_info,
        d_separated=d_sep,
        active_paths=active_paths,
        backdoor_satisfied=backdoor_satisfied,
        backdoor_issues=backdoor_issues,
        minimal_adjustment_set=minimal_set,
        explanation=explanation,
    )


# ---------------------------------------------------------------------------
# 5. GPT Analysis
# ---------------------------------------------------------------------------

DAG_ANALYSIS_SYSTEM_PROMPT = """You are an expert in causal inference and graphical causal models (Pearl's framework). A student has drawn a Directed Acyclic Graph (DAG). Analyze it thoroughly.

Evaluate:
1. **Plausibility**: Is this a plausible causal model? Are there obvious missing confounders or implausible causal directions?
2. **Colliders & Berkson's Bias**: Identify all collider nodes. Explain the risk of Berkson's bias if any collider is conditioned on.
3. **Identification Strategies**: What identification strategies are available? (Backdoor criterion, Front-door criterion, Instrumental Variables). For each, specify the minimal sufficient adjustment set.
4. **Faithfulness**: Does the faithfulness assumption likely hold? Are there cancellation paths or deterministic relationships that would violate it?
5. **Suggestions**: What improvements could the student make? Are there missing variables, implausible edges, or alternative structures to consider?

Provide educational, Socratic-style feedback suitable for a university student with minimal math background. Use concrete examples. Be encouraging but rigorous."""


async def analyze_dag_with_gpt(
    graph: DAGGraph, research_question: Optional[str]
) -> DAGAnalyzeResponse:
    labels = _node_label_map(graph)
    nodes_desc = [f"{n.id} ({n.label})" for n in graph.nodes]
    edges_desc = [f"{labels.get(e.source, e.source)} -> {labels.get(e.target, e.target)}" for e in graph.edges]

    user_prompt = f"""Analyze this DAG:
Nodes: {', '.join(nodes_desc)}
Edges: {', '.join(edges_desc)}
{f'Research question: {research_question}' if research_question else ''}"""

    tools = [
        {
            "type": "function",
            "function": {
                "name": "provide_dag_analysis",
                "description": "Provides structured analysis of a student's DAG.",
                "parameters": DAGAnalyzeResponse.model_json_schema(),
            },
        }
    ]

    completion = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": DAG_ANALYSIS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        tools=tools,
        tool_choice={"type": "function", "function": {"name": "provide_dag_analysis"}},
    )

    tool_call = completion.choices[0].message.tool_calls[0]
    return DAGAnalyzeResponse(**json.loads(tool_call.function.arguments))


# ---------------------------------------------------------------------------
# 5. Streaming Chat
# ---------------------------------------------------------------------------

DAG_CHAT_SYSTEM_PROMPT = """You are a Socratic causal inference tutor helping a student understand a DAG (Directed Acyclic Graph) they have drawn.

Current DAG:
{dag_description}

Instructions:
1. **Be Socratic**: Ask probing questions like "Why do you think X causes Y?" or "What would happen if we conditioned on Z?"
2. **Pearl's Causal Hierarchy**: Help students understand the three levels - association (seeing), intervention (doing), and counterfactuals (imagining).
3. **D-separation**: Explain which variables are conditionally independent and why, using path-tracing rules.
4. **Colliders vs Confounders**: Clearly distinguish these concepts. Explain why conditioning on a collider opens a path (Berkson's bias).
5. **Backdoor & Front-door**: When relevant, explain these identification strategies and the adjustment formula.
6. **Faithfulness**: Discuss when statistical independence might not reflect the graph structure.
7. Use simple, accessible language. Avoid heavy notation unless the student asks for it."""


async def chat_about_dag(graph: DAGGraph, messages: List[dict]):
    labels = _node_label_map(graph)
    nodes_desc = ", ".join([n.label for n in graph.nodes])
    edges_desc = ", ".join(
        [f"{labels.get(e.source, e.source)} -> {labels.get(e.target, e.target)}" for e in graph.edges]
    )
    dag_description = f"Nodes: {nodes_desc}\nEdges: {edges_desc}"

    system_prompt = DAG_CHAT_SYSTEM_PROMPT.format(dag_description=dag_description)

    formatted_messages = [{"role": "system", "content": system_prompt}]
    for m in messages:
        if m["role"] in ["user", "assistant"]:
            formatted_messages.append({"role": m["role"], "content": m["content"]})

    completion = await client.chat.completions.create(
        model="gpt-4o",
        messages=formatted_messages,
        stream=True,
    )
    return completion
