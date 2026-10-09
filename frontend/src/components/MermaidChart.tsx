"use client";
import React, { useEffect, useRef } from "react";
import mermaid from "mermaid";

interface MermaidProps {
  chart: string;
}

mermaid.initialize({
  startOnLoad: true,
  theme: "default",
  securityLevel: "loose",
  fontFamily: "sans-serif"
});

// LLM-generated diagrams often have unquoted labels that Mermaid misparses
// (e.g. `D[(Unobserved) Nuances]` opens a cylinder shape). Quoting the label text
// of plain `ID[...]` nodes makes those render as literal text.
function quoteNodeLabels(chart: string) {
  return chart.replace(/(\b\w+)\[([^\[\]"]+)\]/g, (_, id, label) => `${id}["${label.replace(/^\(|\)$/g, "")}"]`);
}

export default function MermaidChart({ chart }: MermaidProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const el = chartRef.current;
    if (!el) return;
    el.innerHTML = "";

    const renderChart = async (source: string) => {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      const { svg } = await mermaid.render(id, source);
      return svg;
    };

    (async () => {
      let svg: string;
      try {
        svg = await renderChart(chart);
      } catch {
        try {
          svg = await renderChart(quoteNodeLabels(chart));
        } catch (e) {
          console.error("Mermaid render error:", e);
          if (!cancelled) {
            el.innerHTML = `<div class="text-red-500 text-xs">Couldn't render the causal graph.</div>`;
          }
          return;
        }
      }
      if (!cancelled) el.innerHTML = svg;
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return <div ref={chartRef} className="mermaid-chart flex justify-center w-full" />;
}
