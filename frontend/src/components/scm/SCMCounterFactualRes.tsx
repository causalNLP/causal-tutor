"use client";

import { useEffect, useState } from "react";
import { InlineMath } from "react-katex";
import { Edit2, Share2Icon, Lock, Search, X } from "lucide-react";
import ComparisonHistogram from "@/components/scm/plots/OverlayedHistogram";
import { sampleScmSchema, type SCMVariableResult } from "@/lib/api";
import type { SCMSchema } from "@/types";
import TreatmentResponse from "./plots/TreatmentResponse";
import ComputationTrace from "./plots/ComputationTrace";
import EditQueryPanel from "./widgets/EditQuery";
import SCMDAGView from "./widgets/SCMDAGView";
import ResizablePanels from "./widgets/ResizablePanels";

interface SCMCounterfactualResultProps {
  schema: SCMSchema;
  observedValues: Record<string, number>;
  abducedNoise: Record<string, number>;
  cfValues: Record<string, number>;
  interveneId: string;
  interveneValue: number;
  queryId: string;
  onQueryChange: (interveneId: string, interveneValue: number, queryId: string) => void;
  onDeleteQuery: () => void;
}

// handles latex code for query
const ESCAPE_LATEX_TEXT = /([\\%#&$_{}~^])/g;
const escapeLatexText = (name: string) => name.replace(ESCAPE_LATEX_TEXT, "\\$1");

const toLatexSubscript = (name: string) => {
  const SUBSCRIPT_MAP: Record<string, string> = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  };
  const match = name.match(/^([A-Za-z]+)([₀₁₂₃₄₅₆₇₈₉]+)$/);
  if (!match) return `\\text{${escapeLatexText(name)}}`;
  const [, base, subUnicode] = match;
  const subDigits = subUnicode.split("").map((c) => SUBSCRIPT_MAP[c] ?? c).join("");
  return `${base}_{${subDigits}}`;
};

export default function SCMCounterfactualResult({
  schema, observedValues, abducedNoise, cfValues, interveneId, interveneValue, queryId, onQueryChange, onDeleteQuery,
}: SCMCounterfactualResultProps) {
  const variables = schema.variables;
  const edges = variables.flatMap((v) => v.dependencies.map((dep) => [dep, v.id] as [string, string]));
  const interveneVar = variables.find((v) => v.id === interveneId);
  const queryVar = variables.find((v) => v.id === queryId);

  const [analysisTab, setAnalysisTab] = useState<"Reasoning" | "Distribution" | "Treatment Response">("Reasoning");
  const [results, setResults] = useState<Record<string, SCMVariableResult> | null>(null);
  const [intervenedResults, setIntervenedResults] = useState<Record<string, SCMVariableResult> | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingQuery, setEditingQuery] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const OBSERVED_BORDER_FONT_COLOR = "#285E7B";
  const CF_BORDER_FONT_COLOR = "#BF9565";
  const CF_BG_COLOR = "#FFF7E2";


  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    sampleScmSchema(schema, 1000, undefined, { type: "hard", target_id: interveneId, value: interveneValue })
      .then((res) => {
        if (!cancelled) {
          setResults(res.results);
          setIntervenedResults(res.intervened_results ?? null);
        }
      })
      .catch((err) => console.error("Sampling failed", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schema, interveneId, interveneValue]);

  const obsResult = results?.[queryId];
  const cfDistResult = intervenedResults?.[queryId];

  const conditions = variables
  .map((v) => `${toLatexSubscript(v.name)}=${observedValues[v.id]?.toFixed(1) ?? "?"}`)
  .join(", \\; ");

  const latexQuery = `\\mathbb{E}[${toLatexSubscript(queryVar?.name ?? "")}(${toLatexSubscript(interveneVar?.name ?? "")}=${interveneValue.toFixed(1)}) \\mid ${conditions}]`;

  const observedTargetVal = observedValues[queryId];
  const cfTargetVal = cfValues[queryId];
  const ice = cfTargetVal - observedTargetVal;

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* query banner */}
      <div className="relative px-4 pt-4">
        <div
          className="flex min-h-[52px] flex-shrink-0 items-center justify-between rounded-lg border px-4 py-3"
          style={{
            backgroundColor: CF_BG_COLOR,
            borderColor: CF_BORDER_FONT_COLOR,
            visibility: editingQuery ? "hidden" : "visible",
          }}
        >
          <div className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold" style={{ color: CF_BORDER_FONT_COLOR }}>
            <span className="flex-shrink-0">Counterfactual Query Active:</span>
            <span style={{ color: "#8A6B3F" }}>
              <InlineMath math={latexQuery} />
            </span>
          </div>
          <div className="relative flex flex-shrink-0 items-center gap-2">
            <button
              onClick={() => {
                setEditingQuery(false);
                setShowDeleteConfirm(true);
              }}
              title="Delete query"
              aria-label="Delete query"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-rose-400 bg-white text-rose-500 transition-colors hover:bg-rose-50"
            >
              <X size={13} />
            </button>
            <button
              onClick={() => {
                setShowDeleteConfirm(false);
                setEditingQuery(true);
              }}
              className="flex flex-shrink-0 items-center bg-white gap-1.5 rounded-md border px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-orange-50"
              style={{ borderColor: CF_BORDER_FONT_COLOR, color: CF_BORDER_FONT_COLOR }}
            >
              Edit Query <Edit2 size={12} />
            </button>

            {showDeleteConfirm && (
              <div className="absolute right-0 top-full z-40 mt-4 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-3 text-[12.5px] text-slate-600">
                  Delete this counterfactual query? This will clear the result and take you back to the beginning.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 rounded-md border border-slate-200 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onDeleteQuery();
                      setShowDeleteConfirm(false);
                    }}
                    className="flex-1 rounded-md border border-rose-200 bg-rose-50 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {editingQuery && (
          <div className="absolute inset-x-4 top-4 z-40">
            <EditQueryPanel
              variables={variables}
              observedValues={observedValues}
              currentInterveneId={interveneId}
              currentInterveneValue={interveneValue}
              currentQueryId={queryId}
              onCancel={() => setEditingQuery(false)}
              onConfirm={(newInterveneId, newInterveneValue, newQueryId) => {
                onQueryChange(newInterveneId, newInterveneValue, newQueryId);
                setEditingQuery(false);
              }}
            />
          </div>
        )}
      </div>

      <ResizablePanels className="flex-1 min-h-0 w-full" initialRightWidth={410} minRightWidth={360}>
        {/* SCM -> highlighting intervened on variable vs target variable*/}
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex h-[45px] flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
            <span className="font-serif text-sm font-semibold italic text-slate-500">ƒx</span>
            <span className="text-[14px] font-bold text-slate-600">Structural Causal Model</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
            <div className="mb-2 text-[14px] font-semibold" style={{ color: OBSERVED_BORDER_FONT_COLOR }}>
              Observed
            </div>
          <div className="mb-4 flex flex-col gap-1.5">
            {variables.map((v) => {
              const isIntervened = v.id === interveneId;
              const isQuery = v.id === queryId;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]"
                  style={
                    isIntervened
                      ? { backgroundColor: `${CF_BG_COLOR}`}
                      : isQuery
                      ? { backgroundColor: `#E2F6FF`}
                      : {}
                  }
                >
                  <span className="font-mono font-bold text-slate-700">{v.name}</span>
                  <span className="font-mono font-light text-slate-600">{observedValues[v.id]?.toFixed(3)}</span>
                </div>
              );
            })}
          </div>
        
          <div className="mb-2 text-[14px] font-semibold" style={{ color: CF_BORDER_FONT_COLOR }}>
            Counterfactual
          </div>
          <div className="mb-4 flex flex-col gap-1.5">
            {variables.map((v) => {
              const isIntervened = v.id === interveneId;
              const isQuery = v.id === queryId;
              const delta = cfValues[v.id] - observedValues[v.id];
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]"
                  style={
                    isIntervened
                      ? { backgroundColor: CF_BG_COLOR, border: `1px solid #dabe9f`}
                      : isQuery
                      ? { backgroundColor: `#E2F6FF`, border: `1px solid #67A8CB` }
                      : {}
                  }
                >
                  <span className="font-mono font-bold text-slate-700">{v.name}</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span style={{ color: "#475569" }}>
                      {cfValues[v.id]?.toFixed(3)}
                    </span>
                    {!isIntervened && Math.abs(delta) > 0.001 && (
                      <span className={delta > 0 ? "text-emerald-500" : "text-rose-500"}>
                        ({delta > 0 ? "+" : ""}{delta.toFixed(2)})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mb-3 flex items-center gap-3 text-[14px] font-semibold text-slate-500">
            <Lock size={13} className="text-slate-500" />
            Abduced Noise
          </div>
          <div className="flex flex-col gap-1.5">
            {variables.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-[14px]">
                <span className="font-mono font-semibold text-slate-500">{v.noise.name}</span>
                <span className="font-mono text-slate-400">{abducedNoise[v.id]?.toFixed(3) ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>

        </div>

        {/* DAG */}
        <div className="flex h-full min-h-0 flex-col items-center">
          <div className="flex h-[45px] w-full flex-shrink-0 items-center justify-between border-b border-slate-200 px-4">
            <div className="flex items-center gap-2">
              <Share2Icon size={15} className="text-slate-400" />
              <span className="text-sm font-bold text-slate-600">DAG</span>
            </div>
          </div>
          <div className="flex w-full flex-1 min-h-0 items-center justify-center overflow-hidden relative">
            <SCMDAGView 
              variables={variables} 
              nodeValues={cfValues}            
              noiseValues={abducedNoise}    
              intervention={{ target_id: interveneId, type: "hard", value: interveneValue }} 
              queryId={queryId}               
              showToggle={true}
            />
          </div>
        </div>

        {/* Analysis Panel */}
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          
          {/* main header*/}
          <div className="flex h-[45px] flex-shrink-0 items-center gap-2 border-b border-slate-200 px-4">
            <Search size={15} className="text-slate-600" />
            <span className="text-sm font-bold text-slate-600">Analysis</span>
          </div>

          {/* subtabs: distribution, treatment response, comp trace*/}
          <div className="flex flex-shrink-0 gap-4 border-b border-slate-100 px-4 pt-3 text-[13px] font-semibold">
            {(["Reasoning", "Distribution", "Treatment Response"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setAnalysisTab(tab)}
                className={analysisTab === tab ? "border-b-2 border-slate-600 pb-2.5 text-slate-600" : "pb-2.5 text-slate-400 hover:text-slate-600"}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
            
            {analysisTab === "Distribution" && (
              <div className="px-4 py-4">
                <p className="mb-3 text-[12.5px] leading-snug text-slate-500">
                  Observe the differences in the <span style={{ color: "#A5B4FC" }} className="font-semibold">observational</span> and{" "}
                  <span style={{ color: "#34D399" }} className="font-semibold">counterfactual</span> distributions for {queryVar?.name}.
                </p>

                <div className="mb-4 rounded-lg border border-slate-100 p-3">
                  {loading || !obsResult ? (
                    <div className="flex h-32 items-center justify-center text-[12px] text-slate-300">Sampling...</div>
                  ) : (
                    <ComparisonHistogram observed={obsResult.histogram} intervened={cfDistResult?.histogram} />
                  )}
                </div>

                {obsResult && cfDistResult && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
                    Population mean of {queryVar?.name} shifted by{" "}
                    <span className={cfDistResult.stats.mean - obsResult.stats.mean < 0 ? "font-bold text-rose-500" : "font-bold text-emerald-600"}>
                      {(cfDistResult.stats.mean - obsResult.stats.mean).toFixed(1)}
                    </span>{" "}
                    when {interveneVar?.name} is forced to {interveneValue}.
                  </div>
                )}

                <div className="grid grid-cols-[1fr_60px_70px] gap-x-2 border-b border-slate-100 pb-2 text-[12px] font-semibold text-slate-400">
                  <span></span>
                  <span className="text-right">Obs.</span>
                  <span className="text-right">CounterF.</span>
                </div>
                {[
                  ["Mean", obsResult?.stats.mean, cfDistResult?.stats.mean],
                  ["Standard Deviation", obsResult?.stats.std, cfDistResult?.stats.std],
                  ["Skew", obsResult?.stats.skew, cfDistResult?.stats.skew],
                  ["Kurtosis", obsResult?.stats.kurtosis, cfDistResult?.stats.kurtosis],
                ].map(([label, o, c]) => (
                  <div key={label as string} className="grid grid-cols-[1fr_60px_70px] items-center gap-x-2 border-b border-slate-50 py-2 text-[13px]">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-right font-mono text-slate-600">{typeof o === "number" ? o.toFixed(2) : "—"}</span>
                    <span
                      className="rounded px-1.5 py-0.5 text-right font-mono font-semibold"
                      style={{ backgroundColor: `${CF_BG_COLOR}`, color: CF_BORDER_FONT_COLOR }}
                    >
                      {typeof c === "number" ? c.toFixed(2) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {analysisTab === "Treatment Response" && interveneVar && queryVar && (
              <TreatmentResponse
                schema={schema}
                abducedNoise={abducedNoise}
                interveneVar={interveneVar}
                queryVar={queryVar}
                initialValue={interveneValue}
              />
            )}

            {analysisTab === "Reasoning" && (
              <ComputationTrace
                schema={schema}
                observedValues={observedValues}
                abducedNoise={abducedNoise}
                interveneId={interveneId}
                interveneValue={interveneValue}
              />
            )}

          </div>
        </div>
        </ResizablePanels>

      {/* footer */}
      <div className="grid flex-shrink-0 grid-cols-3 divide-x divide-slate-200 border-t border-slate-200">
        <div className="px-6 py-3.5">
          <div className="mb-2 py-1 text-[17px] font-semibold text-slate-700">Observed {queryVar?.name}</div>
          <div className="font-mono text-[18px] font-regular text-slate-700">{observedTargetVal?.toFixed(3)}</div>
        </div>
        <div className="px-6 py-3.5">
          <div className="mb-2 py-1 text-[17px] font-semibold text-slate-700">Counterfactual {queryVar?.name}</div>
          <div className="font-mono text-[18px] font-regular text-slate-700">{cfTargetVal?.toFixed(3)}</div>
        </div>
        <div className="px-6 py-3.5">
          <div className="mb-2 py-1 text-[17px] font-semibold text-slate-700">Individual Causal Effect</div>
          <div className={`font-mono text-[18px] font-regular ${ice < 0 ? "text-rose-500" : "text-emerald-600"}`}>
            {ice >= 0 ? "+" : ""}{ice.toFixed(3)}
          </div>
        </div>
      </div>
    </div>
  );
}