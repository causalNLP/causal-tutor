"use client";

interface DataTableProps {
  columns: string[];
  dtypes: string[];
  rows: Record<string, unknown>[];
  nTotal: number;
  maxHeight?: string;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(3);
  }
  return String(v);
}

function dtypeBadge(dtype: string): string {
  if (dtype.includes("int")) return "int";
  if (dtype.includes("float")) return "float";
  if (dtype.includes("bool")) return "bool";
  if (dtype.includes("object")) return "str";
  return dtype;
}

export default function DataTable({
  columns,
  dtypes,
  rows,
  nTotal,
  maxHeight = "280px",
}: DataTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Dataset Preview
        </span>
        <span className="text-[11px] text-slate-400 font-medium">
          Showing {rows.length} of {nTotal.toLocaleString()} rows · {columns.length} cols
        </span>
      </div>
      <div className="overflow-auto custom-scrollbar" style={{ maxHeight }}>
        <table className="min-w-full text-xs font-mono">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c}
                  className="px-3 py-2 text-left font-semibold text-slate-700 border-b border-slate-200 whitespace-nowrap"
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span>{c}</span>
                    <span className="text-[9px] font-normal text-slate-400 bg-white border border-slate-200 px-1 rounded">
                      {dtypeBadge(dtypes[i])}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
              >
                {columns.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-1.5 text-slate-700 border-b border-slate-100 whitespace-nowrap"
                  >
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
