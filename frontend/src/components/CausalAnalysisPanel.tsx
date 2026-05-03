"use client";

import { useState, useMemo } from "react";
import {
  X, Target, Play, Loader2, CheckCircle2, AlertTriangle,
  XCircle, MousePointerClick, Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { AnalysisPathInfo, CausalAnalysisResult } from "@/types";

interface NodeOption {
  id: string;
  label: string;
  isLatent?: boolean;
}

interface CausalAnalysisPanelProps {
  isOpen: boolean;
  onClose: () => void;

  nodes: NodeOption[];

  treatmentId: string | null;
  outcomeId: string | null;
  confounderIds: string[];

  onSetTreatment: (id: string | null) => void;
  onSetOutcome: (id: string | null) => void;
  onSetConfounders: (ids: string[]) => void;

  // Click-to-assign mode (for assignment via canvas clicks)
  assignMode: "T" | "Y" | "Z" | null;
  onSetAssignMode: (m: "T" | "Y" | "Z" | null) => void;

  result: CausalAnalysisResult | null;
  loading: boolean;
  onRun: () => void;
  onClearResult: () => void;
}

const labelClass = "block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1";
const selectClass =
  "flex-1 text-sm px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50";

function NodeSelect({
  value,
  onChange,
  options,
  placeholder,
  excludeIds = [],
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  options: NodeOption[];
  placeholder: string;
  excludeIds?: string[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={selectClass}
    >
      <option value="">{placeholder}</option>
      {options
        .filter((n) => !excludeIds.includes(n.id))
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.label}
            {n.isLatent ? " (latent)" : ""}
          </option>
        ))}
    </select>
  );
}

function PickToggleButton({
  active,
  onClick,
  title,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg border transition-all flex-shrink-0 ${
        active
          ? "bg-indigo-50 border-indigo-300 text-indigo-700"
          : "bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300"
      }`}
    >
      <MousePointerClick size={14} />
    </button>
  );
}

function PathRow({ path, nodeLabels }: { path: AnalysisPathInfo; nodeLabels: Record<string, string> }) {
  const typeColor =
    path.path_type === "directed"
      ? "bg-emerald-100 text-emerald-700"
      : path.path_type === "backdoor"
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-100 text-slate-600";

  const statusColor = path.is_blocked
    ? "bg-slate-100 text-slate-600 border-slate-200"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <div className="border border-slate-100 rounded-lg p-2.5 text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase whitespace-nowrap ${typeColor}`}>
          {path.path_type}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase whitespace-nowrap border ${statusColor}`}>
          {path.is_blocked ? "blocked" : "open"}
        </span>
      </div>
      <div className="font-mono text-[12px] text-slate-700 break-words">
        {path.path.map((n) => nodeLabels[n] || n).join(" — ")}
      </div>
      {path.block_reason && (
        <div className="text-[11px] text-slate-500 italic">{path.block_reason}</div>
      )}
    </div>
  );
}

export default function CausalAnalysisPanel(props: CausalAnalysisPanelProps) {
  const {
    isOpen, onClose, nodes,
    treatmentId, outcomeId, confounderIds,
    onSetTreatment, onSetOutcome, onSetConfounders,
    assignMode, onSetAssignMode,
    result, loading, onRun, onClearResult,
  } = props;

  const [confounderToAdd, setConfounderToAdd] = useState<string>("");

  const nodeLabels = useMemo(() => {
    const m: Record<string, string> = {};
    nodes.forEach((n) => (m[n.id] = n.label));
    return m;
  }, [nodes]);

  const addConfounder = (id: string) => {
    if (!id || confounderIds.includes(id)) return;
    onSetConfounders([...confounderIds, id]);
    setConfounderToAdd("");
  };

  const removeConfounder = (id: string) => {
    onSetConfounders(confounderIds.filter((x) => x !== id));
  };

  const applyMinimalSet = () => {
    if (result?.minimal_adjustment_set) {
      onSetConfounders(result.minimal_adjustment_set);
      onClearResult();
    }
  };

  const runDisabled = !treatmentId || !outcomeId || loading;

  if (!isOpen) return null;

  // Verdict styling
  let verdictClass = "bg-slate-50 border-slate-200 text-slate-700";
  let verdictIcon: JSX.Element = <Target size={16} />;
  let verdictLabel = "Run analysis";
  if (result) {
    if (result.backdoor_satisfied) {
      verdictClass = "bg-emerald-50 border-emerald-200 text-emerald-800";
      verdictIcon = <CheckCircle2 size={16} className="text-emerald-600" />;
      verdictLabel = result.d_separated
        ? "Identifiable (also d-separated)"
        : "Backdoor criterion satisfied";
    } else {
      verdictClass = "bg-rose-50 border-rose-200 text-rose-800";
      verdictIcon = <XCircle size={16} className="text-rose-600" />;
      verdictLabel = "Backdoor criterion NOT satisfied";
    }
  }

  const confounderExclude = [
    ...(treatmentId ? [treatmentId] : []),
    ...(outcomeId ? [outcomeId] : []),
    ...confounderIds,
  ];

  return (
    <div className="w-[380px] flex-shrink-0 border-l border-slate-200 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-indigo-600" />
          <h3 className="font-bold text-sm text-slate-800">Causal Analysis</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* Role assignment */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Assign Roles
          </div>

          {/* Treatment */}
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-indigo-600 text-white text-[9px] w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                  T
                </span>
                Treatment
              </span>
            </label>
            <div className="flex items-center gap-2">
              <NodeSelect
                value={treatmentId}
                onChange={onSetTreatment}
                options={nodes}
                placeholder="— pick a node —"
                excludeIds={outcomeId ? [outcomeId] : []}
              />
              <PickToggleButton
                active={assignMode === "T"}
                onClick={() => onSetAssignMode(assignMode === "T" ? null : "T")}
                title="Click on canvas to assign"
              />
            </div>
          </div>

          {/* Outcome */}
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-rose-600 text-white text-[9px] w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                  Y
                </span>
                Outcome
              </span>
            </label>
            <div className="flex items-center gap-2">
              <NodeSelect
                value={outcomeId}
                onChange={onSetOutcome}
                options={nodes}
                placeholder="— pick a node —"
                excludeIds={treatmentId ? [treatmentId] : []}
              />
              <PickToggleButton
                active={assignMode === "Y"}
                onClick={() => onSetAssignMode(assignMode === "Y" ? null : "Y")}
                title="Click on canvas to assign"
              />
            </div>
          </div>

          {/* Confounders */}
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-amber-500 text-white text-[9px] w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                  Z
                </span>
                Confounders / Adjustment set
              </span>
            </label>
            <div className="flex items-center gap-2 mb-2">
              <select
                value={confounderToAdd}
                onChange={(e) => addConfounder(e.target.value)}
                className={selectClass}
              >
                <option value="">— add a confounder —</option>
                {nodes
                  .filter((n) => !confounderExclude.includes(n.id))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                      {n.isLatent ? " (latent)" : ""}
                    </option>
                  ))}
              </select>
              <PickToggleButton
                active={assignMode === "Z"}
                onClick={() => onSetAssignMode(assignMode === "Z" ? null : "Z")}
                title="Click on canvas to add confounder"
              />
            </div>
            {confounderIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {confounderIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded-full"
                  >
                    {nodeLabels[id] || id}
                    <button
                      onClick={() => removeConfounder(id)}
                      className="hover:bg-amber-200 rounded-full"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 italic">
                No confounders selected. Z = ∅ (empty set).
              </p>
            )}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={onRun}
          disabled={runDisabled}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            runDisabled
              ? "bg-slate-100 text-slate-300 cursor-not-allowed"
              : "bg-slate-900 text-white hover:bg-black shadow-md hover:shadow-lg"
          }`}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Analyzing…
            </>
          ) : (
            <>
              <Play size={14} strokeWidth={2.5} fill="currentColor" /> Run Analysis
            </>
          )}
        </button>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            {/* Verdict */}
            <div className={`rounded-xl border p-3 ${verdictClass}`}>
              <div className="flex items-center gap-2 mb-1.5 font-bold text-xs uppercase tracking-wider">
                {verdictIcon} {verdictLabel}
              </div>
              <div className="text-[12px] leading-relaxed prose prose-sm max-w-none">
                <ReactMarkdown>{result.explanation}</ReactMarkdown>
              </div>
            </div>

            {/* Issues */}
            {result.backdoor_issues.length > 0 && (
              <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-rose-700 font-bold text-[11px] uppercase mb-1.5">
                  <AlertTriangle size={12} /> Issues
                </div>
                <ul className="space-y-1">
                  {result.backdoor_issues.map((issue, i) => (
                    <li key={i} className="text-[12px] text-rose-900 leading-relaxed flex items-start gap-1.5">
                      <span className="text-rose-400 mt-0.5">•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggested Z */}
            {result.minimal_adjustment_set !== null && result.minimal_adjustment_set !== undefined && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-[11px] uppercase mb-1.5">
                  <Sparkles size={12} /> Suggested minimal adjustment set
                </div>
                {result.minimal_adjustment_set.length === 0 ? (
                  <p className="text-[12px] text-indigo-900">
                    Empty set — no observed confounders are needed to satisfy the backdoor criterion.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {result.minimal_adjustment_set.map((id) => (
                        <span
                          key={id}
                          className="bg-white border border-indigo-200 text-indigo-700 text-xs font-medium px-2 py-0.5 rounded-full"
                        >
                          {nodeLabels[id] || id}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={applyMinimalSet}
                      className="w-full text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 py-1.5 rounded-lg transition-colors"
                    >
                      Apply to Z
                    </button>
                  </>
                )}
              </div>
            )}

            {/* D-separation summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <div className="font-bold text-slate-500 uppercase text-[10px] tracking-wider mb-1">
                D-Separation
              </div>
              <p className="text-slate-700 font-mono text-[12px]">
                {treatmentId && outcomeId ? (
                  <>
                    {nodeLabels[treatmentId]} {result.d_separated ? "⊥" : "⊥̸"}{" "}
                    {nodeLabels[outcomeId]} | Z ={" "}
                    {confounderIds.length === 0
                      ? "∅"
                      : "{" + confounderIds.map((c) => nodeLabels[c] || c).join(", ") + "}"}
                  </>
                ) : null}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {result.d_separated
                  ? "These variables are conditionally independent given Z."
                  : "These variables remain dependent given Z (which is expected if directed paths remain open)."}
              </p>
            </div>

            {/* Path table */}
            {result.paths.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                  Paths ({result.paths.length})
                </div>
                {result.paths.map((p, i) => (
                  <PathRow key={i} path={p} nodeLabels={nodeLabels} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
