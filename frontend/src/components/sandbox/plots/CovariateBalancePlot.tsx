"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CovariateBalancePlotData } from "@/types";

export default function CovariateBalancePlot({ data }: { data: CovariateBalancePlotData }) {
  const rows = data.covariates.map((c) => {
    const before = data.smd_before.find((x) => x.covariate === c)?.smd ?? 0;
    const after = data.smd_after.find((x) => x.covariate === c)?.smd ?? 0;
    return {
      covariate: c,
      "|SMD| before": Math.abs(before),
      "|SMD| after": Math.abs(after),
    };
  });

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 10, right: 20, left: 100, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" stroke="#94a3b8" fontSize={11} />
          <YAxis
            type="category"
            dataKey="covariate"
            stroke="#475569"
            fontSize={11}
            width={110}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            formatter={(v: number) => v.toFixed(3)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine
            x={data.threshold}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: `${data.threshold}`, position: "top", fill: "#f59e0b", fontSize: 10 }}
          />
          <Bar dataKey="|SMD| before" fill="#f43f5e" barSize={10} isAnimationActive={false} />
          <Bar dataKey="|SMD| after" fill="#10b981" barSize={10} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
