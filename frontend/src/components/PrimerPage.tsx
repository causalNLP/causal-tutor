"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ConnectionMode,
  BaseEdge,
  getBezierPath,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, BookOpen, Loader2, PanelRightOpen } from "lucide-react";
import { apiUrl } from "@/lib/api";

// ──────────────────────────────────────────────────────────────────────
// Section color system — grounded in the causal concept each section
// teaches, not an arbitrary rainbow: forks (confounders) get the same
// indigo/purple family as exogenous causes elsewhere in the app, colliders
// get red (conditioning on them is a trap), chains (mediators) get teal,
// the ladder gets amber, structural equations get violet.
// ──────────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const SECTION_ACCENTS: Record<string, { accent: string; accentText: string }> = {
  "why-causality-matters": { accent: "#7B87B0", accentText: "#3F4863" },
  "what-is-a-dag": { accent: "#4F97D1", accentText: "#2A5A80" },
  confounders: { accent: "#7C8AE8", accentText: "#4A57A8" },
  colliders: { accent: "#E5665A", accentText: "#B23A32" },
  mediators: { accent: "#2FBBA3", accentText: "#1C7C6B" },
  "d-separation": { accent: "#4F97D1", accentText: "#2A5A80" },
  "backdoor-criterion": { accent: "#7C8AE8", accentText: "#4A57A8" },
  "pearls-ladder": { accent: "#D4A5C9", accentText: "#8F5A8A" },
  "potential-outcomes": { accent: "#D4A5C9", accentText: "#8F5A8A" },
  "structural-causal-models": { accent: "#A184E0", accentText: "#6A4AA8" },
  "noise-term": { accent: "#A184E0", accentText: "#6A4AA8" },
  interventions: { accent: "#A184E0", accentText: "#6A4AA8" },
  counterfactuals: { accent: "#A184E0", accentText: "#6A4AA8" },
};
const DEFAULT_ACCENT = { accent: "#7B87B0", accentText: "#3F4863" };

function themeFor(id?: string) {
  const base = (id && SECTION_ACCENTS[id]) || DEFAULT_ACCENT;
  return { ...base, tint: hexToRgba(base.accent, 0.06) };
}

// ── DAGNode — same handle geometry/logic as DAGPlayground (role badges /
// delete button stripped since Primer is read-only); visual styling takes
// its color from the active section's accent instead of flat slate.
// `conditioned` fills the node with the accent color (instead of an
// outlined white node) to show a variable being conditioned on. ──

const BOUNDARY_HANDLE_STEPS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96];

function DAGNode({ data, selected }: NodeProps) {
  const label = data.label as string;
  const hasSubscript = /[₀₁₂₃₄₅₆₇₈₉]/.test(label);
  const isLatent = data.isLatent as boolean;
  const conditioned = Boolean(data.conditioned);
  const accent = (data.accentText as string) || DEFAULT_ACCENT.accentText;

  let classes =
    "relative px-4 py-2 shadow-sm font-medium text-sm transition-colors duration-200 min-w-[80px] text-center ";
  classes += isLatent ? "rounded-full border-2 border-dashed " : "rounded-xl border-2 ";
  if (!conditioned) classes += "bg-white ";
  if (selected) classes += "ring-2 ring-offset-1 ";

  const style: CSSProperties = {
    borderColor: isLatent ? hexToRgba(accent, 0.55) : accent,
    background: conditioned ? accent : undefined,
    color: conditioned ? "#FFFFFF" : accent,
    ...(selected ? ({ ["--tw-ring-color" as any]: hexToRgba(accent, 0.4) } as CSSProperties) : {}),
  };

  const handleClass = "!bg-transparent !border-0 !opacity-0";

  return (
    <div className={classes} style={style}>
      {BOUNDARY_HANDLE_STEPS.map((offset) => (
        <Handle
          key={`top-${offset}`}
          id={`top-${offset}`}
          type="source"
          position={Position.Top}
          className={handleClass}
          style={{ width: "9%", height: 14, left: `${offset}%`, top: 0, transform: "translate(-50%, -50%)", borderRadius: 0 }}
        />
      ))}
      {BOUNDARY_HANDLE_STEPS.map((offset) => (
        <Handle
          key={`right-${offset}`}
          id={`right-${offset}`}
          type="source"
          position={Position.Right}
          className={handleClass}
          style={{ width: 14, height: "9%", right: 0, top: `${offset}%`, transform: "translate(50%, -50%)", borderRadius: 0 }}
        />
      ))}
      {BOUNDARY_HANDLE_STEPS.map((offset) => (
        <Handle
          key={`bottom-${offset}`}
          id={`bottom-${offset}`}
          type="source"
          position={Position.Bottom}
          className={handleClass}
          style={{ width: "9%", height: 14, left: `${offset}%`, bottom: 0, transform: "translate(-50%, 50%)", borderRadius: 0 }}
        />
      ))}
      {BOUNDARY_HANDLE_STEPS.map((offset) => (
        <Handle
          key={`left-${offset}`}
          id={`left-${offset}`}
          type="source"
          position={Position.Left}
          className={handleClass}
          style={{ width: 14, height: "9%", left: 0, top: `${offset}%`, transform: "translate(-50%, -50%)", borderRadius: 0 }}
        />
      ))}
      <span className={hasSubscript ? "font-mono" : ""}>{label}</span>
    </div>
  );
}

const nodeTypes: NodeTypes = { dagNode: DAGNode };

// ── DeletableEdge — unchanged geometry/logic, plus one addition: an edge
// whose data carries `severed: true` (set when the source data's edge
// `type` is "severed") renders as a dashed, muted-grey arrow instead of a
// solid accent-colored one — used for an edge cut by a do-intervention. ──

type DeletableEdgeData = {
  pathFlow?: { color: string; reverse?: boolean };
  severed?: boolean;
};

function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const edgeData = data as DeletableEdgeData | undefined;
  const flow = edgeData?.pathFlow;
  const flowStyle: CSSProperties | undefined = flow
    ? {
        ...style,
        stroke: flow.color,
        strokeDasharray: "7 7",
        strokeLinecap: "round",
      }
    : style;

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={flowStyle} />;
}

const edgeTypes: EdgeTypes = { deletable: DeletableEdge };

// ── Boundary-handle geometry — unchanged from DAGPlayground ──

type BoundarySide = "top" | "right" | "bottom" | "left";
type BoundaryNodeDatum = { id: string; position: { x: number; y: number } };

function clampBoundaryOffset(value: number) {
  return Math.max(BOUNDARY_HANDLE_STEPS[0], Math.min(BOUNDARY_HANDLE_STEPS[BOUNDARY_HANDLE_STEPS.length - 1], value));
}

function nearestBoundaryOffset(value: number) {
  const clamped = clampBoundaryOffset(value);
  return BOUNDARY_HANDLE_STEPS.reduce((best, current) =>
    Math.abs(current - clamped) < Math.abs(best - clamped) ? current : best
  );
}

function boundaryHandleId(side: BoundarySide, offset: number) {
  return `${side}-${nearestBoundaryOffset(offset)}`;
}

function inferExampleEdgeHandles(sourceNode?: BoundaryNodeDatum, targetNode?: BoundaryNodeDatum) {
  if (!sourceNode || !targetNode) return {};

  const dx = targetNode.position.x - sourceNode.position.x;
  const dy = targetNode.position.y - sourceNode.position.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let sourceSide: BoundarySide;
  let targetSide: BoundarySide;
  let sourceOffset: number;
  let targetOffset: number;

  if (absDx >= absDy) {
    sourceSide = dx >= 0 ? "right" : "left";
    targetSide = dx >= 0 ? "left" : "right";
    const verticalSkew = absDx === 0 ? 0 : dy / absDx;
    sourceOffset = 50 + verticalSkew * 35;
    targetOffset = 50 - verticalSkew * 35;
  } else {
    sourceSide = dy >= 0 ? "bottom" : "top";
    targetSide = dy >= 0 ? "top" : "bottom";
    const horizontalSkew = dx / absDy;
    sourceOffset = 50 + horizontalSkew * 35;
    targetOffset = 50 - horizontalSkew * 35;
  }

  return {
    sourceHandle: boundaryHandleId(sourceSide, sourceOffset),
    targetHandle: boundaryHandleId(targetSide, targetOffset),
  };
}

// ── Graph builder — turns a data-layer DagSpec into ReactFlow nodes/edges.
// Pulled out of the single-dag effect so both the main interactive panel
// and the small non-interactive grid (MiniDagGrid, for stacked diagrams
// like the four d-separation structures) share the same logic. ──

function buildFlowGraph(dag: DagSpec, theme: { accent: string; accentText: string }) {
  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));

  const rfNodes: Node[] = dag.nodes.map((n) => ({
    id: n.id,
    type: "dagNode",
    position: n.position,
    data: {
      label: n.data.label,
      isLatent: n.isLatent || false,
      conditioned: n.conditioned || false,
      accentText: theme.accentText,
    },
  }));

  const rfEdges: Edge[] = dag.edges.map((e) => {
    const handles = inferExampleEdgeHandles(nodeMap.get(e.source), nodeMap.get(e.target));
    const severed = e.type === "severed";
    return {
      id: `e-${e.source}-${e.target}`,
      type: "deletable",
      source: e.source,
      target: e.target,
      label: e.label,
      ...handles,
      data: { severed },
      style: severed
        ? { stroke: "#9AA1AD", strokeWidth: 1.6, strokeDasharray: "6 5", opacity: 0.8 }
        : { stroke: theme.accent, strokeWidth: 1.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color: severed ? "#9AA1AD" : theme.accent },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

// ── MiniDag / MiniDagGrid — a small, non-interactive ReactFlow canvas per
// diagram, laid out in a grid. Used when a section defines `dags` (several
// small diagrams shown together) instead of a single `dag`. ──

function MiniDag({ dag, theme }: { dag: DagSpec; theme: { accent: string; accentText: string } }) {
  const { nodes, edges } = useMemo(() => buildFlowGraph(dag, theme), [dag, theme]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnDrag={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
      className="bg-white"
    />
  );
}

function MiniDagGrid({
  dags,
  layout,
  theme,
}: {
  dags: { id: string; label?: string; dag: DagSpec }[];
  layout?: { rows: number; cols: number };
  theme: { accent: string; accentText: string; tint: string };
}) {
  const cols = layout?.cols || Math.ceil(Math.sqrt(dags.length));
  return (
    <div
      className="w-full h-full overflow-auto p-3 md:p-4 grid gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(140px, 1fr))` }}
    >
      {dags.map((d) => (
        <div
          key={d.id}
          className="rounded-xl border flex flex-col overflow-hidden"
          style={{ borderColor: "rgba(20,23,31,0.08)" }}
        >
          <div style={{ height: 130 }}>
            <MiniDag dag={d.dag} theme={theme} />
          </div>
          {d.label && (
            <div
              className="text-center text-[11px] font-medium py-1.5"
              style={{ fontFamily: "'Inter', sans-serif", color: theme.accentText, background: theme.tint }}
            >
              {d.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Markdown renderers ──────────────────────────────────────────────────
// remark-gfm turns on pipe-table parsing (the primer's tables were
// rendering as raw "| a | b |" text without it). The paragraph renderer
// recognizes two patterns already used in the primer copy: a paragraph
// that's *only* italic text ("*Reference: ...*", "*Table 1: ...*",
// "*Figure 3: ...*") becomes a small caption, and a paragraph opening with
// "**Example:** ..." becomes a pull-quote-style callout in the section's
// accent color.

function soleChildOfType(children: ReactNode, type: string): any {
  const asArray = Array.isArray(children) ? children : [children];
  if (asArray.length !== 1) return null;
  const only = asArray[0];
  if (only && typeof only === "object" && (only as any).type === type) return only;
  return null;
}

function leadingText(node: any): string | null {
  const c = node?.props?.children;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && typeof c[0] === "string") return c[0];
  return null;
}

const mdComponents = {
  table: ({ children }: any) => (
    <div className="primer-table-wrap">
      <table>{children}</table>
    </div>
  ),
  p: ({ children }: any) => {
    const em = soleChildOfType(children, "em");
    if (em) return <p className="primer-caption">{children}</p>;

    const asArray = Array.isArray(children) ? children : [children];
    const first = asArray[0];
    if (first && typeof first === "object" && (first as any).type === "strong") {
      const text = leadingText(first);
      if (text?.startsWith("Example:")) {
        return <p className="primer-callout">{children}</p>;
      }
    }
    return <p>{children}</p>;
  },
};

// ── Types ───────────────────────────────────────────────────────────────

interface DagNodeSpec {
  id: string;
  data: { label: string };
  position: { x: number; y: number };
  isLatent?: boolean;
  // Renders as a filled/accent-colored node instead of an outlined one —
  // used to show a variable being conditioned on.
  conditioned?: boolean;
}

interface DagEdgeSpec {
  id: string;
  source: string;
  target: string;
  // "severed" renders as a dashed, muted-grey arrow (an edge cut by a
  // do-intervention); anything else renders as a normal causal arrow.
  type?: string;
  label?: string;
}

interface DagSpec {
  nodes: DagNodeSpec[];
  edges: DagEdgeSpec[];
}

interface PrimerSection {
  id: string;
  title: string;
  markdown: string;
  // A single interactive DAG shown in the side panel.
  dag?: DagSpec;
  // A row/grid of small, non-interactive DAGs shown together instead of
  // one big one (e.g. the four d-separation structures crossed with
  // active/inactive state, or a before/after do-intervention pair).
  dags?: { id: string; label?: string; dag: DagSpec }[];
  dagsLayout?: { rows: number; cols: number };
  // Static illustration (e.g. a hand-made SCM or Pearl's-ladder diagram)
  // shown in the side panel instead of a DAG. Only one of `dag` / `dags` /
  // `image` is expected per section; `dag` wins over `dags`, which wins
  // over `image`.
  image?: string;
}

// ── Component ───────────────────────────────────────────────────────────

export default function PrimerPage({ onBack }: { onBack?: () => void }) {
  const [sections, setSections] = useState<PrimerSection[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dagVisible, setDagVisible] = useState(true);

  const [panelWidth, setPanelWidth] = useState(42);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const res = await fetch(apiUrl("/primer-sections"));
        const data = await res.json();
        setSections(data);
      } catch (e) {
        console.error("Failed to load primer sections:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchSections();
  }, []);

  const section = sections[activeIdx];
  const theme = themeFor(section?.id);
  const hasPanel = Boolean(section?.dag || section?.dags || section?.image);

  // Builds nodes/edges the way DAGPlayground's loadExample does, via the
  // shared buildFlowGraph helper. Only runs for the single-dag case;
  // `dags` (the grid) builds its own graphs internally per mini-diagram.
  useEffect(() => {
    if (!section?.dag) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const { nodes: rfNodes, edges: rfEdges } = buildFlowGraph(section.dag, theme);
    setNodes(rfNodes);
    setEdges(rfEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, setNodes, setEdges]);

  // React Flow's `fitView` prop only fits once, on first mount — it does
  // NOT refit when nodes change on section navigation, which is why the
  // diagram used to drift out of frame after the first section. Refit
  // explicitly whenever the active section (or panel visibility) changes,
  // once the new nodes have actually landed in the store.
  useEffect(() => {
    if (!section?.dag || !dagVisible) return;
    const raf = requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({ padding: 0.18, duration: 350 });
    });
    return () => cancelAnimationFrame(raf);
  }, [section?.id, dagVisible, section?.dag]);

  const goPrev = useCallback(() => setActiveIdx((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setActiveIdx((i) => Math.min(sections.length - 1, i + 1)),
    [sections.length]
  );

  // ── Resizable panel separator ──
  const onSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setPanelWidth(Math.min(75, Math.max(25, 100 - pct)));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "#F7F7F5" }}>
        <Loader2 className="animate-spin" style={{ color: "#0F172A" }} size={32} />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400" style={{ background: "#F7F7F5" }}>
        No foundations sections available.
      </div>
    );
  }

  const ordinal = String(activeIdx + 1).padStart(2, "0");

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#F7F7F5" }}>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap");

        .primer-markdown {
          font-family: "Inter", sans-serif;
          color: #2b3040;
          line-height: 1.75;
          font-size: 1.0625rem;
        }
        .primer-markdown h1 {
          font-family: "Inter", sans-serif;
          font-weight: 500;
          font-size: 0.9rem;
          margin: 0 0 2rem;
          color: #9aa1ad;
        }
        .primer-markdown h2 {
          font-family: "Shippori Mincho", serif;
          font-weight: 600;
          font-size: 1.75rem;
          margin: 2.75rem 0 1.1rem;
          color: #0F172A;
        }
        .primer-markdown h3 {
          font-family: "Shippori Mincho", serif;
          font-weight: 600;
          font-size: 1.25rem;
          margin: 2.1rem 0 0.8rem;
          color: var(--accent, #3f4863);
        }
        .primer-markdown p {
          margin: 0 0 1.2rem;
        }
        /* list markers restored in globals.css (overrides Tailwind preflight) */
        .primer-markdown strong {
          font-weight: 700;
          color: #0F172A;
        }
        .primer-markdown em {
          font-style: italic;
          color: #5b6472;
        }
        .primer-markdown a {
          color: var(--accent, #3f4863);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .primer-markdown code {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          font-size: 0.92em;
          background: var(--accent-tint, rgba(0, 0, 0, 0.04));
          border-radius: 6px;
          padding: 0.12rem 0.4rem;
        }
        .primer-markdown pre {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          font-size: 0.95rem;
          background: var(--accent-tint, rgba(0, 0, 0, 0.04));
          border-radius: 12px;
          padding: 0.9rem 1.1rem;
          margin: 0.3rem 0 1.6rem;
          overflow-x: auto;
          color: #0F172A;
        }
        .primer-markdown pre code {
          background: none;
          padding: 0;
        }
        .primer-markdown .katex {
          font-size: 1.05em;
        }
        .primer-markdown .katex-display {
          margin: 1.2rem auto;
          padding: 1.4rem 1.6rem;
          max-width: 28rem;
          text-align: center;
          background: var(--accent-tint, rgba(0, 0, 0, 0.04));
          border: 1px solid var(--accent-tint, rgba(0, 0, 0, 0.06));
          border-radius: 16px;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .primer-markdown .katex-display .katex {
          font-size: 1.15em;
        }
        .primer-caption {
          font-family: "Inter", sans-serif;
          font-style: italic;
          font-size: 0.8125rem;
          color: #9aa1ad;
          margin: -0.5rem 0 1.6rem;
        }
        .primer-caption em {
          color: inherit;
        }
        .primer-callout {
          position: relative;
          background: var(--accent-tint, rgba(0, 0, 0, 0.04));
          border-radius: 14px;
          padding: 1.15rem 1.4rem 1.15rem 3rem;
          margin: 0.5rem 0 1.6rem;
          font-size: 1rem;
        }
        .primer-callout::before {
          content: "“";
          position: absolute;
          left: 1rem;
          top: 0.55rem;
          font-family: "Shippori Mincho", serif;
          font-weight: 700;
          font-size: 2.25rem;
          line-height: 1;
          color: var(--accent, #3f4863);
          opacity: 0.6;
        }
        .primer-callout strong {
          color: var(--accent, #3f4863);
        }
        .primer-markdown img {
          max-width: 100%;
          height: auto;
          border-radius: 14px;
          margin: 0.5rem 0 1.8rem;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.05);
        }
        .primer-table-wrap {
          overflow-x: auto;
          margin: 0.5rem 0 1.8rem;
          border-radius: 16px;
          box-shadow: 0 1px 2px rgba(20, 23, 31, 0.06), 0 0 0 1px rgba(20, 23, 31, 0.05);
        }
        .primer-markdown table {
          width: 100%;
          border-collapse: collapse;
          font-family: "Inter", sans-serif;
          font-size: 0.875rem;
        }
        .primer-markdown thead {
          background: var(--accent-tint, rgba(0, 0, 0, 0.04));
        }
        .primer-markdown th {
          text-align: left;
          font-weight: 700;
          font-size: 0.8125rem;
          padding: 0.75rem 1rem;
          color: var(--accent, #3f4863);
          white-space: nowrap;
        }
        .primer-markdown td {
          padding: 0.7rem 1rem;
          border-top: 1px solid rgba(20, 23, 31, 0.06);
          color: #3a4150;
        }
        .primer-ladder-rail::-webkit-scrollbar {
          height: 4px;
        }
      `}</style>

      {/* Top bar — back button, position ("03/07"), and the numbered
          section stepper all together at the top, plus the diagram
          toggle on the far right. One bar for every screen size; it
          scrolls horizontally on narrow viewports instead of wrapping. */}
      <header className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E3E5EA" }}>
        <div className="flex items-center gap-3 md:gap-5 px-4 md:px-6 py-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg flex-shrink-0 transition-colors hover:bg-slate-100"
              style={{ color: hexToRgba("#0F172A", 0.6) }}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span
            className="text-[11px] font-semibold tracking-wide flex-shrink-0"
            style={{ fontFamily: "'Inter', sans-serif", color: hexToRgba("#0F172A", 0.55) }}
          >
            {ordinal}/{String(sections.length).padStart(2, "0")}
          </span>

          <nav className="primer-ladder-rail relative flex items-center overflow-x-auto flex-1 min-w-0 py-1">
            <div className="absolute left-0 right-0 h-px" style={{ top: "50%", background: hexToRgba("#0F172A", 0.12) }} />
            {sections.map((s, i) => {
              const t = themeFor(s.id);
              const active = i === activeIdx;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveIdx(i)}
                  className="relative z-10 flex items-center justify-center mx-1.5 md:mx-2 shrink-0 group"
                  title={s.title}
                >
                  <span
                    className="rounded-full flex items-center justify-center transition-all duration-200"
                    style={{
                      width: active ? 32 : 24,
                      height: active ? 32 : 24,
                      background: active ? t.accent : "#FFFFFF",
                      border: `2px solid ${active ? t.accent : hexToRgba("#0F172A", 0.25)}`,
                      color: active ? "#0F172A" : hexToRgba("#0F172A", 0.5),
                      fontFamily: "'Shippori Mincho', serif",
                      fontWeight: 600,
                      fontSize: active ? "0.8rem" : "0.65rem",
                      boxShadow: active ? `0 0 0 4px ${hexToRgba(t.accent, 0.2)}` : "none",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="absolute top-full mt-2 whitespace-nowrap text-xs font-medium px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 hidden md:block"
                    style={{ background: "#0F172A", color: "#FFFFFF", fontFamily: "'Inter', sans-serif" }}
                  >
                    {s.title}
                  </span>
                </button>
              );
            })}
          </nav>

          {hasPanel && (
            <button
              onClick={() => setDagVisible((v) => !v)}
              className="p-1.5 md:px-3 md:py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 flex-shrink-0 border transition-colors"
              style={
                dagVisible
                  ? { fontFamily: "'Inter', sans-serif", color: theme.accentText, borderColor: theme.accent, background: theme.tint }
                  : { fontFamily: "'Inter', sans-serif", color: hexToRgba("#0F172A", 0.6), borderColor: "#E3E5EA", background: "#fff" }
              }
              aria-label="Toggle diagram"
            >
              <PanelRightOpen size={16} />
              <span className="hidden md:inline">Diagram</span>
            </button>
          )}
        </div>
      </header>

      {/* Body: split pane */}
      <div ref={containerRef} className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Reading pane */}
          <div
            className="flex-1 overflow-y-auto custom-scrollbar transition-colors duration-300"
            style={{ background: theme.tint, flex: hasPanel && dagVisible ? `0 0 ${100 - panelWidth}%` : undefined }}
          >
            <div className="max-w-[720px] mx-auto px-6 md:px-12 py-10 md:py-16">
              {/* Hero */}
              <div className="mb-8 md:mb-10">
                <h1
                  style={{
                    fontFamily: "'Shippori Mincho', serif",
                    fontWeight: 600,
                    fontSize: "clamp(1.9rem, 4vw, 2.6rem)",
                    color: "#0F172A",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {section.title}
                </h1>
              </div>

              <article
                className="primer-markdown"
                style={{ ["--accent" as any]: theme.accentText, ["--accent-tint" as any]: theme.tint }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={mdComponents}
                >
                  {section.markdown}
                </ReactMarkdown>
              </article>

              {/* Prev / Next footer */}
              <div className="flex items-center justify-between mt-12 pt-6" style={{ borderTop: "1px solid rgba(20,23,31,0.08)" }}>
                <button
                  onClick={goPrev}
                  disabled={activeIdx === 0}
                  className="px-4 py-2 rounded-full border text-sm font-medium hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
                  style={{ borderColor: "rgba(20,23,31,0.12)", color: "#3A4150", fontFamily: "'Inter', sans-serif" }}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <button
                  onClick={activeIdx === sections.length - 1 ? onBack : goNext}
                  disabled={activeIdx === sections.length - 1 && !onBack}
                  className="px-4 py-2 rounded-full text-sm font-medium text-white flex items-center gap-1.5 disabled:cursor-not-allowed transition-colors"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    background: activeIdx === sections.length - 1 && !onBack ? "#C7CBD1" : theme.accentText,
                  }}
                >
                  {activeIdx === sections.length - 1 && onBack ? (
                    <>Finish <Check size={16} /></>
                  ) : (
                    <>Next <ChevronRight size={16} /></>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Draggable separator — only on desktop when panel is visible */}
          {hasPanel && dagVisible && (
            <div
              onMouseDown={onSeparatorMouseDown}
              className="hidden lg:flex flex-shrink-0 items-center justify-center w-[5px] cursor-col-resize group relative z-10"
              style={{ background: "rgba(20,23,31,0.06)" }}
            >
              <div className="w-[3px] h-10 rounded-full transition-colors group-hover:bg-slate-400" style={{ background: "rgba(20,23,31,0.15)" }} />
            </div>
          )}

          {/* Side panel — stacks below the reading pane on small screens.
              Interactive DAG when the section defines one; a grid of small
              DAGs when it defines `dags`; otherwise a static illustration
              when it sets `image`. Rendered only when one of the three
              exists — a blank canvas isn't a design, it's a bug. */}
          {hasPanel && dagVisible && (
            <div
              className="w-full h-[46vh] lg:h-auto min-h-[320px] flex-shrink-0 relative overflow-hidden border-t lg:border-t-0 lg:border-l"
              style={{
                background: "#FFFFFF",
                borderColor: "rgba(20,23,31,0.06)",
                boxShadow: "0 -4px 24px rgba(20,23,31,0.03), 4px 0 24px rgba(20,23,31,0.03)",
                flex: `0 0 ${panelWidth}%`,
              }}
            >
              {section.dag ? (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onInit={(instance) => {
                    rfInstanceRef.current = instance;
                    instance.fitView({ padding: 0.18 });
                  }}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  connectionMode={ConnectionMode.Loose}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  elementsSelectable={false}
                  fitView
                  defaultEdgeOptions={{
                    markerEnd: { type: MarkerType.ArrowClosed },
                  }}
                  className="bg-white"
                >
                  <Controls className="!rounded-xl !border-slate-200 !shadow-lg" showInteractive={false} />
                  <MiniMap
                    nodeBorderRadius={12}
                    nodeColor={() => hexToRgba(theme.accent, 0.18)}
                    className="!rounded-xl !border-slate-200 !shadow-lg"
                    pannable
                    zoomable
                  />
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={hexToRgba(theme.accent, 0.3)} />
                </ReactFlow>
              ) : section.dags ? (
                <MiniDagGrid dags={section.dags} layout={section.dagsLayout} theme={theme} />
              ) : (
                section.image && (
                  <div className="w-full h-full flex items-center justify-center p-4 md:p-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={section.image}
                      alt={`${section.title} diagram`}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
  );
}