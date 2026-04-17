"use client";

import type { MediationPlotData } from "@/types";

function Node({ label, sub, color }: { label: string; sub: string; color: string }) {
  return (
    <div className={`px-4 py-3 ${color} border-2 rounded-xl shadow-sm text-center min-w-[120px]`}>
      <div className="font-bold text-sm">{label}</div>
      <div className="text-[10px] text-slate-500 font-mono mt-0.5">{sub}</div>
    </div>
  );
}

function Edge({ coef, label }: { coef: number; label: string }) {
  const colored =
    coef > 0 ? "text-emerald-600" : coef < 0 ? "text-rose-600" : "text-slate-500";
  return (
    <div className="flex-1 relative flex flex-col items-center justify-center min-h-[60px]">
      <svg width="100%" height="30" className="overflow-visible">
        <line x1="0%" y1="50%" x2="100%" y2="50%" stroke="#64748b" strokeWidth="2" />
        <polygon points="100%,50% 95%,40% 95%,60%" fill="#64748b" transform="translate(-2,0)" />
      </svg>
      <div className={`absolute -top-1 text-xs font-mono ${colored} bg-white/80 backdrop-blur px-1.5 rounded`}>
        {label} = {coef.toFixed(3)}
      </div>
    </div>
  );
}

export default function MediationDiagram({ data }: { data: MediationPlotData }) {
  return (
    <div className="w-full py-6 px-4">
      {/* Main horizontal path: T → M → Y */}
      <div className="flex items-center gap-3">
        <Node
          label={data.treatment}
          sub="treatment"
          color="bg-indigo-50 border-indigo-300 text-indigo-900"
        />
        <Edge coef={data.t_to_m} label="a" />
        <Node
          label={data.mediator}
          sub="mediator"
          color="bg-amber-50 border-amber-300 text-amber-900"
        />
        <Edge coef={data.m_to_y} label="b" />
        <Node
          label={data.outcome}
          sub="outcome"
          color="bg-emerald-50 border-emerald-300 text-emerald-900"
        />
      </div>

      {/* Summary */}
      <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
          <div className="text-slate-400 uppercase text-[10px] font-bold tracking-wider mb-1">
            Indirect (a × b)
          </div>
          <div className="font-mono text-lg font-bold text-slate-900">
            {data.indirect.toFixed(3)}
          </div>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
          <div className="text-slate-400 uppercase text-[10px] font-bold tracking-wider mb-1">
            Direct (T → Y | M)
          </div>
          <div className="font-mono text-lg font-bold text-slate-900">
            {data.t_to_y_direct.toFixed(3)}
          </div>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
          <div className="text-slate-400 uppercase text-[10px] font-bold tracking-wider mb-1">
            a
          </div>
          <div className="font-mono text-lg font-bold text-slate-900">
            {data.t_to_m.toFixed(3)}
          </div>
        </div>
      </div>
    </div>
  );
}
