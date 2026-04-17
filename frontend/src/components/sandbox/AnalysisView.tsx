"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import type {
  SandboxQuery,
  SandboxDatasetPreview,
  VariableSelection,
  EstimateResponse,
} from "@/types";
import DataTable from "./DataTable";
import VariableSelectors from "./VariableSelectors";
import ResultsPanel from "./ResultsPanel";

const METHOD_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  ols: { label: "OLS", bg: "bg-indigo-100", text: "text-indigo-700" },
  did: { label: "DiD", bg: "bg-emerald-100", text: "text-emerald-700" },
  iv: { label: "IV", bg: "bg-amber-100", text: "text-amber-700" },
  rdd: { label: "RDD", bg: "bg-rose-100", text: "text-rose-700" },
  matching: { label: "Matching", bg: "bg-cyan-100", text: "text-cyan-700" },
  frontdoor: { label: "Front-door", bg: "bg-violet-100", text: "text-violet-700" },
};

interface AnalysisViewProps {
  query: SandboxQuery;
  dataset: SandboxDatasetPreview | null;
  loadingDataset: boolean;
  method: string;
  vars: VariableSelection;
  result: EstimateResponse | null;
  interpretation: string;
  running: boolean;
  onBack: () => void;
  onRun: () => void;
  onReset: () => void;
  onMethodChange: (m: string) => void;
  onVarsChange: (v: VariableSelection) => void;
}

export default function AnalysisView(props: AnalysisViewProps) {
  const { query, dataset, loadingDataset, method, vars, result, interpretation, running,
    onBack, onRun, onReset, onMethodChange, onVarsChange } = props;

  const methodStyle = METHOD_STYLES[method] || { label: method.toUpperCase(), bg: "bg-slate-100", text: "text-slate-700" };
  const columns = dataset?.columns ?? [];

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-slate-50/50">
      {/* Header */}
      <header className="h-14 flex-shrink-0 flex items-center gap-3 px-4 sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200 z-20">
        <button
          onClick={onBack}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors flex items-center gap-1.5"
          title="Back to gallery"
        >
          <ArrowLeft size={16} />
          <span className="text-xs font-medium hidden md:inline">Back</span>
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`${methodStyle.bg} ${methodStyle.text} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0`}>
            {methodStyle.label}
          </span>
          <h2 className="font-bold text-sm text-slate-800 truncate">{query.title}</h2>
          <span className="bg-slate-50 text-slate-500 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-100 capitalize flex-shrink-0">
            {query.domain.replace("_", " ")}
          </span>
        </div>
      </header>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Research question banner */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Research Question
          </div>
          <p className="text-sm text-slate-800 font-medium italic leading-relaxed">
            {query.query}
          </p>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            {query.concept_highlight}
          </p>
        </div>

        {/* Top row: 2/5 selectors + 3/5 data table */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
          <div className="lg:col-span-2">
            {loadingDataset ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <VariableSelectors
                columns={columns}
                method={method}
                vars={vars}
                running={running}
                onMethodChange={onMethodChange}
                onVarsChange={onVarsChange}
                onRun={onRun}
                onReset={onReset}
              />
            )}
          </div>

          <div className="lg:col-span-3">
            {loadingDataset ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : dataset ? (
              <DataTable
                columns={dataset.columns}
                dtypes={dataset.dtypes}
                rows={dataset.sample_rows}
                nTotal={dataset.n_rows}
              />
            ) : null}
          </div>
        </div>

        {/* Results */}
        <ResultsPanel result={result} interpretation={interpretation} running={running} />
      </div>
    </div>
  );
}
