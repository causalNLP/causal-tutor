"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodes,
  useEdges,
  MarkerType,
  Position,
  Handle,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
// @ts-ignore: CSS module declarations not found
import "@xyflow/react/dist/style.css";
import { Eye, EyeOff } from "lucide-react";
import type { SCMVariable } from "@/types";

function VarNode({ data }: NodeProps) {
  const isIntervened = data.isIntervened as boolean;
  const intType = data.interventionType as "hard" | "soft" | undefined;
  const intVal = data.interventionValue as number | undefined;
  const isQuery = data.isQuery as boolean;
  const val = data.value as number | undefined;

  let containerClass = "relative rounded-lg px-3 py-1.5 font-mono text-[13px] font-bold shadow-sm border-2 ";
  
  if (isIntervened && intType === "hard") {
    containerClass += "border-amber-400 bg-amber-50 text-amber-700";
  } else if (isQuery) {
    containerClass += "border-[#67A8CB] bg-[#E2F6FF] text-[#285E7B]";
  } else if (isIntervened && intType === "soft") {
    containerClass += "border-sky-400 border-dashed bg-sky-50 text-sky-700";
  } else {
    containerClass += "border-slate-300 bg-white text-slate-800";
  }

  return (
    <div className={containerClass}>
      <Handle type="target" position={Position.Top} id="top" className="!opacity-0" />
      <Handle type="target" position={Position.Left} id="left" className="!opacity-0" />
      <Handle type="target" position={Position.Right} id="right" className="!opacity-0" />
      
      {data.label as string}
      
      <Handle type="source" position={Position.Bottom} id="bottom" className="!opacity-0" />

      {/* Value indicator underneath for Interventions or Counterfactual Values */}
      {isIntervened && intType === "hard" && intVal !== undefined && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[12.5px] font-bold text-amber-600">
          = {Number(intVal).toFixed(1)}
        </div>
      )}

      {!isIntervened && val !== undefined && (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11.5px] font-medium text-slate-500">
          {Number(val).toFixed(3)}
        </div>
      )}
    </div>
  );
}

function NoiseNode({ data }: NodeProps) {
  const val = data.value as number | undefined;

  return (
    <div className="relative rounded-full border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-1 font-mono text-[12px] text-slate-500">
      <Handle type="source" position={Position.Right} id="right" className="!opacity-0" />
      <Handle type="source" position={Position.Left} id="left" className="!opacity-0" />
      {data.label as string}

      {val !== undefined && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] text-slate-400">
          {Number(val).toFixed(3)}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { varNode: VarNode, noiseNode: NoiseNode };

// re-fits the view whenever the DAG container resizes (e.g. resizable panels)
// or the graph grows (e.g. toggling noise nodes), otherwise the graph gets clipped
function AutoFitOnResize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { fitView } = useReactFlow();
  const nodeCount = useNodes().length;
  const edgeCount = useEdges().length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitView({ duration: 0 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);

  useEffect(() => {
    fitView({ duration: 200 });
  }, [nodeCount, edgeCount, fitView]);

  return <div ref={ref} className="pointer-events-none absolute inset-0" />;
}

function computeLevels(variables: SCMVariable[]): Record<string, number> {
  const level: Record<string, number> = {};
  const byId = new Map(variables.map((v) => [v.id, v]));
  const getLevel = (id: string): number => {
    if (level[id] !== undefined) return level[id];
    const v = byId.get(id)!;
    if (v.dependencies.length === 0) return (level[id] = 0);
    return (level[id] = 1 + Math.max(...v.dependencies.map(getLevel)));
  };
  variables.forEach((v) => getLevel(v.id));
  return level;
}

interface SCMDAGViewProps {
  variables: SCMVariable[];
  showToggle?: boolean;
  intervention?: {
    target_id: string;
    type: "hard" | "soft";
    value?: number;
  } | null;
  queryId?: string | null;
  nodeValues?: Record<string, number>;
  noiseValues?: Record<string, number>;
}

const LEVEL_HEIGHT = 150; 
const NODE_SPACING = 140;

export default function SCMDAGView({ variables, showToggle = true, intervention, queryId, nodeValues, noiseValues }: SCMDAGViewProps) {
  const [showNoise, setShowNoise] = useState(false);

  const { computedNodes, computedEdges } = useMemo(() => {
  const levels = computeLevels(variables);
  const maxLevel = Math.max(0, ...Object.values(levels));
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  variables.forEach((v) => {
    if (!v.position) rows[levels[v.id]].push(v.id);
  });

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const posById: Record<string, { x: number; y: number }> = {};

  // seed manual positions first
  variables.forEach((v) => {
    if (v.position) posById[v.id] = v.position;
  });

  // auto-layout the rest by level
  rows.forEach((row, levelIdx) => {
    const rowWidth = (row.length - 1) * NODE_SPACING;
    row.forEach((id, i) => {
      const x = i * NODE_SPACING - rowWidth / 2;
      const y = levelIdx * LEVEL_HEIGHT;
      posById[id] = { x, y };
    });
  });

  // generate nodes for ALL variables, using whichever position was resolved above
  variables.forEach((v) => {
    const isIntervened = intervention?.target_id === v.id;

    nodes.push({
      id: v.id,
      type: "varNode",
      position: posById[v.id],
      data: {
        label: v.name,
        isIntervened,
        interventionType: isIntervened ? intervention?.type : undefined,
        interventionValue: isIntervened ? intervention?.value : undefined,
        isQuery: queryId === v.id,
        value: nodeValues?.[v.id],
      },
    });
  });

  // generate edges
  variables.forEach((v) => {
    v.dependencies.forEach((depId) => {
      const isMutilated = intervention?.type === "hard" && intervention?.target_id === v.id;

      edges.push({
        id: `e-${depId}-${v.id}`,
        source: depId,
        sourceHandle: "bottom",
        target: v.id,
        targetHandle: "top",
        markerEnd: isMutilated ? undefined : { type: MarkerType.ArrowClosed },
        style: isMutilated
          ? { stroke: "#cbd5e1", strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.5 }
          : { stroke: "#94A3B8" },
        label: isMutilated ? "✕" : undefined,
        labelStyle: isMutilated ? { fill: "#ef4444", fontSize: 14, fontWeight: "bold" } : undefined,
        labelBgStyle: isMutilated ? { fill: "transparent" } : undefined,
      });
    });
  });

  // generate noise nodes and edges (kept on similar row as its node for now)
  if (showNoise) {
    variables.forEach((v) => {
      const pos = posById[v.id];
      const isLeft = pos.x <= 0;
      const xOffset = isLeft ? -100 : 100;
      const noisePos = { x: pos.x + xOffset, y: pos.y };
      const noiseId = `noise-${v.id}`;

      const isMutilated = intervention?.type === "hard" && intervention?.target_id === v.id;

      nodes.push({
        id: noiseId,
        type: "noiseNode",
        position: noisePos,
        data: {
          label: v.noise.name,
          value: noiseValues?.[v.id],
        },
      });

      edges.push({
        id: `e-${noiseId}-${v.id}`,
        source: noiseId,
        sourceHandle: isLeft ? "right" : "left",
        target: v.id,
        targetHandle: isLeft ? "left" : "right",
        type: "straight",
        markerEnd: isMutilated ? undefined : { type: MarkerType.ArrowClosed },
        style: isMutilated
          ? { stroke: "#e2e8f0", strokeWidth: 1.5, strokeDasharray: "2 4", opacity: 0.9 }
          : { stroke: "#94A3B8", strokeDasharray: "4 3" },
        label: isMutilated ? "✕" : undefined,
        labelStyle: isMutilated ? { fill: "#ef4444", fontSize: 12, fontWeight: "bold" } : undefined,
        labelBgStyle: isMutilated ? { fill: "transparent" } : undefined,
      });
    });
  }

  return { computedNodes: nodes, computedEdges: edges };
}, [variables, showNoise, intervention, queryId, nodeValues, noiseValues]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // position memory
  useEffect(() => {
    setNodes((currentNodes) => {
      const existingPositions = new Map(currentNodes.map(n => [n.id, n.position]));

      return computedNodes.map(node => {
        if (existingPositions.has(node.id)) {
          return { ...node, position: existingPositions.get(node.id)! };
        }

        if (node.type === "noiseNode") {
          const parentId = node.id.replace("noise-", "");
          const parentDraggedPos = existingPositions.get(parentId);
          
          if (parentDraggedPos) {
            const originalParentGridX = computedNodes.find(n => n.id === parentId)?.position.x || 0;
            const xOffset = node.position.x - originalParentGridX;
            
            return {
              ...node,
              position: {
                x: parentDraggedPos.x + xOffset,
                y: parentDraggedPos.y,
              }
            };
          }
        }
        return node;
      });
    });
    
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  return (
    <div className="relative h-full w-full">
      {showToggle && (
        <button
          onClick={() => setShowNoise((s) => !s)}
          className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1 text-[12.5px] font-medium text-slate-500 shadow-sm transition-colors hover:bg-slate-50"
        >
          {showNoise ? <EyeOff size={13} /> : <Eye size={13} />}
          {showNoise ? "Hide Exogenous Nodes" : "Show Exogenous Nodes"}
        </button>
      )}
        
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <AutoFitOnResize />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
        <Controls showInteractive={false} className="!rounded-lg !border-slate-200 !shadow-md" />
      </ReactFlow>
    </div>
  );
}