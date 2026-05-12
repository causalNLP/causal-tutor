"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import ResearchLab from "@/components/ResearchLab";
import CurriculumDashboard from "@/components/CurriculumDashboard";
import ApiKeySettings from "@/components/ApiKeySettings";
import TutorChatPanel, { type TutorFeature } from "@/components/TutorChatPanel";
import WelcomeHome from "@/components/WelcomeHome";
import {
  Home as HomeIcon, BookOpen, FlaskConical, Share2, Database, KeyRound, MessageSquare,
  BrainCircuit, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStoredKey } from "@/lib/apiKey";
import { API_KEY_MODAL_EVENT } from "@/lib/apiErrors";

// ── Sidebar nav button (handles both expanded and collapsed states) ──────
function SidebarNavButton({
  icon: Icon, label, active, onClick, accent, expanded, dot,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  accent: string; // tailwind text-color classes for active state, e.g. "text-indigo-400"
  expanded: boolean;
  dot?: string | null; // optional indicator dot color
}) {
  if (expanded) {
    return (
      <button
        onClick={onClick}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
          active ? `bg-slate-800 ${accent}` : "text-slate-400 hover:text-white hover:bg-slate-800"
        }`}
      >
        <Icon size={20} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">{label}</span>
        {dot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative p-3 mx-auto rounded-xl transition-all group ${
        active ? `bg-slate-800 ${accent}` : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
    >
      <Icon size={24} />
      {dot && <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${dot}`} />}
      <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
        {label}
      </div>
    </button>
  );
}

const DAGPlayground = dynamic(() => import("@/components/DAGPlayground"), { ssr: false });
const DatasetSandbox = dynamic(() => import("@/components/DatasetSandbox"), { ssr: false });

export default function Home() {
  const [activeMode, setActiveMode] = useState<"home" | "lab" | "curriculum" | "playground" | "sandbox">("home");
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const storedKey = useStoredKey();

  // Sidebar collapse/expand state — persists across reloads.
  // Defaults to `true` on both SSR and the first client render (matching markup
  // is what hydration requires). The mount effect below syncs from localStorage
  // after hydration if a saved preference exists.
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const sidebarHydrated = useRef(false);
  useEffect(() => {
    const saved = localStorage.getItem("causal_tutor_sidebar_expanded");
    if (saved !== null) setSidebarExpanded(saved === "1");
    sidebarHydrated.current = true;
  }, []);
  useEffect(() => {
    // Don't write back on the very first render — only persist user-initiated
    // changes after we've read the saved value.
    if (!sidebarHydrated.current) return;
    localStorage.setItem("causal_tutor_sidebar_expanded", sidebarExpanded ? "1" : "0");
  }, [sidebarExpanded]);

  // ── Unified Tutor chat state (panel + current feature context) ──
  const [tutorChatOpen, setTutorChatOpen] = useState(false);
  const [featureContext, setFeatureContext] = useState<{ feature: TutorFeature; payload: any }>({
    feature: "general",
    payload: undefined,
  });
  // True while the user is mid-exam in Curriculum — hides FAB and force-closes the panel.
  const [chatLocked, setChatLocked] = useState(false);

  // Reset context to "general" when switching to Home, Lab, or Sandbox (which don't publish)
  useEffect(() => {
    if (activeMode === "home" || activeMode === "lab" || activeMode === "sandbox") {
      setFeatureContext({ feature: "general", payload: undefined });
    }
    // For curriculum/playground, the child component publishes via onContextChange.
  }, [activeMode]);

  // Force-close the chat whenever it's locked (e.g., during an exam).
  useEffect(() => {
    if (chatLocked) setTutorChatOpen(false);
  }, [chatLocked]);

  const handleContextChange = useCallback(
    (ctx: { feature: TutorFeature; payload: any }) => setFeatureContext(ctx),
    []
  );
  const handleChatLockedChange = useCallback((locked: boolean) => setChatLocked(locked), []);

  // Open the API key modal when any OpenAI-using request returns 401
  useEffect(() => {
    const handler = () => setApiKeyOpen(true);
    window.addEventListener(API_KEY_MODAL_EVENT, handler);
    return () => window.removeEventListener(API_KEY_MODAL_EVENT, handler);
  }, []);

  // Track first-mount of the whole app so Lab can show an empty state on fresh
  // load but auto-resume on intra-SPA tab switches. page.tsx stays mounted
  // across tab navigation, so this ref only re-initializes on browser reload.
  const isFirstPageMount = useRef(true);
  useEffect(() => {
    isFirstPageMount.current = false;
  }, []);

  return (
    <main className="h-screen w-screen overflow-hidden bg-white flex">
      {/* Platform Navigation Sidebar */}
      <div className={`relative ${sidebarExpanded ? 'w-[220px]' : 'w-[60px]'} bg-slate-900 flex flex-col py-4 flex-shrink-0 z-50 transition-all duration-300 ease-in-out`}>

        {/* Header — brand + collapse toggle */}
        {sidebarExpanded ? (
          <div className="px-3 mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                <BrainCircuit className="text-white" size={22} />
              </div>
              <span className="text-white font-bold text-sm truncate">Causal Tutor</span>
            </div>
            <button
              onClick={() => setSidebarExpanded(false)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors flex-shrink-0"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={20} />
            </button>
          </div>
        ) : (
          <div className="flex justify-center mb-4">
            <button
              onClick={() => setSidebarExpanded(true)}
              className="group w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg hover:bg-indigo-700 transition-colors"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <BrainCircuit className="text-white block group-hover:hidden" size={22} />
              <PanelLeftOpen className="text-white hidden group-hover:block" size={20} />
            </button>
          </div>
        )}

        {/* Nav buttons */}
        <div className={`flex flex-col flex-1 gap-1.5 ${sidebarExpanded ? 'px-2' : ''}`}>
          <SidebarNavButton icon={HomeIcon} label="Home" active={activeMode === 'home'} onClick={() => setActiveMode('home')} accent="text-white" expanded={sidebarExpanded} />
          <SidebarNavButton icon={BookOpen} label="Curriculum" active={activeMode === 'curriculum'} onClick={() => setActiveMode('curriculum')} accent="text-emerald-400" expanded={sidebarExpanded} />
          <SidebarNavButton icon={Share2} label="DAG Playground" active={activeMode === 'playground'} onClick={() => setActiveMode('playground')} accent="text-amber-400" expanded={sidebarExpanded} />
          <SidebarNavButton icon={Database} label="Dataset Sandbox" active={activeMode === 'sandbox'} onClick={() => setActiveMode('sandbox')} accent="text-cyan-400" expanded={sidebarExpanded} />
          <SidebarNavButton icon={FlaskConical} label="Research Lab" active={activeMode === 'lab'} onClick={() => setActiveMode('lab')} accent="text-indigo-400" expanded={sidebarExpanded} />
        </div>

        {/* Bottom: API key settings */}
        <div className={`${sidebarExpanded ? 'px-2' : ''}`}>
          <SidebarNavButton
            icon={KeyRound}
            label="OpenAI API Key"
            active={apiKeyOpen}
            onClick={() => setApiKeyOpen((v) => !v)}
            accent="text-indigo-400"
            expanded={sidebarExpanded}
            dot={storedKey ? 'bg-emerald-400' : 'bg-slate-500'}
          />
        </div>

        <ApiKeySettings isOpen={apiKeyOpen} onClose={() => setApiKeyOpen(false)} />
      </div>

      {/* Main Content Area + Tutor Chat panel as flex siblings */}
      <div className="flex-1 h-full overflow-hidden relative flex">
        <div className="flex-1 h-full overflow-hidden relative">
          {activeMode === "home" ? (
              <WelcomeHome onNavigate={setActiveMode} />
          ) : activeMode === "lab" ? (
              <ResearchLab skipInitialResume={isFirstPageMount.current} />
          ) : activeMode === "curriculum" ? (
              <CurriculumDashboard
                onContextChange={handleContextChange}
                onChatLockedChange={handleChatLockedChange}
                compactCards={tutorChatOpen && sidebarExpanded}
              />
          ) : activeMode === "playground" ? (
              <DAGPlayground onContextChange={handleContextChange} />
          ) : (
              <DatasetSandbox />
          )}
        </div>

        <TutorChatPanel
          isOpen={tutorChatOpen}
          onClose={() => setTutorChatOpen(false)}
          feature={featureContext.feature}
          featureContext={featureContext.payload}
          skipInitialResume={isFirstPageMount.current}
        />
      </div>

      {/* Floating Action Button — opens the Tutor chat. Hidden when chat is open
          or when locked (e.g., during a curriculum exam). */}
      {!tutorChatOpen && !chatLocked && (
        <button
          onClick={() => setTutorChatOpen(true)}
          title="Tutor Chat"
          aria-label="Open Tutor Chat"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl active:scale-95 transition-all flex items-center justify-center"
        >
          <MessageSquare size={22} strokeWidth={2.25} />
        </button>
      )}
    </main>
  );
}
