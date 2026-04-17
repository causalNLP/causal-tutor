"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ErrorBar,
  Cell,
} from "recharts";
import type { ForestPlotData } from "@/types";

export default function ForestPlot({ data }: { data: ForestPlotData }) {
  const rows = data.terms.map((t) => ({
    name: t.name,
    coef: t.coef,
    error: [t.coef - t.ci_low, t.ci_high - t.coef] as [number, number],
    ci_low: t.ci_low,
    ci_high: t.ci_high,
    is_treatment: t.is_treatment,
  }));

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 80, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" stroke="#94a3b8" fontSize={11} />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#475569"
            fontSize={11}
            width={90}
          />
          <ReferenceLine x={0} stroke="#64748b" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e2e8f0",
            }}
            formatter={(v: number) => v.toFixed(3)}
          />
          <Bar dataKey="coef" barSize={12} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.is_treatment ? "#4f46e5" : "#94a3b8"} />
            ))}
            <ErrorBar dataKey="error" width={6} strokeWidth={2} stroke="#334155" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
