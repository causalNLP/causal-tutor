"use client";

import { Database, ChevronRight } from "lucide-react";
import type { SandboxQuery } from "@/types";

const METHOD_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  ols: { label: "OLS", bg: "bg-indigo-100", text: "text-indigo-700" },
  did: { label: "DiD", bg: "bg-emerald-100", text: "text-emerald-700" },
  iv: { label: "IV", bg: "bg-amber-100", text: "text-amber-700" },
  rdd: { label: "RDD", bg: "bg-rose-100", text: "text-rose-700" },
  matching: { label: "Matching", bg: "bg-cyan-100", text: "text-cyan-700" },
  frontdoor: { label: "Front-door", bg: "bg-violet-100", text: "text-violet-700" },
};

export default function QueryGallery({
  queries,
  onPick,
}: {
  queries: SandboxQuery[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-slate-50/50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner border border-white">
            <Database size={28} className="text-cyan-600" strokeWidth={1.75} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
            Dataset Sandbox
          </h1>
          <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
            Pick a causal query, choose a method, and run it on real data. See the estimate, how it compares to the ground truth, and which assumptions it relies on.
          </p>
        </div>

        {queries.length === 0 ? (
          <div className="text-center text-slate-400 py-16 text-sm">Loading queries…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {queries.map((q) => {
              const style = METHOD_STYLES[q.method] || {
                label: q.method.toUpperCase(),
                bg: "bg-slate-100",
                text: "text-slate-700",
              };
              return (
                <button
                  key={q.id}
                  onClick={() => onPick(q.id)}
                  className="flex flex-col text-left p-5 bg-white border border-slate-200 rounded-2xl hover:bg-white hover:border-cyan-300 hover:shadow-md transition-all shadow-sm group relative overflow-hidden"
                >
                  {/* Top badges */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`${style.bg} ${style.text} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide`}
                    >
                      {style.label}
                    </span>
                    <span className="bg-slate-50 text-slate-500 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-100 capitalize">
                      {q.domain.replace("_", " ")}
                    </span>
                  </div>

                  {/* Title */}
                  <div className="font-bold text-sm text-slate-900 mb-1 group-hover:text-cyan-700 transition-colors leading-snug">
                    {q.title}
                  </div>

                  {/* Query */}
                  <p className="text-xs text-slate-600 mb-3 line-clamp-2 leading-relaxed">
                    {q.query}
                  </p>

                  {/* Highlight */}
                  <p className="text-[11px] text-slate-400 italic leading-relaxed mt-auto">
                    {q.concept_highlight}
                  </p>

                  {/* Hover chevron */}
                  <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0">
                    <ChevronRight size={16} className="text-slate-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
