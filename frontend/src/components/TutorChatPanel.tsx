"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  ArrowUp,
  Loader2,
  Bot,
  User,
  MessageSquare,
  Plus,
  History as HistoryIcon,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { getApiHeaders } from "@/lib/apiKey";
import { checkAuthResponse } from "@/lib/apiErrors";
import { apiUrl } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────

export type TutorFeature = "dag" | "curriculum" | "general";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TutorChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  // Note: no pinned feature. The chat auto-uses the live `feature` prop, so a
  // single conversation can span DAG / Curriculum / General as the user navigates.
}

interface TutorChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  feature: TutorFeature;
  // Shape depends on `feature`:
  //   "dag" → { graph: { nodes: [{id,label}], edges: [{source,target}] } }
  //   "curriculum" → { methodTitle?, description?, assumptions?, example?, overview? }
  //   "general" → undefined or {}
  featureContext: any;
  /** When true, populate History but do NOT auto-restore the previously active
   *  session. Set by page.tsx on the very first SPA mount (fresh page load /
   *  hard refresh) so the chat opens empty. */
  skipInitialResume?: boolean;
}

const STORAGE_KEY = "causal_tutor_tutor_chats";
const CURRENT_KEY = "causal_tutor_tutor_current_chat";

const FEATURE_META: Record<TutorFeature, { label: string; chipBg: string; chipText: string }> = {
  dag: { label: "DAG chat", chipBg: "bg-amber-100", chipText: "text-amber-700" },
  curriculum: { label: "Curriculum chat", chipBg: "bg-emerald-100", chipText: "text-emerald-700" },
  general: { label: "General chat", chipBg: "bg-slate-100", chipText: "text-slate-600" },
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize LaTeX delimiters. OpenAI occasionally emits \(...\) and \[...\]
 * even when the system prompt asks for $...$. remark-math only recognizes
 * the dollar-sign form, so we convert here.
 */
function normalizeMath(content: string): string {
  return content
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\[/g, () => "$$")
    .replace(/\\\]/g, () => "$$");
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function buildRequest(
  feature: TutorFeature,
  featureContext: any,
  message: string,
  history: ChatMessage[]
): { url: string; body: string } {
  const historyPayload = history.map((m) => ({ role: m.role, content: m.content }));

  if (feature === "dag") {
    const graph = featureContext?.graph || { nodes: [], edges: [] };
    return {
      url: apiUrl("/dag/chat"),
      body: JSON.stringify({ message, history: historyPayload, graph }),
    };
  }

  // Curriculum and general use the /chat endpoint
  let paper_text = "General causal inference tutoring.";
  let analysis_context: string | null = "Open conversation";

  if (feature === "curriculum" && featureContext) {
    if (featureContext.methodTitle) {
      paper_text =
        `${featureContext.description || ""}\n\n` +
        `Key assumptions:\n${(featureContext.assumptions || []).map((a: string) => `- ${a}`).join("\n")}\n\n` +
        `Example: ${featureContext.example || ""}`;
      analysis_context = `Method: ${featureContext.methodTitle}`;
    } else if (featureContext.overview) {
      paper_text = `Causal inference curriculum overview. Methods covered: ${featureContext.overview}`;
      analysis_context = "Curriculum grid view";
    }
  }

  return {
    url: apiUrl("/chat"),
    body: JSON.stringify({
      message,
      history: historyPayload,
      paper_text,
      analysis_context,
    }),
  };
}

// ── Component ────────────────────────────────────────────────────────────

export default function TutorChatPanel(props: TutorChatPanelProps) {
  const { isOpen, onClose, feature, featureContext, skipInitialResume = false } = props;

  // Persistence-aware state
  const [sessions, setSessions] = useState<TutorChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // UI state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // ── Mount: load from localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedCurrent = localStorage.getItem(CURRENT_KEY);
      if (saved) {
        const parsed: TutorChatSession[] = JSON.parse(saved);
        setSessions(parsed);  // history always visible
        // On fresh page load (skipInitialResume=true) we start with no active
        // session — user can open History inside the panel and click any past
        // chat to resume manually.
        if (!skipInitialResume && savedCurrent) {
          const exists = parsed.find((s) => s.id === savedCurrent);
          if (exists) setCurrentSessionId(savedCurrent);
        }
      }
    } catch (e) {
      console.error("Failed to load tutor chats", e);
    } finally {
      setHydrated(true);
    }
    // skipInitialResume is intentionally captured at first render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist effects (gated on hydration) ──
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (currentSessionId) localStorage.setItem(CURRENT_KEY, currentSessionId);
    else localStorage.removeItem(CURRENT_KEY);
  }, [currentSessionId, hydrated]);

  // ── Derived: active session and its messages ──
  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;
  const chatHistory = currentSession?.messages || [];

  const isNearChatBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    shouldAutoScrollRef.current = isNearChatBottom(el);
  }, [isNearChatBottom]);

  // Auto-scroll only while the user is already following the bottom of the chat.
  // During streamed responses, unconditional smooth scrolling can fight manual
  // scrolling and destabilize the message/input layout.
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth", block: "end" });
  }, [chatHistory, loading]);

  // ── Mutations ──
  const updateSession = useCallback((id: string, updates: Partial<TutorChatSession>) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates, timestamp: Date.now() } : s))
    );
  }, []);

  const handleNewChat = () => {
    shouldAutoScrollRef.current = true;
    setCurrentSessionId(null);
    setHistoryOpen(false);
  };

  const loadSession = (id: string) => {
    shouldAutoScrollRef.current = true;
    setCurrentSessionId(id);
    setHistoryOpen(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);
    shouldAutoScrollRef.current = true;

    // Ensure a session exists; create one if necessary
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const title = userMsg.length > 40 ? userMsg.slice(0, 40) + "…" : userMsg;
      const newSession: TutorChatSession = {
        id: sessionId,
        title,
        timestamp: Date.now(),
        messages: [],
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(sessionId);
    }

    // Snapshot history at this moment (before appending user msg)
    const baseMessages = sessions.find((s) => s.id === sessionId)?.messages || [];
    const withUser: ChatMessage[] = [...baseMessages, { role: "user", content: userMsg }];
    updateSession(sessionId, { messages: withUser });

    try {
      // Always route using the *current* feature, not a pinned one.
      const { url, body } = buildRequest(feature, featureContext, userMsg, baseMessages);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getApiHeaders() },
        body,
      });

      await checkAuthResponse(response);
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";

      // Append empty assistant placeholder
      const withAssistant: ChatMessage[] = [...withUser, { role: "assistant", content: "" }];
      updateSession(sessionId, { messages: withAssistant });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistant += decoder.decode(value);
        // Patch the last message
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = [...s.messages];
            msgs[msgs.length - 1] = { role: "assistant", content: assistant };
            return { ...s, messages: msgs, timestamp: Date.now() };
          })
        );
      }
    } catch (error) {
      console.error(error);
      const isAuth = error instanceof Error && (error as { status?: number }).status === 401;
      const errMsg = isAuth
        ? (error as Error).message
        : "Sorry, I encountered an error. Please try again.";
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // Replace the (empty/partial) assistant with the error message
          const msgs = [...s.messages];
          if (msgs[msgs.length - 1]?.role === "assistant") {
            msgs[msgs.length - 1] = { role: "assistant", content: errMsg };
          } else {
            msgs.push({ role: "assistant", content: errMsg });
          }
          return { ...s, messages: msgs };
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  // Badge + routing always reflect the live feature (panel auto-switches when the
  // user navigates between modes).
  const meta = FEATURE_META[feature];
  const sortedSessions = [...sessions].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="w-[350px] flex-shrink-0 border-l border-slate-200 grid grid-rows-[auto_minmax(0,1fr)_auto] h-full min-h-0 bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-white gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={16} className="text-indigo-600 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-slate-800">Tutor Chat</h3>
            <span
              className={`inline-block ${meta.chipBg} ${meta.chipText} text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide mt-0.5`}
            >
              {meta.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className={`p-1.5 rounded-md transition-colors ${
              historyOpen
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            }`}
            title="History"
          >
            <HistoryIcon size={15} />
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            title="New chat"
          >
            <Plus size={15} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body — either history list or messages */}
      {historyOpen ? (
        <div className="min-h-0 overflow-y-auto custom-scrollbar">
          {sortedSessions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <HistoryIcon size={28} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">No chats yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Send your first message to start a conversation.
              </p>
            </div>
          ) : (
            <div className="py-2">
              {sortedSessions.map((s) => {
                const isActive = s.id === currentSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => loadSession(s.id)}
                    className={`group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
                      isActive
                        ? "bg-indigo-50/60 border-indigo-400"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-slate-800 truncate">{s.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {relativeTime(s.timestamp)} · {s.messages.length} msg
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteSession(e, s.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-rose-500 transition-all flex-shrink-0"
                      title="Delete chat"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleChatScroll}
          className="min-h-0 overflow-y-auto p-4 space-y-6"
        >
          {chatHistory.length === 0 && (
            <div className="text-center py-12">
              <Bot size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 font-medium">Ask me anything</p>
              <p className="text-xs text-slate-400 mt-1">
                {feature === "dag"
                  ? "I have context on the DAG you're building."
                  : feature === "curriculum"
                  ? "I have context on the curriculum method you're viewing."
                  : "I'm a general causal inference tutor."}
              </p>
            </div>
          )}
          {chatHistory.map((msg, idx) => (
            <div key={idx} className="flex gap-3">
              <div className="w-7 h-7 flex-shrink-0 mt-0.5">
                {msg.role === "assistant" ? (
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                    <Bot size={14} />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200">
                    <User size={14} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-xs text-slate-500 mb-1">
                  {msg.role === "assistant" ? "Tutor" : "You"}
                </div>
                <div className="prose prose-slate prose-sm max-w-none text-[13px] text-slate-700 break-words">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {normalizeMath(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white flex-shrink-0">
                <Bot size={14} />
              </div>
              <div className="flex items-center space-x-1.5 h-7 bg-slate-50 px-3 rounded-full border border-slate-100">
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Input — hidden in history view */}
      {!historyOpen && (
        <div className="min-h-0 p-3 border-t border-slate-200 bg-white">
          <div className="relative flex items-end w-full p-1.5 bg-white border border-slate-200 rounded-xl focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-50 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the tutor…"
              className="flex-1 max-h-[100px] min-h-[36px] py-2 px-2 bg-transparent border-0 focus:ring-0 resize-none text-[13px] outline-none placeholder:text-slate-400 leading-relaxed"
              rows={1}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || loading}
              className={`p-2 rounded-lg mb-0.5 transition-all flex-shrink-0 ${
                input.trim() && !loading
                  ? "bg-slate-900 text-white hover:bg-black shadow-sm"
                  : "bg-slate-100 text-slate-300 cursor-not-allowed"
              }`}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
