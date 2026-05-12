"use client";

import { useState, useEffect, useRef } from "react";
import { KeyRound, Eye, EyeOff, Check, RotateCcw, X, AlertTriangle, Loader2 } from "lucide-react";
import axios from "axios";
import { saveKey, clearKey, useStoredKey } from "@/lib/apiKey";
import { apiUrl } from "@/lib/api";

interface ApiKeySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiKeySettings({ isOpen, onClose }: ApiKeySettingsProps) {
  const storedKey = useStoredKey();
  const [input, setInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Clear validation error whenever the input changes
  useEffect(() => {
    if (validationError) setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Prefill: if user has a stored key, use it; otherwise fetch the env-loaded default
  useEffect(() => {
    if (!isOpen) return;
    if (storedKey) {
      setInput(storedKey);
      return;
    }
    setLoading(true);
    axios
      .get<{ api_key: string }>(apiUrl("/config/openai-key"))
      .then((res) => setInput(res.data.api_key || ""))
      .catch(() => setInput(""))
      .finally(() => setLoading(false));
  }, [isOpen, storedKey]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer so the click that opened us doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen, onClose]);

  const handleSave = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setValidationError("Key cannot be empty.");
      return;
    }
    setValidationError(null);
    setValidating(true);
    try {
      const res = await axios.post<{ valid: boolean; error?: string }>(
        apiUrl("/config/validate-key"),
        { api_key: trimmed }
      );
      if (!res.data.valid) {
        setValidationError(res.data.error || "Invalid API key.");
        setValidating(false);
        return;
      }
      saveKey(trimmed);
      setSavedToast("API key saved and validated.");
      setTimeout(() => setSavedToast(null), 2500);
      setTimeout(() => onClose(), 600);
    } catch (e) {
      setValidationError("Couldn't reach the server to validate the key. Try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleReset = () => {
    clearKey();
    setInput("");
    setValidationError(null);
    setSavedToast("Key cleared.");
    setTimeout(() => setSavedToast(null), 2500);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute left-full ml-2 bottom-4 w-[340px] bg-white border border-slate-200 rounded-2xl shadow-2xl z-[60] p-4 animate-in fade-in slide-in-from-left-2 duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
            <KeyRound size={16} />
          </div>
          <div>
            <div className="font-bold text-sm text-slate-900">OpenAI API Key</div>
            <div className="text-[11px] text-slate-500">Used for all AI features</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Status badge */}
      <div className="mb-3">
        {storedKey ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Check size={11} /> Key configured
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle size={11} /> No API key set
          </span>
        )}
      </div>

      {/* Input */}
      <div className="relative mb-3">
        <input
          type={reveal ? "text" : "password"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loading ? "Loading…" : "sk-..."}
          disabled={loading}
          className="w-full pl-3 pr-9 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
          title={reveal ? "Hide" : "Show"}
        >
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>

      {/* Inline validation error */}
      {validationError && (
        <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-[11px] text-rose-800">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-rose-600" />
          <span className="leading-snug">{validationError}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={loading || validating || !input.trim()}
          className="flex-1 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          {validating ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Validating…
            </>
          ) : (
            "Save"
          )}
        </button>
        <button
          onClick={handleReset}
          disabled={loading || validating}
          className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
          title="Clear your saved key"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      {/* Toast */}
      {savedToast && (
        <div className="mt-3 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg text-center animate-in fade-in duration-200">
          {savedToast}
        </div>
      )}

      {/* Privacy disclaimer */}
      <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
        Your key is stored only in this browser&apos;s localStorage and sent to this app&apos;s backend with each AI request.
      </p>
    </div>
  );
}
