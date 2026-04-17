"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ParallelTrendsPlotData } from "@/types";

export default function ParallelTrendsPlot({ data }: { data: ParallelTrendsPlotData }) {
  const rows = data.periods.map((p, i) => ({
    period: p,
    treated: data.treated_mean[i],
    control: data.control_mean[i],
  }));

  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="period" stroke="#94a3b8" fontSize={11} />
          <YAxis stroke="#94a3b8" fontSize={11} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            formatter={(v: number) => v.toFixed(2)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="line" />
          <ReferenceLine
            x={data.treatment_start}
            stroke="#64748b"
            strokeDasharray="4 4"
            label={{ value: "Treatment start", position: "top", fill: "#64748b", fontSize: 10 }}
          />
          <Line
            type="monotone"
            dataKey="treated"
            name="Treated group"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="control"
            name="Control group"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
