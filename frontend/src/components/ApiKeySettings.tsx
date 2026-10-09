"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Search, X } from "lucide-react";
import axios from "axios";
import {
  type LLMProvider,
  clearKey,
  getStoredKey,
  getStoredModel,
  getStoredProvider,
  saveKey,
  saveModel,
  saveProvider,
  useStoredLlmState,
} from "@/lib/apiKey";
import { apiUrl } from "@/lib/api";

interface ApiKeySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ModelOption {
  id: string;
  label: string;
  /** False when the model can't read PDF files natively (gets extracted text instead). */
  supports_pdf?: boolean;
}

interface ProviderConfig {
  id: LLMProvider;
  label: string;
  default_model: string;
  models: ModelOption[];
  env_api_key: string;
  has_env_key: boolean;
}

interface LLMConfigResponse {
  default_provider: LLMProvider;
  providers: ProviderConfig[];
}

function keyPlaceholder(provider: LLMProvider): string {
  return provider === "openrouter" ? "sk-or-v1-..." : "sk-...";
}

export default function ApiKeySettings({ isOpen, onClose }: ApiKeySettingsProps) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [provider, setProvider] = useState<LLMProvider>("openai");
  const [model, setModel] = useState("");
  const [modelProvider, setModelProvider] = useState<LLMProvider>("openai");
  const [modelSearch, setModelSearch] = useState("");
  const [input, setInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const llmState = useStoredLlmState();

  const activeProviderConfig = useMemo(
    () => providers.find((p) => p.id === provider) || null,
    [providers, provider]
  );

  const activeStoredKey = getStoredKey(provider);
  const currentProviderConfig = useMemo(
    () => providers.find((p) => p.id === llmState.provider) || null,
    [providers, llmState.provider]
  );
  const savedModelId = llmState.model;
  const currentModelId = savedModelId || currentProviderConfig?.default_model || currentProviderConfig?.models?.[0]?.id || "";
  const currentModelOption = currentProviderConfig?.models?.find((m) => m.id === currentModelId);
  const selectedDraftModel = modelProvider === provider ? model : "";
  const selectedModelOption = selectedDraftModel
    ? activeProviderConfig?.models?.find((m) => m.id === selectedDraftModel)
    : undefined;
  const draftProviderLabel = activeProviderConfig?.label || (provider === "openrouter" ? "OpenRouter" : "OpenAI");
  const currentProviderLabel = currentProviderConfig?.label || (llmState.provider === "openrouter" ? "OpenRouter" : "OpenAI");
  const hasUnsavedProviderChange = provider !== llmState.provider;
  const draftModelBaseline = provider === llmState.provider ? currentModelId : getStoredModel(provider) || "";
  const hasUnsavedModelChange = !!selectedDraftModel && selectedDraftModel !== draftModelBaseline;
  const hasUnsavedSelection = hasUnsavedProviderChange || hasUnsavedModelChange;

  const filteredModelGroups = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const groups = new Map<string, ModelOption[]>();
    (activeProviderConfig?.models || [])
      .filter((m) => !query || m.label.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
      .forEach((m) => {
        const rawGroup = provider === "openrouter" && m.id.includes("/") ? m.id.split("/")[0] : "openai";
        const group =
          rawGroup === "openai"
            ? "OpenAI"
            : rawGroup === "anthropic"
            ? "Anthropic"
            : rawGroup === "google"
            ? "Google"
            : rawGroup === "x-ai"
            ? "xAI"
            : rawGroup === "deepseek"
            ? "DeepSeek"
            : rawGroup === "z-ai"
            ? "Z.ai"
            : rawGroup === "moonshotai"
            ? "Moonshot AI"
            : rawGroup;
        groups.set(group, [...(groups.get(group) || []), m]);
      });
    return Array.from(groups.entries());
  }, [activeProviderConfig, modelSearch, provider]);

  const syncInputsForProvider = (nextProvider: LLMProvider, availableProviders: ProviderConfig[]) => {
    const cfg = availableProviders.find((p) => p.id === nextProvider);
    const savedKey = getStoredKey(nextProvider);
    const savedSelectedModel = getStoredModel(nextProvider);
    const modelIds = new Set((cfg?.models || []).map((m) => m.id));
    const fallbackModel =
      savedSelectedModel && modelIds.has(savedSelectedModel)
        ? savedSelectedModel
        : cfg?.default_model || cfg?.models?.[0]?.id || "";

    setProvider(nextProvider);
    setInput(savedKey || cfg?.env_api_key || "");
    setModel(fallbackModel);
    setModelProvider(nextProvider);
    setModelSearch("");
  };

  useEffect(() => {
    if (validationError) setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, model, provider]);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    axios
      .get<LLMConfigResponse>(apiUrl("/config/llm-config"))
      .then((res) => {
        const availableProviders = res.data.providers || [];
        setProviders(availableProviders);
        const storedProvider = getStoredProvider();
        const ids = new Set(availableProviders.map((p) => p.id));
        const initialProvider = ids.has(storedProvider) ? storedProvider : res.data.default_provider || "openai";
        syncInputsForProvider(initialProvider, availableProviders);
      })
      .catch(() => {
        setProviders([]);
        syncInputsForProvider("openai", []);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen, onClose]);

  const handleProviderChange = (nextProvider: LLMProvider) => {
    const cfg = providers.find((p) => p.id === nextProvider);
    const savedKey = getStoredKey(nextProvider);

    setProvider(nextProvider);
    setInput(savedKey || cfg?.env_api_key || "");
    setModelSearch("");
  };

  const handleSave = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setValidationError("Key cannot be empty.");
      return;
    }
    if (!selectedDraftModel.trim()) {
      setValidationError("Select a model.");
      return;
    }

    setValidationError(null);
    setValidating(true);
    try {
      const res = await axios.post<{ valid: boolean; error?: string }>(apiUrl("/config/validate-key"), {
        provider,
        api_key: trimmed,
      });
      if (!res.data.valid) {
        setValidationError(res.data.error || "Invalid API key.");
        return;
      }
      saveProvider(provider);
      saveModel(provider, selectedDraftModel);
      saveKey(provider, trimmed);
      setSavedToast(`${activeProviderConfig?.label || "Provider"} settings saved.`);
      setTimeout(() => setSavedToast(null), 2500);
      setTimeout(() => onClose(), 600);
    } catch {
      setValidationError("Couldn't reach the server to validate the key. Try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleReset = () => {
    clearKey(provider);
    setInput("");
    setValidationError(null);
    setSavedToast(`${activeProviderConfig?.label || "Provider"} key cleared.`);
    setTimeout(() => setSavedToast(null), 2500);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute left-full ml-2 bottom-4 w-[410px] bg-white border border-slate-200 rounded-2xl shadow-2xl z-[60] p-4 animate-in fade-in slide-in-from-left-2 duration-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
            <KeyRound size={16} />
          </div>
          <div>
            <div className="font-bold text-sm text-slate-900">Connect your AI</div>
            <div className="text-[11px] text-slate-500">Choose provider, model, and credentials</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3">
        {activeStoredKey ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Check size={11} /> {activeProviderConfig?.label || "Provider"} key configured
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle size={11} /> No key set for {activeProviderConfig?.label || "provider"}
          </span>
        )}
      </div>

      <div className="mb-3">
        <div className="text-[11px] font-semibold text-slate-500 mb-1">Provider</div>
        <div className="grid grid-cols-2 gap-2">
          {(["openai", "openrouter"] as LLMProvider[]).map((id) => {
            const cfg = providers.find((p) => p.id === id);
            const label = cfg?.label || (id === "openrouter" ? "OpenRouter" : "OpenAI");
            const active = provider === id;
            return (
              <button
                key={id}
                onClick={() => handleProviderChange(id)}
                disabled={loading || validating}
                className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Current model in use</div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {currentProviderLabel} · {currentModelOption?.label || currentModelId || "No model selected"}
            </div>
            {currentModelId && <div className="mt-0.5 font-mono text-[10px] text-slate-500">{currentModelId}</div>}
          </div>
          {hasUnsavedSelection ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              Unsaved
            </span>
          ) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              Active
            </span>
          )}
        </div>
        {hasUnsavedSelection && (
          <div className="mt-2 rounded-lg border border-amber-100 bg-white/70 px-2 py-1.5 text-[11px] text-amber-800">
            {selectedDraftModel ? (
              <>
                Selected next: <span className="font-semibold">{draftProviderLabel} · {selectedModelOption?.label || selectedDraftModel}</span>. Save to make it active.
              </>
            ) : (
              <>
                Choose a model for <span className="font-semibold">{draftProviderLabel}</span>, then save to make it active.
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[11px] font-semibold text-slate-500">Choose model</div>
          <div className="text-[10px] text-slate-400">{activeProviderConfig?.models?.length || 0} available</div>
        </div>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder="Search by name or model id..."
            disabled={loading || validating || !activeProviderConfig}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-2 custom-scrollbar">
          {filteredModelGroups.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">No models match your search.</div>
          ) : (
            filteredModelGroups.map(([group, options]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</div>
                <div className="space-y-1">
                  {options.map((m) => {
                    const selected = modelProvider === provider && m.id === model;
                    const inUse = provider === llmState.provider && m.id === currentModelId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setModel(m.id);
                          setModelProvider(provider);
                        }}
                        disabled={loading || validating}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-indigo-300 bg-white ring-2 ring-indigo-50"
                            : "border-transparent bg-white/70 hover:border-slate-200 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-800">{m.label}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                            inUse ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : selected ? "bg-indigo-50 text-indigo-700 border border-indigo-100" : "bg-slate-100 text-slate-500"
                          }`}>
                            {inUse ? "In use" : selected ? "Selected" : "Pick"}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {m.id}
                          {m.supports_pdf === false && (
                            <span className="ml-1.5 font-sans" title="Reads PDFs as extracted text only, so figures and image-only content are not visible">
                              · text-only PDFs
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="relative mb-3">
        <input
          type={reveal ? "text" : "password"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loading ? "Loading..." : keyPlaceholder(provider)}
          disabled={loading || validating}
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

      {validationError && (
        <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-[11px] text-rose-800">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-rose-600" />
          <span className="leading-snug">{validationError}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={loading || validating || !input.trim() || !selectedDraftModel}
          className="flex-1 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          {validating ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Validating...
            </>
          ) : (
            "Save"
          )}
        </button>
        <button
          onClick={handleReset}
          disabled={loading || validating}
          className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
          title="Clear the saved key for the selected provider"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      {savedToast && (
        <div className="mt-3 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg text-center animate-in fade-in duration-200">
          {savedToast}
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
        Your key is stored only in your browser&apos;s memory.
      </p>
    </div>
  );
}

