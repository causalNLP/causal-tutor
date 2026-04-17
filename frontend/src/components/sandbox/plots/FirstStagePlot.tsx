"use client";

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { FirstStagePlotData } from "@/types";

export default function FirstStagePlot({ data }: { data: FirstStagePlotData }) {
  // Merge scatter + fit so Recharts can render them together
  const scatterRows = data.scatter.map((p) => ({ z: p.z, t_obs: p.t }));
  const fitRows = data.fit_line.map((p) => ({ z: p.z, t_fit: p.t_hat }));
  const rows = [...scatterRows, ...fitRows].sort((a, b) => a.z - b.z);

  return (
    <div className="w-full h-[280px] relative">
      <div className="absolute top-1 right-3 text-[11px] text-slate-500 bg-white/80 backdrop-blur px-2 py-0.5 rounded border border-slate-200 font-semibold z-10">
        First-stage F = {data.f_stat.toFixed(2)}
        {data.f_stat < 10 && <span className="text-rose-600 ml-1">· weak</span>}
      </div>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            dataKey="z"
            stroke="#94a3b8"
            fontSize={11}
            label={{ value: data.instrument, position: "bottom", fontSize: 11, offset: -5 }}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={11}
            label={{ value: data.treatment, angle: -90, position: "left", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            formatter={(v: number) => (typeof v === "number" ? v.toFixed(3) : v)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Scatter name="observations" dataKey="t_obs" fill="#f59e0b" fillOpacity={0.4} />
          <Line
            type="monotone"
            dataKey="t_fit"
            name="fit"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
