"use client";

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { DiscontinuityPlotData } from "@/types";

export default function DiscontinuityPlot({ data }: { data: DiscontinuityPlotData }) {
  // Combine scatter + left/right fits, aligning on r.
  const rows: { r: number; y_obs?: number; y_left?: number; y_right?: number }[] = [];
  data.scatter.forEach((p) => rows.push({ r: p.r, y_obs: p.y }));
  data.left_fit.forEach((p) => rows.push({ r: p.r, y_left: p.y }));
  data.right_fit.forEach((p) => rows.push({ r: p.r, y_right: p.y }));
  rows.sort((a, b) => a.r - b.r);

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            dataKey="r"
            stroke="#94a3b8"
            fontSize={11}
            label={{ value: data.running_var, position: "bottom", fontSize: 11, offset: -5 }}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={11}
            label={{ value: data.outcome_var, angle: -90, position: "left", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            formatter={(v: number) => (typeof v === "number" ? v.toFixed(3) : v)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine
            x={data.cutoff}
            stroke="#64748b"
            strokeDasharray="4 4"
            label={{ value: `c = ${data.cutoff.toFixed(2)}`, position: "top", fill: "#64748b", fontSize: 10 }}
          />
          <Scatter name="binned means" dataKey="y_obs" fill="#94a3b8" fillOpacity={0.7} />
          <Line
            type="monotone"
            dataKey="y_left"
            name="left fit"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="y_right"
            name="right fit"
            stroke="#10b981"
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
