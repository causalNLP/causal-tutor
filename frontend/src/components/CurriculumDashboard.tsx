"use client";

import { useState, useEffect } from "react";
import { BookOpen, GraduationCap, PlayCircle, Loader2, ArrowLeft, CheckCircle2, ChevronRight, ChevronLeft, XCircle, Check, RotateCcw, X } from "lucide-react";
import dynamic from "next/dynamic";
import { getApiHeaders } from "@/lib/apiKey";
import { checkAuthResponse } from "@/lib/apiErrors";
import { apiUrl } from "@/lib/api";

const MermaidChart = dynamic(() => import("./MermaidChart"), { ssr: false });

interface CurriculumDashboardProps {
    // Lets parent (page.tsx) know what's being studied so the unified Tutor
    // chat can ask the bot relevant questions about the current method.
    onContextChange?: (ctx: { feature: "curriculum"; payload: any }) => void;
    // Tells the parent to lock the Tutor chat (hide FAB + close panel) when the
    // student is mid-exam, to keep the assessment honest.
    onChatLockedChange?: (locked: boolean) => void;
    // When true (both side panels open), tile buttons shrink so they don't
    // look elongated in the constrained main-content area.
    compactCards?: boolean;
}

export default function CurriculumDashboard({ onContextChange, onChatLockedChange, compactCards = false }: CurriculumDashboardProps = {}) {
    const [methods, setMethods] = useState<any[]>([]);
    const [selectedMethod, setSelectedMethod] = useState<any | null>(null);
    const [viewMode, setViewMode] = useState<"grid" | "theory" | "exam">("grid");
    const [examQuestions, setExamQuestions] = useState<any[]>([]);
    const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
    // One slot per question; null means "not answered yet". Replaces the
    // running score so users can navigate back and change answers.
    const [userAnswers, setUserAnswers] = useState<(number | null)[]>([]);
    // Captured at exam start so the result-screen "Retake exam" button can
    // re-run startExam without depending on `selectedMethod` (which is only
    // set via the theory view, not when launching from the grid tile).
    const [examMethodId, setExamMethodId] = useState<string | null>(null);
    const [examMethodTitle, setExamMethodTitle] = useState<string | null>(null);
    const [showResult, setShowResult] = useState(false);
    const [loadingExam, setLoadingExam] = useState<string | null>(null);
    const [loadingTheory, setLoadingTheory] = useState(true);
    const [numQuestions, setNumQuestions] = useState<number>(5); // User can select number of questions

    useEffect(() => {
        const fetchMethods = async () => {
            try {
                const res = await fetch(apiUrl("/curriculum-methods"));
                const data = await res.json();
                // Map object to array
                const methodsArray = Object.keys(data).map(key => ({
                    id: key,
                    ...data[key],
                    // Assign random color just for UI
                    color: ["bg-emerald-100 text-emerald-700", "bg-blue-100 text-blue-700", "bg-amber-100 text-amber-700", "bg-purple-100 text-purple-700", "bg-rose-100 text-rose-700"][Math.floor(Math.random() * 5)]
                }));
                setMethods(methodsArray);
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingTheory(false);
            }
        };
        fetchMethods();
    }, []);

    // Publish current viewing context up so the unified Tutor chat can use it.
    useEffect(() => {
        if (!onContextChange) return;
        if (selectedMethod && viewMode === "theory") {
            onContextChange({
                feature: "curriculum",
                payload: {
                    methodTitle: selectedMethod.title,
                    description: selectedMethod.description,
                    assumptions: selectedMethod.key_assumptions,
                    example: selectedMethod.example_scenario,
                },
            });
        } else {
            onContextChange({
                feature: "curriculum",
                payload: { overview: methods.map((m: any) => m.title).join(", ") },
            });
        }
    }, [selectedMethod, viewMode, methods, onContextChange]);

    // Lock the Tutor chat (and platform nav) only while the student is
    // actively answering questions. The post-submit review screen unlocks
    // again so they can ask the AI about their mistakes.
    useEffect(() => {
        if (!onChatLockedChange) return;
        onChatLockedChange(viewMode === "exam" && !showResult);
        // On unmount, ensure the lock is released so other modes aren't accidentally locked.
        return () => onChatLockedChange(false);
    }, [viewMode, showResult, onChatLockedChange]);

    const startTheory = (method: any) => {
        setSelectedMethod(method);
        setViewMode("theory");
    };

    const startExam = async (methodId: string, methodTitle: string) => {
        setLoadingExam(methodId);
        try {
            const res = await fetch(apiUrl(`/generate-exam?method_name=${methodTitle}&num_questions=${numQuestions}`), {
                method: "POST",
                headers: { ...getApiHeaders() },
            });
            await checkAuthResponse(res);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            setExamQuestions(data.questions);
            setUserAnswers(new Array(data.questions.length).fill(null));
            setExamMethodId(methodId);
            setExamMethodTitle(methodTitle);
            setViewMode("exam");
            setCurrentQuestionIdx(0);
            setShowResult(false);
        } catch (e) {
            console.error(e);
            const isAuth = e instanceof Error && (e as { status?: number }).status === 401;
            alert(isAuth ? (e as Error).message : "Failed to generate exam. Ensure backend is running.");
        } finally {
            setLoadingExam(null);
        }
    };

    const selectAnswer = (optionIndex: number) => {
        setUserAnswers(prev => prev.map((a, i) => i === currentQuestionIdx ? optionIndex : a));
    };
    const goPrev = () => setCurrentQuestionIdx(i => Math.max(0, i - 1));
    const goNext = () => setCurrentQuestionIdx(i => Math.min(examQuestions.length - 1, i + 1));
    const finishExam = () => setShowResult(true);

    if (viewMode === "exam" && examQuestions.length > 0) {
        if (showResult) {
            const score = userAnswers.reduce(
                (acc: number, a, i) => acc + (a === examQuestions[i]?.correct_option_index ? 1 : 0),
                0
            );
            const total = examQuestions.length;
            const pct = total > 0 ? score / total : 0;
            const wrong = examQuestions
                .map((q, i) => ({ q, i, picked: userAnswers[i] as number }))
                .filter(({ q, picked }) => picked !== q.correct_option_index);
            const tone = pct >= 0.8
                ? { bg: "bg-emerald-100", text: "text-emerald-600" }
                : pct >= 0.5
                    ? { bg: "bg-amber-100", text: "text-amber-600" }
                    : { bg: "bg-rose-100", text: "text-rose-600" };

            return (
                <div className="flex flex-col h-full p-6 bg-slate-50 animate-in fade-in overflow-hidden">
                    <div className="bg-white rounded-3xl shadow-xl max-w-3xl w-full mx-auto border border-slate-200 flex flex-col overflow-hidden flex-1">
                        <div className="p-8 text-center border-b border-slate-100">
                            <div className={`w-20 h-20 ${tone.bg} rounded-full flex items-center justify-center mx-auto mb-6`}>
                                <GraduationCap size={40} className={tone.text} />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">Exam Complete!</h2>
                            <p className="text-slate-500">
                                You scored <span className="font-bold text-slate-900">{score} / {total}</span>
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6">
                            {wrong.length === 0 ? (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-emerald-700">
                                    <CheckCircle2 size={18} />
                                    Perfect score — nothing to review.
                                </div>
                            ) : (
                                <>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                                        Review your mistakes ({wrong.length})
                                    </h3>
                                    <div className="space-y-4">
                                        {wrong.map(({ q, i, picked }) => (
                                            <WrongQuestionCard key={i} index={i} question={q} picked={picked} />
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="border-t border-slate-100 p-6 flex gap-3">
                            <button
                                onClick={() => examMethodId && examMethodTitle && startExam(examMethodId, examMethodTitle)}
                                disabled={!examMethodId || loadingExam !== null}
                                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {loadingExam ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                                Retake exam
                            </button>
                            <button
                                onClick={() => setViewMode("grid")}
                                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
                            >
                                Return to Curriculum
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        const q = examQuestions[currentQuestionIdx];
        const currentPick = userAnswers[currentQuestionIdx];
        const answeredCount = userAnswers.filter(a => a !== null).length;
        const isLast = currentQuestionIdx === examQuestions.length - 1;
        const allAnswered = userAnswers.every(a => a !== null);

        const quitExam = () => {
            if (window.confirm("Quit the exam? Your progress will be lost.")) {
                setViewMode("grid");
            }
        };
        return (
            <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
                <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-700">Exam Mode</span>
                        {examMethodTitle && (
                            <span className="text-sm text-slate-500 truncate hidden md:inline">· {examMethodTitle}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm bg-slate-100 px-3 py-1 rounded-full text-slate-600">Question {currentQuestionIdx + 1} / {examQuestions.length}</span>
                        <button
                            onClick={quitExam}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 transition-colors flex items-center gap-1.5"
                            title="Quit exam and return to curriculum"
                        >
                            <X size={14} /> Quit exam
                        </button>
                    </div>
                </header>

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-2xl w-full overflow-hidden">
                        <div className="p-8">
                            <h3 className="text-xl font-semibold text-slate-900 mb-6 leading-relaxed">{q.question_text}</h3>
                            <div className="space-y-3">
                                {q.options.map((opt: string, idx: number) => {
                                    const selected = currentPick === idx;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => selectAnswer(idx)}
                                            className={`w-full text-left p-4 rounded-xl border transition-all font-medium ${
                                                selected
                                                    ? "bg-indigo-50 border-indigo-400 text-indigo-700 ring-2 ring-indigo-100"
                                                    : "border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50"
                                            }`}
                                        >
                                            <span className={`inline-block w-6 font-bold mr-2 ${selected ? "text-indigo-500" : "text-slate-400"}`}>
                                                {String.fromCharCode(65 + idx)}.
                                            </span>
                                            {opt}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="px-8 pb-6 pt-4 flex items-center justify-between gap-3 border-t border-slate-100">
                            <button
                                onClick={goPrev}
                                disabled={currentQuestionIdx === 0}
                                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                                <ChevronLeft size={16} /> Previous
                            </button>
                            <span className="text-xs text-slate-500">
                                {answeredCount} / {examQuestions.length} answered
                            </span>
                            {!isLast ? (
                                <button
                                    onClick={goNext}
                                    disabled={currentPick === null}
                                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-black disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1.5"
                                >
                                    Next <ChevronRight size={16} />
                                </button>
                            ) : (
                                <button
                                    onClick={finishExam}
                                    disabled={!allAnswered}
                                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1.5"
                                >
                                    Submit exam
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (viewMode === "theory" && selectedMethod) {
        return (
            <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
                <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between gap-4 shadow-sm z-10">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                        <button
                            onClick={() => setViewMode("grid")}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors flex-shrink-0"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h2 className="text-xl font-bold text-slate-900 truncate">{selectedMethod.title}</h2>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                            <span className="text-xs font-semibold text-slate-500">Length:</span>
                            <select 
                                value={numQuestions}
                                onChange={(e) => setNumQuestions(Number(e.target.value))}
                                className="bg-transparent border-none text-slate-700 text-sm focus:ring-0 p-0 outline-none cursor-pointer"
                            >
                                <option value={3}>3 Qs</option>
                                <option value={5}>5 Qs</option>
                                <option value={10}>10 Qs</option>
                                <option value={15}>15 Qs</option>
                                <option value={20}>20 Qs</option>
                            </select>
                        </div>
                        <button
                            onClick={() => startExam(selectedMethod.id, selectedMethod.title)}
                            disabled={loadingExam === selectedMethod.id}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                            {loadingExam === selectedMethod.id ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" /> Generating…
                                </>
                            ) : (
                                <>
                                    <PlayCircle size={16} /> Take Exam
                                </>
                            )}
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div className="max-w-4xl mx-auto space-y-8 pb-12">
                        {/* Overview */}
                        <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <BookOpen size={20} className="text-indigo-500" />
                                Conceptual Overview
                            </h3>
                            <p className="text-slate-700 leading-relaxed text-lg">
                                {selectedMethod.description}
                            </p>
                        </section>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Assumptions */}
                            <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
                                <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                                    <CheckCircle2 size={20} className="text-emerald-500" />
                                    Key Assumptions
                                </h3>
                                <ul className="space-y-4">
                                    {selectedMethod.key_assumptions.map((ass: string, idx: number) => {
                                        const [title, desc] = ass.split(":");
                                        return (
                                            <li key={idx} className="flex gap-3">
                                                <div className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                                                <div>
                                                    <span className="font-bold text-slate-800">{title}:</span>
                                                    <span className="text-slate-600">{desc}</span>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>

                            {/* Causal Graph */}
                            <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm flex flex-col">
                                <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <ChevronRight size={20} className="text-indigo-500" />
                                        Identification Strategy
                                    </span>
                                    <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-medium border border-slate-200">DAG</span>
                                </h3>
                                <div className="flex-1 bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-center justify-center min-h-[200px]">
                                    <MermaidChart chart={selectedMethod.dag_mermaid} />
                                </div>
                            </section>
                        </div>

                        {/* Example */}
                        <section className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl p-8 border border-indigo-100 shadow-inner">
                            <h3 className="text-lg font-bold text-indigo-900 mb-2">Classic Example</h3>
                            <p className="text-indigo-800 leading-relaxed italic">
                                "{selectedMethod.example_scenario}"
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            <header className="px-8 py-6 bg-white border-b border-slate-200 shadow-sm z-10 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <BookOpen className="text-indigo-600 flex-shrink-0" size={24} />
                        <h1 className="text-2xl font-bold text-slate-900 truncate">Causality Curriculum</h1>
                    </div>
                    <p className="text-slate-500 truncate">Master the 10 core methods of causal inference through theory and interactive exams.</p>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 flex-shrink-0">
                    <span className="text-sm font-semibold text-slate-600">Exam Length:</span>
                    <select 
                        value={numQuestions}
                        onChange={(e) => setNumQuestions(Number(e.target.value))}
                        className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none cursor-pointer"
                    >
                        <option value={3}>3 Questions</option>
                        <option value={5}>5 Questions</option>
                        <option value={10}>10 Questions</option>
                        <option value={15}>15 Questions</option>
                        <option value={20}>20 Questions</option>
                    </select>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {loadingTheory ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin text-indigo-500" size={32} />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">
                        {methods.map((method) => (
                            <div 
                                key={method.id}
                                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all group flex flex-col h-full"
                            >
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${method.color} shadow-inner`}>
                                    <BookOpen size={20} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-indigo-700 transition-colors">{method.title}</h3>
                                <p className="text-sm text-slate-500 mb-6 leading-relaxed flex-1">
                                    {method.description}
                                </p>
                                
                                <div className="flex gap-3 mt-auto pt-4 border-t border-slate-100">
                                    <button
                                        className={`flex-1 ${compactCards ? "py-1.5 text-xs gap-1.5" : "py-2.5 text-sm gap-2"} rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-bold hover:bg-slate-100 hover:text-slate-900 transition-all flex items-center justify-center whitespace-nowrap`}
                                        onClick={() => startTheory(method)}
                                    >
                                        <BookOpen size={compactCards ? 14 : 16} className="text-slate-400" />
                                        Learn Theory
                                    </button>
                                    <button
                                        onClick={() => startExam(method.id, method.title)}
                                        disabled={loadingExam === method.id}
                                        className={`flex-1 ${compactCards ? "py-1.5 text-xs gap-1.5" : "py-2.5 text-sm gap-2"} rounded-xl bg-slate-900 text-white font-bold hover:bg-indigo-600 transition-all flex items-center justify-center shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed whitespace-nowrap`}
                                    >
                                        {loadingExam === method.id ? <Loader2 size={compactCards ? 14 : 16} className="animate-spin" /> : <PlayCircle size={compactCards ? 14 : 16} />}
                                        Start Exam
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function WrongQuestionCard({ index, question, picked }: { index: number; question: any; picked: number }) {
    const correct = question.correct_option_index;
    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border border-slate-100 px-2 py-0.5 rounded">
                    Question {index + 1}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                    <XCircle size={12} /> Incorrect
                </span>
            </div>

            <p className="text-sm font-medium text-slate-900 leading-relaxed mb-3">{question.question_text}</p>

            <div className="space-y-2 mb-3">
                {question.options.map((opt: string, idx: number) => {
                    const isCorrect = idx === correct;
                    const isPicked = idx === picked;
                    let cls = "bg-slate-50 text-slate-600 border-slate-100";
                    let icon = null;
                    let tag = null;
                    if (isCorrect) {
                        cls = "bg-emerald-50 text-emerald-800 border-emerald-200";
                        icon = <Check size={14} className="text-emerald-600 flex-shrink-0" />;
                        tag = <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-700">Correct answer</span>;
                    } else if (isPicked) {
                        cls = "bg-rose-50 text-rose-800 border-rose-200";
                        icon = <XCircle size={14} className="text-rose-600 flex-shrink-0" />;
                        tag = <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-rose-700">Your answer</span>;
                    }
                    return (
                        <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${cls}`}>
                            {icon || <span className="w-3.5 flex-shrink-0" />}
                            <span className="font-bold w-5">{String.fromCharCode(65 + idx)}.</span>
                            <span className="flex-1">{opt}</span>
                            {tag}
                        </div>
                    );
                })}
            </div>

            {question.explanation && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">Why</div>
                    <p className="text-xs text-slate-700 leading-relaxed">{question.explanation}</p>
                </div>
            )}
        </div>
    );
}
