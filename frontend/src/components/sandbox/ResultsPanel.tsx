"use client";

import { AlertTriangle, CheckCircle2, Target, Bot, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type {
  EstimateResponse,
  SandboxIssue,
  ForestPlotData,
  ParallelTrendsPlotData,
  FirstStagePlotData,
  DiscontinuityPlotData,
  CovariateBalancePlotData,
  MediationPlotData,
} from "@/types";
import ForestPlot from "./plots/ForestPlot";
import ParallelTrendsPlot from "./plots/ParallelTrendsPlot";
import FirstStagePlot from "./plots/FirstStagePlot";
import DiscontinuityPlot from "./plots/DiscontinuityPlot";
import CovariateBalancePlot from "./plots/CovariateBalancePlot";
import MediationDiagram from "./plots/MediationDiagram";

interface ResultsPanelProps {
  result: EstimateResponse | null;
  interpretation: string;
  running: boolean;
  errorMessage?: string;
}

function fmt(v: number | null, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-lg border ${accent ?? "border-slate-200 bg-white"} flex flex-col`}
    >
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-sm font-mono font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

function issueRank(issue: SandboxIssue): number {
  if (issue.severity === "blocking") return 0;
  if (issue.severity === "warning") return 1;
  return 2;
}

function fallbackIssues(warnings: string[]): SandboxIssue[] {
  return warnings.map((warning) => ({
    severity: "warning",
    title: "Sandbox warning",
    message: warning,
    fix_steps: [],
    field: null,
  }));
}

function IssuesPanel({ issues }: { issues: SandboxIssue[] }) {
  if (issues.length === 0) return null;

  const ordered = [...issues].sort((a, b) => issueRank(a) - issueRank(b));
  const hasBlocking = ordered.some((issue) => issue.severity === "blocking");
  const tone = hasBlocking
    ? "bg-rose-50 border-rose-100 text-rose-900"
    : "bg-amber-50 border-amber-100 text-amber-900";
  const iconClass = hasBlocking ? "text-rose-600" : "text-amber-600";
  const label = hasBlocking ? "Needs attention" : "Warnings";

  return (
    <div className={`border rounded-xl p-4 ${tone}`}>
      <div className="flex items-center gap-2 font-bold text-xs uppercase mb-3">
        <AlertTriangle size={14} className={iconClass} /> {label}
      </div>
      <div className="space-y-3">
        {ordered.map((issue, i) => (
          <div key={`${issue.title}-${i}`} className="text-xs leading-relaxed">
            <div className="font-semibold">{issue.title}</div>
            <p className="mt-0.5">{issue.message}</p>
            {issue.fix_steps.length > 0 && (
              <ol className="list-decimal list-inside mt-1.5 space-y-0.5">
                {issue.fix_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderPlot(result: EstimateResponse) {
  switch (result.plot_type) {
    case "forest":
      return <ForestPlot data={result.plot_data as unknown as ForestPlotData} />;
    case "parallel_trends":
      return <ParallelTrendsPlot data={result.plot_data as unknown as ParallelTrendsPlotData} />;
    case "first_stage":
      return <FirstStagePlot data={result.plot_data as unknown as FirstStagePlotData} />;
    case "discontinuity":
      return <DiscontinuityPlot data={result.plot_data as unknown as DiscontinuityPlotData} />;
    case "covariate_balance":
      return <CovariateBalancePlot data={result.plot_data as unknown as CovariateBalancePlotData} />;
    case "mediation":
      return <MediationDiagram data={result.plot_data as unknown as MediationPlotData} />;
    default:
      return (
        <div className="text-center text-slate-400 text-xs py-8">
          No diagnostic plot available for this estimation.
        </div>
      );
  }
}

export default function ResultsPanel({ result, interpretation, running, errorMessage }: ResultsPanelProps) {
  if (!result && !running) {
    if (errorMessage) {
      return (
        <div className="bg-rose-50 border border-rose-100 rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase mb-2">
            <AlertTriangle size={14} /> Sandbox could not run
          </div>
          <p className="text-sm text-rose-900 leading-relaxed">{errorMessage}</p>
          <ol className="list-decimal list-inside text-xs text-rose-900 mt-3 space-y-1">
            <li>Click Reset to restore the curated variables.</li>
            <li>Check that treatment and outcome are selected.</li>
            <li>Run the estimate again after changing one selector at a time.</li>
          </ol>
        </div>
      );
    }

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-center">
        <Target size={32} className="mx-auto text-slate-300 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-slate-500 font-medium">No results yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Choose your variables and click <span className="font-semibold">Run estimation</span>.
        </p>
      </div>
    );
  }

  if (running && !result) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center">
        <Loader2 size={28} className="mx-auto text-cyan-500 mb-3 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Running estimation…</p>
      </div>
    );
  }

  if (!result) return null;

  const gt = result.ground_truth;
  let gtAccent = "border-slate-200 bg-white";
  let gtLabel = "Ground truth";
  let gtIcon: JSX.Element | null = null;
  if (gt.within_ci === true) {
    gtAccent = "border-emerald-200 bg-emerald-50";
    gtLabel = "Ground truth · within CI";
    gtIcon = <CheckCircle2 size={11} className="text-emerald-600 inline -mt-0.5 mr-0.5" />;
  } else if (gt.within_ci === false) {
    const deltaPct = gt.delta !== null && gt.effect !== 0 ? Math.abs(gt.delta / gt.effect) : 1;
    if (deltaPct <= 0.3) {
      gtAccent = "border-amber-200 bg-amber-50";
      gtLabel = "Ground truth · close";
    } else {
      gtAccent = "border-rose-200 bg-rose-50";
      gtLabel = "Ground truth · far off";
      gtIcon = <AlertTriangle size={11} className="text-rose-600 inline -mt-0.5 mr-0.5" />;
    }
  }

  const hasEstimate = result.estimate !== null;
  const issues =
    result.issues && result.issues.length > 0
      ? result.issues
      : fallbackIssues(result.warnings);

  return (
    <div className="space-y-4">
      {/* Estimate cards */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Estimation Result · {result.method.toUpperCase()}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          <StatCard
            label="Estimate"
            value={fmt(result.estimate)}
            accent="border-indigo-200 bg-indigo-50"
          />
          <StatCard label="Std. Error" value={fmt(result.std_error)} />
          <StatCard
            label="95% CI"
            value={
              result.ci_low !== null && result.ci_high !== null
                ? `[${fmt(result.ci_low, 2)}, ${fmt(result.ci_high, 2)}]`
                : "—"
            }
          />
          <StatCard
            label="p-value"
            value={result.p_value !== null ? fmt(result.p_value, 4) : "—"}
          />
          <StatCard
            label={gtLabel}
            value={`${fmt(gt.effect)}${
              gt.delta !== null ? `  (Δ ${gt.delta >= 0 ? "+" : ""}${fmt(gt.delta, 2)})` : ""
            }`}
            accent={gtAccent}
          />
        </div>
      </div>

      {/* Diagnostic plot */}
      {hasEstimate && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            Diagnostic
          </div>
          {renderPlot(result)}
        </div>
      )}

      {/* Issues */}
      {issues.length > 0 && <IssuesPanel issues={issues} />}

      {/* Assumptions */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
          Identifying assumptions
        </div>
        <ul className="space-y-1.5">
          {result.assumptions.map((a, i) => (
            <li key={i} className="text-xs text-slate-700 leading-relaxed flex items-start gap-2">
              <CheckCircle2 size={12} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* LLM interpretation */}
      {hasEstimate && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            <Bot size={14} className="text-indigo-600" /> AI Interpretation
          </div>
          {interpretation ? (
            <div className="prose prose-slate prose-sm max-w-none text-[13px] text-slate-700 border-l-4 border-indigo-200 pl-4">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {interpretation}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Generating interpretation…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
