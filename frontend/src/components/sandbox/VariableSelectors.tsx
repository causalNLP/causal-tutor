"use client";

import { useMemo } from "react";
import { Loader2, Play, AlertTriangle, RotateCcw } from "lucide-react";
import type { VariableSelection } from "@/types";

const METHODS: { value: string; label: string }[] = [
  { value: "ols", label: "OLS" },
  { value: "did", label: "Difference-in-Differences" },
  { value: "iv", label: "Instrumental Variables" },
  { value: "rdd", label: "Regression Discontinuity" },
  { value: "matching", label: "Propensity Score Matching" },
  { value: "frontdoor", label: "Front-door Criterion" },
];

interface VariableSelectorsProps {
  columns: string[];
  method: string;
  vars: VariableSelection;
  running: boolean;
  onMethodChange: (m: string) => void;
  onVarsChange: (v: VariableSelection) => void;
  onRun: () => void;
  onReset: () => void;
}

export default function VariableSelectors({
  columns,
  method,
  vars,
  running,
  onMethodChange,
  onVarsChange,
  onRun,
  onReset,
}: VariableSelectorsProps) {
  const update = (patch: Partial<VariableSelection>) => onVarsChange({ ...vars, ...patch });

  const needsInstrument = method === "iv";
  const needsRunningVar = method === "rdd";
  const needsPanelVars = method === "did";
  const needsMediator = method === "frontdoor";

  const warning = useMemo(() => {
    if (needsInstrument && !vars.instrument)
      return "IV requires an instrument. Pick a column whose variation is plausibly random (unaffected by unobserved confounders).";
    if (needsRunningVar && !vars.running_var)
      return "RDD requires a running (assignment) variable and a cutoff.";
    if (needsPanelVars && (!vars.temporal_var || !vars.state_var))
      return "DiD requires both a time variable and a unit/entity variable.";
    if (needsMediator && !vars.mediator)
      return "Front-door requires a mediator column on the pathway T → M → Y.";
    if (method === "matching" && vars.controls.length === 0)
      return "Matching requires at least one covariate to build the propensity score.";
    return null;
  }, [method, vars, needsInstrument, needsRunningVar, needsPanelVars, needsMediator]);

  const runDisabled = running || warning !== null || !vars.treatment || !vars.outcome;

  const toggleControl = (c: string) => {
    if (vars.controls.includes(c)) {
      update({ controls: vars.controls.filter((x) => x !== c) });
    } else {
      update({ controls: [...vars.controls, c] });
    }
  };

  const labelClass = "block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1";
  const selectClass =
    "w-full text-sm px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-50";

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-1">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Variables & Method
        </span>
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
          title="Reset to metadata defaults"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <div>
        <label className={labelClass}>Method</label>
        <select
          value={method}
          onChange={(e) => onMethodChange(e.target.value)}
          className={selectClass}
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Treatment</label>
          <select
            value={vars.treatment}
            onChange={(e) => update({ treatment: e.target.value })}
            className={selectClass}
          >
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Outcome</label>
          <select
            value={vars.outcome}
            onChange={(e) => update({ outcome: e.target.value })}
            className={selectClass}
          >
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Controls - multi-select checkbox list */}
      <div>
        <label className={labelClass}>
          Controls <span className="text-slate-400 normal-case font-normal">(check to include)</span>
        </label>
        <div className="max-h-28 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 bg-slate-50/50 space-y-1">
          {columns
            .filter((c) => c !== vars.treatment && c !== vars.outcome)
            .map((c) => (
              <label key={c} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-white px-1.5 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={vars.controls.includes(c)}
                  onChange={() => toggleControl(c)}
                  className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-mono">{c}</span>
              </label>
            ))}
        </div>
      </div>

      {/* Method-specific */}
      {needsInstrument && (
        <div>
          <label className={labelClass}>Instrument (Z)</label>
          <select
            value={vars.instrument ?? ""}
            onChange={(e) => update({ instrument: e.target.value || null })}
            className={selectClass}
          >
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsRunningVar && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Running var</label>
            <select
              value={vars.running_var ?? ""}
              onChange={(e) => update({ running_var: e.target.value || null })}
              className={selectClass}
            >
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Cutoff</label>
            <input
              type="number"
              step="any"
              value={vars.cutoff ?? ""}
              onChange={(e) =>
                update({ cutoff: e.target.value === "" ? null : parseFloat(e.target.value) })
              }
              className={selectClass}
              placeholder="auto: median"
            />
          </div>
        </div>
      )}

      {needsPanelVars && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Time variable</label>
            <select
              value={vars.temporal_var ?? ""}
              onChange={(e) => update({ temporal_var: e.target.value || null })}
              className={selectClass}
            >
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Unit variable</label>
            <select
              value={vars.state_var ?? ""}
              onChange={(e) => update({ state_var: e.target.value || null })}
              className={selectClass}
            >
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {needsMediator && (
        <div>
          <label className={labelClass}>Mediator (M)</label>
          <select
            value={vars.mediator ?? ""}
            onChange={(e) => update({ mediator: e.target.value || null })}
            className={selectClass}
          >
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Warning */}
      {warning && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-amber-800 leading-relaxed">{warning}</span>
        </div>
      )}

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
        {running ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Running…
          </>
        ) : (
          <>
            <Play size={14} strokeWidth={2.5} fill="currentColor" /> Run estimation
          </>
        )}
      </button>
    </div>
  );
}
