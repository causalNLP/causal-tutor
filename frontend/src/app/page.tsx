"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import CausalTutor from "@/components/CausalTutor";
import CurriculumDashboard from "@/components/CurriculumDashboard";
import { BookOpen, FlaskConical, Share2, Database } from "lucide-react";

const DAGPlayground = dynamic(() => import("@/components/DAGPlayground"), { ssr: false });
const DatasetSandbox = dynamic(() => import("@/components/DatasetSandbox"), { ssr: false });

export default function Home() {
  const [activeMode, setActiveMode] = useState<"lab" | "curriculum" | "playground" | "sandbox">("lab");

  return (
    <main className="h-screen w-screen overflow-hidden bg-white flex">
      {/* Platform Navigation Sidebar */}
      <div className="w-[60px] bg-slate-900 flex flex-col items-center py-4 gap-4 flex-shrink-0 z-50">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center mb-4 shadow-lg">
           <span className="text-white font-bold text-lg">CT</span>
        </div>

        <button
            onClick={() => setActiveMode("lab")}
            className={`p-3 rounded-xl transition-all duration-200 group relative ${activeMode === 'lab' ? 'bg-slate-800 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title="Research Design Lab"
        >
            <FlaskConical size={24} />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Research Lab
            </div>
        </button>

        <button
            onClick={() => setActiveMode("curriculum")}
            className={`p-3 rounded-xl transition-all duration-200 group relative ${activeMode === 'curriculum' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title="Causality Curriculum"
        >
            <BookOpen size={24} />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Curriculum
            </div>
        </button>

        <button
            onClick={() => setActiveMode("playground")}
            className={`p-3 rounded-xl transition-all duration-200 group relative ${activeMode === 'playground' ? 'bg-slate-800 text-amber-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title="DAG Playground"
        >
            <Share2 size={24} />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                DAG Playground
            </div>
        </button>

        <button
            onClick={() => setActiveMode("sandbox")}
            className={`p-3 rounded-xl transition-all duration-200 group relative ${activeMode === 'sandbox' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title="Dataset Sandbox"
        >
            <Database size={24} />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Dataset Sandbox
            </div>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full overflow-hidden relative">
        {activeMode === "lab" ? (
            <CausalTutor
              onOpenPlayground={() => setActiveMode("playground")}
              onOpenSandbox={() => setActiveMode("sandbox")}
            />
        ) : activeMode === "curriculum" ? (
            <CurriculumDashboard />
        ) : activeMode === "playground" ? (
            <DAGPlayground />
        ) : (
            <DatasetSandbox />
        )}
      </div>
    </main>
  );
}
