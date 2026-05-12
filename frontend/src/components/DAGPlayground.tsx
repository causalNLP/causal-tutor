"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Panel,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  Trash2,
  Share2,
  Eye,
  EyeOff,
  BrainCircuit,
  MessageSquare,
  ChevronDown,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Target,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import axios from "axios";
import exampleDags from "@/data/example-dags.json";
import type {
  ExampleDAG,
  PathInfo,
  PathsResponse,
  DSeparationResult,
  DAGAnalysisResult,
  CausalAnalysisResult,
} from "@/types";
import DAGChatPanel from "./DAGChatPanel";
import CausalAnalysisPanel from "./CausalAnalysisPanel";
import { getApiHeaders } from "@/lib/apiKey";
import { handleAuthError } from "@/lib/apiErrors";
import { apiUrl } from "@/lib/api";

// ── Custom Node ──────────────────────────────────────────────────────────

function DAGNode({ data, selected }: NodeProps) {
  const isLatent = data.isLatent as boolean;
  const isConditioned = data.isConditioned as boolean;
  const isHighlighted = data.isHighlighted as boolean;
  const highlightColor = data.highlightColor as string | undefined;
  const role = data.role as ("T" | "Y" | "Z" | undefined);

  let classes =
    "relative px-4 py-2 shadow-sm font-medium text-sm transition-all duration-200 min-w-[80px] text-center ";

  if (isLatent) {
    classes += "rounded-full border-2 border-dashed border-slate-400 bg-slate-50 text-slate-600 ";
  } else {
    classes += "rounded-xl border-2 border-slate-300 bg-white text-slate-800 ";
  }

  // Role-based styling (persistent T/Y/Z badges) - takes precedence over conditioned
  if (role === "T") {
    classes += "!border-indigo-500 !bg-indigo-50 ring-2 ring-indigo-100 ";
  } else if (role === "Y") {
    classes += "!border-rose-500 !bg-rose-50 ring-2 ring-rose-100 ";
  } else if (role === "Z" || isConditioned) {
    classes += "!border-amber-400 !bg-amber-50 ring-2 ring-amber-100 ";
  }

  if (isHighlighted && highlightColor === "source") {
    classes += "!border-emerald-500 !bg-emerald-50 ring-2 ring-emerald-200 ";
  } else if (isHighlighted && highlightColor === "target") {
    classes += "!border-rose-500 !bg-rose-50 ring-2 ring-rose-200 ";
  } else if (isHighlighted) {
    classes += "!border-indigo-500 !bg-indigo-50 ring-2 ring-indigo-200 ";
  }

  if (selected) {
    classes += "ring-2 ring-indigo-400 !border-indigo-400 ";
  }

  // Role badge styling
  let badgeClasses = "";
  if (role === "T") badgeClasses = "bg-indigo-600 text-white";
  else if (role === "Y") badgeClasses = "bg-rose-600 text-white";
  else if (role === "Z") badgeClasses = "bg-amber-500 text-white";

  return (
    <div className={classes}>
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-indigo-500 transition-colors"
      />
      <span>{data.label as string}</span>
      {role && (
        <span className={`absolute -top-2 -right-2 ${badgeClasses} text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm border-2 border-white`}>
          {role}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-indigo-500 transition-colors"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { dagNode: DAGNode };

// ── Helpers ──────────────────────────────────────────────────────────────

function toGraphPayload(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, label: (n.data.label as string) || n.id })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

// ── Main Component ───────────────────────────────────────────────────────

export default function DAGPlayground() {
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // UI state
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState("");
  const [newNodeIsLatent, setNewNodeIsLatent] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [exampleDropdownOpen, setExampleDropdownOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const addNodeInputRef = useRef<HTMLInputElement>(null);

  // Interaction modes
  const [interactionMode, setInteractionMode] = useState<"default" | "path_select" | "d_separation">("default");
  const [selectedNodeForPath, setSelectedNodeForPath] = useState<string | null>(null);
  const [conditioningSet, setConditioningSet] = useState<string[]>([]);
  const [dSepNodeA, setDSepNodeA] = useState<string | null>(null);
  const [dSepNodeB, setDSepNodeB] = useState<string | null>(null);
  const [dSepStage, setDSepStage] = useState<"select_a" | "select_b" | "conditioning">("select_a");

  // Analysis state
  const [pathsResult, setPathsResult] = useState<PathsResponse | null>(null);
  const [dSepResult, setDSepResult] = useState<DSeparationResult | null>(null);
  const [dagAnalysis, setDagAnalysis] = useState<DAGAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  // Edge click analysis
  const [edgeAnalysis, setEdgeAnalysis] = useState<PathsResponse | null>(null);
  const [edgeAnalysisLoading, setEdgeAnalysisLoading] = useState(false);
  const [showEdgePanel, setShowEdgePanel] = useState(false);
  const [selectedEdgeLabel, setSelectedEdgeLabel] = useState("");

  // ── Causal Analysis (persistent T/Y/Z roles + backdoor analysis) ──
  const [causalPanelOpen, setCausalPanelOpen] = useState(false);
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [confounderIds, setConfounderIds] = useState<string[]>([]);
  const [assignMode, setAssignMode] = useState<"T" | "Y" | "Z" | null>(null);
  const [causalResult, setCausalResult] = useState<CausalAnalysisResult | null>(null);
  const [causalLoading, setCausalLoading] = useState(false);

  // ── Toast helper ──

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Focus add-node input ──

  useEffect(() => {
    if (showAddNode) addNodeInputRef.current?.focus();
  }, [showAddNode]);

  // ── Sync T/Y/Z roles into node data so badges render ──
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        let role: "T" | "Y" | "Z" | undefined;
        if (n.id === treatmentId) role = "T";
        else if (n.id === outcomeId) role = "Y";
        else if (confounderIds.includes(n.id)) role = "Z";
        // Avoid unnecessary re-renders if role unchanged
        if (n.data.role === role) return n;
        return { ...n, data: { ...n.data, role } };
      })
    );
  }, [treatmentId, outcomeId, confounderIds, setNodes]);

  // ── Apply causal-analysis edge styling when result arrives (or clear when null) ──
  useEffect(() => {
    if (!causalResult) {
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          animated: false,
          style: { ...e.style, stroke: undefined, strokeWidth: undefined, strokeDasharray: undefined, opacity: undefined },
        }))
      );
      return;
    }
    // Build per-edge style map. Priority order:
    //  - blocked (any path) → light gray dashed
    //  - directed open → emerald solid
    //  - backdoor open → rose solid animated
    const blockedSet = new Set<string>();
    const directedOpenSet = new Set<string>();
    const backdoorOpenSet = new Set<string>();

    causalResult.paths.forEach((p) => {
      for (let i = 0; i < p.path.length - 1; i++) {
        const a = p.path[i];
        const b = p.path[i + 1];
        const eid1 = `e-${a}-${b}`;
        const eid2 = `e-${b}-${a}`;
        if (p.is_blocked) {
          blockedSet.add(eid1);
          blockedSet.add(eid2);
        } else if (p.path_type === "directed") {
          directedOpenSet.add(eid1);
          directedOpenSet.add(eid2);
        } else {
          backdoorOpenSet.add(eid1);
          backdoorOpenSet.add(eid2);
        }
      }
    });

    setEdges((eds) =>
      eds.map((e) => {
        // Open paths take precedence over blocked classification when an edge appears in both
        if (backdoorOpenSet.has(e.id)) {
          return { ...e, animated: true, style: { stroke: "#f43f5e", strokeWidth: 2.5 } };
        }
        if (directedOpenSet.has(e.id)) {
          return { ...e, animated: false, style: { stroke: "#10b981", strokeWidth: 2.5 } };
        }
        if (blockedSet.has(e.id)) {
          return { ...e, animated: false, style: { stroke: "#cbd5e1", strokeWidth: 1.5, strokeDasharray: "5 5", opacity: 0.6 } };
        }
        return e;
      })
    );
  }, [causalResult, setEdges]);

  // ── Causal analysis runner ──
  const runCausalAnalysis = useCallback(async () => {
    if (!treatmentId || !outcomeId) return;
    setCausalLoading(true);
    try {
      const graph = toGraphPayload(nodes, edges);
      const latentNodes = nodes.filter((n) => n.data.isLatent).map((n) => n.id);
      const res = await axios.post<CausalAnalysisResult>(
        apiUrl("/dag/causal-analysis"),
        {
          graph,
          treatment: treatmentId,
          outcome: outcomeId,
          conditioning_set: confounderIds,
          latent_nodes: latentNodes,
        }
      );
      setCausalResult(res.data);
    } catch (err) {
      console.error(err);
      showToast("Failed to run causal analysis");
    } finally {
      setCausalLoading(false);
    }
  }, [treatmentId, outcomeId, confounderIds, nodes, edges, showToast]);

  // ── Clear causal result (the useEffect above resets edge styling) ──
  const clearCausalResult = useCallback(() => {
    setCausalResult(null);
  }, []);

  // ── Node label lookup ──

  const nodeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    nodes.forEach((n) => {
      map[n.id] = (n.data.label as string) || n.id;
    });
    return map;
  }, [nodes]);

  // ── Connection handler (add edge + validate) ──

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      // Prevent duplicate edges
      const exists = edges.some(
        (e) => e.source === connection.source && e.target === connection.target
      );
      if (exists) return;

      const newEdge: Edge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
        markerEnd: { type: MarkerType.ArrowClosed },
      };

      const updatedEdges = addEdge(newEdge, edges);

      // Validate acyclicity
      try {
        const graph = toGraphPayload(nodes, updatedEdges);
        const res = await axios.post(apiUrl("/dag/validate"), { graph });
        if (!res.data.is_acyclic) {
          showToast("This edge would create a cycle. DAGs must be acyclic.");
          return;
        }
      } catch {
        // If backend is down, allow the edge (degrade gracefully)
      }

      setEdges(updatedEdges);
    },
    [edges, nodes, setEdges, showToast]
  );

  // ── Add node ──

  const handleAddNode = () => {
    if (!newNodeLabel.trim()) return;
    const id = `node_${Date.now()}`;
    const newNode: Node = {
      id,
      type: "dagNode",
      position: { x: 300 + Math.random() * 200, y: 200 + Math.random() * 100 },
      data: { label: newNodeLabel.trim(), isLatent: newNodeIsLatent },
    };
    setNodes((nds) => [...nds, newNode]);
    setNewNodeLabel("");
    setNewNodeIsLatent(false);
    setShowAddNode(false);
  };

  // ── Load example ──

  const loadExample = (example: ExampleDAG) => {
    const rfNodes: Node[] = example.nodes.map((n) => ({
      id: n.id,
      type: "dagNode",
      position: n.position,
      data: { label: n.label, isLatent: n.isLatent || false },
    }));
    const rfEdges: Edge[] = example.edges.map((e) => ({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    setExampleDropdownOpen(false);
    clearAllAnalysis();
    showToast(`Loaded: ${example.name}`);
  };

  // ── Clear canvas ──

  const clearCanvas = () => {
    setNodes([]);
    setEdges([]);
    clearAllAnalysis();
  };

  // ── Clear all analysis state ──

  const clearAllAnalysis = () => {
    setPathsResult(null);
    setDSepResult(null);
    setEdgeAnalysis(null);
    setDagAnalysis(null);
    setShowEdgePanel(false);
    setShowAnalysisModal(false);
    setSelectedNodeForPath(null);
    setConditioningSet([]);
    setDSepNodeA(null);
    setDSepNodeB(null);
    setDSepStage("select_a");
    setInteractionMode("default");
    resetNodeHighlights();
    resetEdgeHighlights();
    // Causal analysis roles + result
    setTreatmentId(null);
    setOutcomeId(null);
    setConfounderIds([]);
    setCausalResult(null);
    setAssignMode(null);
  };

  // ── Reset visual highlights ──

  const resetNodeHighlights = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, isHighlighted: false, highlightColor: undefined, isConditioned: false },
      }))
    );
  }, [setNodes]);

  const resetEdgeHighlights = useCallback(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        animated: false,
        style: { ...e.style, stroke: undefined, strokeWidth: undefined },
      }))
    );
  }, [setEdges]);

  // ── Edge click → path analysis ──

  const onEdgeClick = useCallback(
    async (_: React.MouseEvent, edge: Edge) => {
      if (interactionMode !== "default") return;
      if (nodes.length < 2) return;

      setEdgeAnalysisLoading(true);
      setShowEdgePanel(true);
      setSelectedEdgeLabel(`${nodeLabels[edge.source] || edge.source} → ${nodeLabels[edge.target] || edge.target}`);

      try {
        const graph = toGraphPayload(nodes, edges);
        const res = await axios.post(apiUrl("/dag/paths"), {
          graph,
          source: edge.source,
          target: edge.target,
        });
        setEdgeAnalysis(res.data);
      } catch (err) {
        console.error(err);
        showToast("Failed to analyze edge");
      } finally {
        setEdgeAnalysisLoading(false);
      }
    },
    [nodes, edges, nodeLabels, interactionMode, showToast]
  );

  // ── Node click handler (mode-dependent) ──

  const onNodeClick = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      // Role-assignment: pick T/Y/Z by clicking on the canvas
      if (assignMode) {
        if (assignMode === "T") {
          // If this node is currently Y or Z, remove it from those roles first
          if (node.id === outcomeId) setOutcomeId(null);
          if (confounderIds.includes(node.id)) setConfounderIds((cs) => cs.filter((c) => c !== node.id));
          setTreatmentId(node.id);
          setCausalResult(null);
        } else if (assignMode === "Y") {
          if (node.id === treatmentId) setTreatmentId(null);
          if (confounderIds.includes(node.id)) setConfounderIds((cs) => cs.filter((c) => c !== node.id));
          setOutcomeId(node.id);
          setCausalResult(null);
        } else if (assignMode === "Z") {
          if (node.id === treatmentId || node.id === outcomeId) {
            showToast("Treatment and outcome can't be confounders");
            return;
          }
          setConfounderIds((cs) =>
            cs.includes(node.id) ? cs.filter((c) => c !== node.id) : [...cs, node.id]
          );
          setCausalResult(null);
        }
        return;
      }

      if (interactionMode === "path_select") {
        // Path selection mode
        if (!selectedNodeForPath) {
          setSelectedNodeForPath(node.id);
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                isHighlighted: n.id === node.id,
                highlightColor: n.id === node.id ? "source" : undefined,
              },
            }))
          );
        } else if (node.id !== selectedNodeForPath) {
          // Second node selected → fetch paths
          const source = selectedNodeForPath;
          const target = node.id;

          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                isHighlighted: n.id === source || n.id === target,
                highlightColor: n.id === source ? "source" : n.id === target ? "target" : undefined,
              },
            }))
          );

          try {
            const graph = toGraphPayload(nodes, edges);
            const res = await axios.post<PathsResponse>(apiUrl("/dag/paths"), {
              graph,
              source,
              target,
            });
            setPathsResult(res.data);

            // Highlight edges on paths
            const edgesOnPaths = new Set<string>();
            const edgeColors: Record<string, string> = {};
            res.data.all_paths.forEach((p: PathInfo) => {
              for (let i = 0; i < p.path.length - 1; i++) {
                const a = p.path[i];
                const b = p.path[i + 1];
                // Check both directions for undirected path
                const eid1 = `e-${a}-${b}`;
                const eid2 = `e-${b}-${a}`;
                edgesOnPaths.add(eid1);
                edgesOnPaths.add(eid2);
                const color = p.path_type === "directed" ? "#10b981" : p.path_type === "backdoor" ? "#f43f5e" : "#6366f1";
                edgeColors[eid1] = color;
                edgeColors[eid2] = color;
              }
            });

            setEdges((eds) =>
              eds.map((e) => ({
                ...e,
                animated: edgesOnPaths.has(e.id),
                style: edgesOnPaths.has(e.id)
                  ? { stroke: edgeColors[e.id] || "#6366f1", strokeWidth: 3 }
                  : { stroke: undefined, strokeWidth: undefined },
              }))
            );
          } catch (err) {
            console.error(err);
            showToast("Failed to find paths");
          }

          setSelectedNodeForPath(null);
        }
      } else if (interactionMode === "d_separation") {
        if (dSepStage === "select_a") {
          setDSepNodeA(node.id);
          setDSepStage("select_b");
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                isHighlighted: n.id === node.id,
                highlightColor: n.id === node.id ? "source" : undefined,
              },
            }))
          );
        } else if (dSepStage === "select_b" && node.id !== dSepNodeA) {
          setDSepNodeB(node.id);
          setDSepStage("conditioning");
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                isHighlighted: n.id === dSepNodeA || n.id === node.id,
                highlightColor:
                  n.id === dSepNodeA ? "source" : n.id === node.id ? "target" : undefined,
              },
            }))
          );
          // Immediately query with empty conditioning set
          queryDSeparation(dSepNodeA!, node.id, []);
        } else if (dSepStage === "conditioning" && node.id !== dSepNodeA && node.id !== dSepNodeB) {
          // Toggle node in conditioning set
          setConditioningSet((prev) => {
            const updated = prev.includes(node.id)
              ? prev.filter((n) => n !== node.id)
              : [...prev, node.id];

            // Update visual
            setNodes((nds) =>
              nds.map((n) => ({
                ...n,
                data: {
                  ...n.data,
                  isConditioned: updated.includes(n.id),
                },
              }))
            );

            // Re-query
            queryDSeparation(dSepNodeA!, dSepNodeB!, updated);
            return updated;
          });
        }
      }
    },
    [interactionMode, selectedNodeForPath, dSepStage, dSepNodeA, dSepNodeB, nodes, edges, setNodes, setEdges, showToast]
  );

  // ── D-separation query ──

  const queryDSeparation = async (nodeA: string, nodeB: string, condSet: string[]) => {
    try {
      const graph = toGraphPayload(nodes, edges);
      const res = await axios.post<DSeparationResult>(apiUrl("/dag/d-separation"), {
        graph,
        node_a: nodeA,
        node_b: nodeB,
        conditioning_set: condSet,
      });
      setDSepResult(res.data);
    } catch (err) {
      console.error(err);
      showToast("Failed to check d-separation");
    }
  };

  // ── Toggle path selection mode ──

  const togglePathMode = () => {
    if (interactionMode === "path_select") {
      setInteractionMode("default");
      setSelectedNodeForPath(null);
      setPathsResult(null);
      resetNodeHighlights();
      resetEdgeHighlights();
    } else {
      setInteractionMode("path_select");
      setDSepResult(null);
      setDSepNodeA(null);
      setDSepNodeB(null);
      setDSepStage("select_a");
      setConditioningSet([]);
      resetNodeHighlights();
      resetEdgeHighlights();
    }
  };

  // ── Toggle d-separation mode ──

  const toggleDSepMode = () => {
    if (interactionMode === "d_separation") {
      setInteractionMode("default");
      setDSepResult(null);
      setDSepNodeA(null);
      setDSepNodeB(null);
      setDSepStage("select_a");
      setConditioningSet([]);
      resetNodeHighlights();
      resetEdgeHighlights();
    } else {
      setInteractionMode("d_separation");
      setSelectedNodeForPath(null);
      setPathsResult(null);
      setDSepStage("select_a");
      resetNodeHighlights();
      resetEdgeHighlights();
    }
  };

  // ── Check my DAG (GPT analysis) ──

  const handleCheckDAG = async () => {
    if (nodes.length < 2 || edges.length < 1) {
      showToast("Add at least 2 nodes and 1 edge first");
      return;
    }

    setAnalysisLoading(true);
    setShowAnalysisModal(true);

    try {
      const graph = toGraphPayload(nodes, edges);
      const res = await axios.post<DAGAnalysisResult>(apiUrl("/dag/analyze"), {
        graph,
      }, {
        headers: { ...getApiHeaders() },
      });
      setDagAnalysis(res.data);
    } catch (err) {
      console.error(err);
      const authMsg = handleAuthError(err);
      showToast(authMsg || "Failed to analyze DAG");
      setShowAnalysisModal(false);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // ── Status bar text ──

  const statusText = useMemo(() => {
    if (assignMode) {
      const roleLabel = assignMode === "T" ? "Treatment" : assignMode === "Y" ? "Outcome" : "Confounder";
      return `Click a node to ${assignMode === "Z" ? "toggle as" : "set as"} ${roleLabel}`;
    }
    if (interactionMode === "path_select") {
      return selectedNodeForPath
        ? `Click a second node to find all paths from ${nodeLabels[selectedNodeForPath] || selectedNodeForPath}`
        : "Click a node to select it as the source";
    }
    if (interactionMode === "d_separation") {
      if (dSepStage === "select_a") return "Click the first node (A) for d-separation test";
      if (dSepStage === "select_b") return `Node A: ${nodeLabels[dSepNodeA!] || dSepNodeA}. Now click node B`;
      return `Testing d-sep: ${nodeLabels[dSepNodeA!]} \u22A5 ${nodeLabels[dSepNodeB!]}. Click nodes to condition on them.`;
    }
    return null;
  }, [assignMode, interactionMode, selectedNodeForPath, dSepStage, dSepNodeA, dSepNodeB, nodeLabels]);

  return (
    <div className="flex h-full w-full bg-white overflow-hidden">
      {/* Main Area */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header / Toolbar */}
        <header className="h-14 flex-shrink-0 flex items-center gap-2 px-4 bg-white border-b border-slate-200 z-20">
          <div className="flex items-center gap-2 mr-4">
            <div className="p-1.5 bg-amber-50 rounded-lg text-amber-600">
              <Share2 size={18} />
            </div>
            <h1 className="font-bold text-slate-800 text-sm">DAG Playground</h1>
          </div>

          {/* Example dropdown */}
          <div className="relative">
            <button
              onClick={() => setExampleDropdownOpen(!exampleDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
            >
              Examples <ChevronDown size={14} />
            </button>
            {exampleDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 max-h-80 overflow-y-auto">
                {(exampleDags as ExampleDAG[]).map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => loadExample(ex)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                  >
                    <div className="font-medium text-sm text-slate-800">{ex.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{ex.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add Node */}
          <div className="relative">
            <button
              onClick={() => setShowAddNode(!showAddNode)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
            >
              <Plus size={14} /> Add Node
            </button>
            {showAddNode && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3">
                <input
                  ref={addNodeInputRef}
                  value={newNodeLabel}
                  onChange={(e) => setNewNodeLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddNode();
                    if (e.key === "Escape") setShowAddNode(false);
                  }}
                  placeholder="Variable name..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                />
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newNodeIsLatent}
                    onChange={(e) => setNewNodeIsLatent(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-600">Unobserved / Latent variable</span>
                </label>
                <button
                  onClick={handleAddNode}
                  disabled={!newNodeLabel.trim()}
                  className="mt-2 w-full py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {/* Path select toggle */}
          <button
            onClick={togglePathMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border ${
              interactionMode === "path_select"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
            }`}
          >
            <Eye size={14} /> Find Paths
          </button>

          {/* D-sep toggle */}
          <button
            onClick={toggleDSepMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border ${
              interactionMode === "d_separation"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
            }`}
          >
            {interactionMode === "d_separation" ? <EyeOff size={14} /> : <Eye size={14} />}
            D-Separation
          </button>

          {/* Causal Analysis (T/Y/Z + backdoor) */}
          <button
            onClick={() => setCausalPanelOpen(!causalPanelOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border ${
              causalPanelOpen
                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
            }`}
          >
            <Target size={14} /> Causal Analysis
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {/* Check my DAG */}
          <button
            onClick={handleCheckDAG}
            disabled={analysisLoading || nodes.length < 2}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            {analysisLoading ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
            Check my DAG
          </button>

          <div className="flex-1" />

          {/* Clear */}
          <button
            onClick={clearCanvas}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="Clear canvas"
          >
            <RotateCcw size={16} />
          </button>

          {/* Chat toggle — hidden while the chat panel is already open */}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
            >
              <MessageSquare size={14} /> Chat
            </button>
          )}
        </header>

        {/* Status bar */}
        {statusText && (
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600 flex items-center gap-2">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
            {statusText}
            <button
              onClick={() => {
                if (assignMode) {
                  setAssignMode(null);
                } else {
                  clearAllAnalysis();
                }
              }}
              className="ml-auto text-slate-400 hover:text-slate-600 text-[11px] underline"
            >
              Cancel
            </button>
          </div>
        )}

        {/* React Flow Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            deleteKeyCode="Delete"
            className="bg-white"
          >
            <Controls className="!rounded-xl !border-slate-200 !shadow-lg" />
            <MiniMap
              nodeBorderRadius={12}
              nodeColor={(n) => (n.data?.isLatent ? "#f1f5f9" : "#e2e8f0")}
              className="!rounded-xl !border-slate-200 !shadow-lg"
            />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />

            {/* Empty state */}
            {nodes.length === 0 && (
              <Panel position="top-center">
                <div className="mt-40 text-center animate-in fade-in duration-500">
                  <Share2 size={48} className="mx-auto text-slate-200 mb-4" />
                  <h2 className="text-xl font-bold text-slate-400 mb-2">Build Your Causal DAG</h2>
                  <p className="text-sm text-slate-400 max-w-sm">
                    Add nodes using the toolbar, then draw directed edges by dragging from one handle to another. Or load an example to get started.
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>

          {/* Edge analysis slide-up panel */}
          {showEdgePanel && (
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-2xl z-30 max-h-[250px] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300">
              <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Edge Analysis:</span>
                  <span className="text-sm font-semibold text-slate-800">{selectedEdgeLabel}</span>
                </div>
                <button
                  onClick={() => setShowEdgePanel(false)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-400"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-6 py-4">
                {edgeAnalysisLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 size={16} className="animate-spin" /> Analyzing paths...
                  </div>
                ) : edgeAnalysis ? (
                  <div className="space-y-3">
                    {edgeAnalysis.all_paths.length === 0 ? (
                      <p className="text-sm text-slate-500">No paths found between these nodes.</p>
                    ) : (
                      edgeAnalysis.all_paths.map((p, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${
                              p.path_type === "directed"
                                ? "bg-emerald-100 text-emerald-700"
                                : p.path_type === "backdoor"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {p.path_type}
                          </span>
                          <div>
                            <div className="font-medium text-slate-700">
                              {p.path.map((n) => nodeLabels[n] || n).join(" \u2192 ")}
                            </div>
                            {p.collider_nodes.length > 0 && (
                              <div className="text-xs text-amber-600 mt-0.5">
                                Collider(s): {p.collider_nodes.map((n) => nodeLabels[n] || n).join(", ")}
                              </div>
                            )}
                            {p.confounders.length > 0 && (
                              <div className="text-xs text-rose-600 mt-0.5">
                                Confounder(s): {p.confounders.map((n) => nodeLabels[n] || n).join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Path results overlay */}
          {pathsResult && interactionMode === "path_select" && (
            <div className="absolute top-4 right-4 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-[300px] overflow-y-auto animate-in slide-in-from-right-4 duration-300">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-xl">
                <span className="text-xs font-bold text-slate-500 uppercase">All Paths</span>
                <button
                  onClick={() => {
                    setPathsResult(null);
                    resetEdgeHighlights();
                    resetNodeHighlights();
                  }}
                  className="p-1 hover:bg-slate-200 rounded text-slate-400"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {pathsResult.all_paths.length === 0 ? (
                  <p className="text-sm text-slate-500">No paths found.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" /> Directed
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-0.5 bg-rose-500 inline-block rounded" /> Backdoor
                      </span>
                    </div>
                    {pathsResult.all_paths.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap ${
                            p.path_type === "directed"
                              ? "bg-emerald-100 text-emerald-700"
                              : p.path_type === "backdoor"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {p.path_type}
                        </span>
                        <span className="text-slate-700 text-xs">
                          {p.path.map((n) => nodeLabels[n] || n).join(" \u2192 ")}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* D-separation result overlay */}
          {dSepResult && interactionMode === "d_separation" && (
            <div className="absolute top-4 right-4 w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-30 animate-in slide-in-from-right-4 duration-300">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-xl">
                <span className="text-xs font-bold text-slate-500 uppercase">D-Separation Result</span>
                <div className="flex items-center gap-2">
                  {dSepResult.d_separated ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                      <CheckCircle2 size={14} /> Independent
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-rose-600">
                      <AlertTriangle size={14} /> Dependent
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4">
                <div className="prose prose-sm max-w-none text-[13px] text-slate-700">
                  <ReactMarkdown>{dSepResult.explanation}</ReactMarkdown>
                </div>
                {conditioningSet.length > 0 && (
                  <div className="mt-3 text-xs text-slate-500">
                    <span className="font-medium">Conditioning on:</span>{" "}
                    {conditioningSet.map((n) => nodeLabels[n] || n).join(", ")}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  Click other nodes to add/remove them from the conditioning set.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel */}
      <CausalAnalysisPanel
        isOpen={causalPanelOpen}
        onClose={() => setCausalPanelOpen(false)}
        nodes={nodes.map((n) => ({
          id: n.id,
          label: (n.data.label as string) || n.id,
          isLatent: !!n.data.isLatent,
        }))}
        treatmentId={treatmentId}
        outcomeId={outcomeId}
        confounderIds={confounderIds}
        onSetTreatment={(id) => {
          if (id && id === outcomeId) setOutcomeId(null);
          if (id && confounderIds.includes(id)) setConfounderIds((cs) => cs.filter((c) => c !== id));
          setTreatmentId(id);
          setCausalResult(null);
        }}
        onSetOutcome={(id) => {
          if (id && id === treatmentId) setTreatmentId(null);
          if (id && confounderIds.includes(id)) setConfounderIds((cs) => cs.filter((c) => c !== id));
          setOutcomeId(id);
          setCausalResult(null);
        }}
        onSetConfounders={(ids) => {
          setConfounderIds(ids);
          setCausalResult(null);
        }}
        assignMode={assignMode}
        onSetAssignMode={setAssignMode}
        result={causalResult}
        loading={causalLoading}
        onRun={runCausalAnalysis}
        onClearResult={clearCausalResult}
      />

      <DAGChatPanel
        nodes={toGraphPayload(nodes, edges).nodes}
        edges={toGraphPayload(nodes, edges).edges}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />

      {/* Analysis Modal */}
      {showAnalysisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-[700px] max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <BrainCircuit size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">DAG Analysis</h3>
                  <p className="text-xs text-slate-500">AI-powered feedback on your causal graph</p>
                </div>
              </div>
              <button
                onClick={() => setShowAnalysisModal(false)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {analysisLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 size={32} className="animate-spin text-indigo-500 mb-4" />
                  <p className="text-sm text-slate-500 font-medium">Analyzing your DAG...</p>
                </div>
              ) : dagAnalysis ? (
                <div className="space-y-6">
                  {/* Feedback */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Qualitative Feedback</h4>
                    <div className="prose prose-slate prose-sm max-w-none text-[14px]">
                      <ReactMarkdown>{dagAnalysis.feedback}</ReactMarkdown>
                    </div>
                  </div>

                  {/* Confounders */}
                  {dagAnalysis.confounders.length > 0 && (
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase mb-2">
                        <AlertTriangle size={14} /> Confounders
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dagAnalysis.confounders.map((c, i) => (
                          <span key={i} className="px-2 py-1 bg-white border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Colliders */}
                  {dagAnalysis.colliders.length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-amber-700 font-bold text-xs uppercase mb-2">
                        <AlertTriangle size={14} /> Colliders (Berkson's Bias Risk)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dagAnalysis.colliders.map((c, i) => (
                          <span key={i} className="px-2 py-1 bg-white border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Adjustments */}
                  {dagAnalysis.suggested_adjustments.length > 0 && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase mb-2">
                        <CheckCircle2 size={14} /> Suggested Adjustments
                      </div>
                      <ul className="space-y-1">
                        {dagAnalysis.suggested_adjustments.map((s, i) => (
                          <li key={i} className="text-xs text-slate-700 leading-relaxed flex items-start gap-2">
                            <span className="text-emerald-500 mt-0.5">&#8226;</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Faithfulness */}
                  {dagAnalysis.faithfulness_notes && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase mb-2">
                        <BrainCircuit size={14} /> Faithfulness Assumption
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{dagAnalysis.faithfulness_notes}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-2xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
