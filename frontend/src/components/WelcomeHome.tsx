"use client";

import {
  Sparkles, ArrowRight, Lightbulb,
  BookOpen, Share2, Database, FlaskConical,
  Sprout, Target, FileSearch, BrainCircuit,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type FeatureMode = "curriculum" | "playground" | "sandbox" | "lab";

interface WelcomeHomeProps {
  onNavigate: (mode: FeatureMode) => void;
}

interface FeatureCard {
  mode: FeatureMode;
  title: string;
  pill: string;
  description: string;
  icon: LucideIcon;
  iconBg: string;
  iconText: string;
  pillBg: string;
  pillText: string;
  chips: [string, string];
  cta: string;
}

const FEATURES: FeatureCard[] = [
  {
    mode: "curriculum",
    title: "Curriculum",
    pill: "Beginner · ~3 hours",
    description:
      "10 short lessons covering DAGs, confounders, IV, RDD, matching, and more. Each followed by an adaptive quiz.",
    icon: BookOpen,
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-700",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-700",
    chips: ["10 lessons", "Adaptive exams"],
    cta: "Open curriculum",
  },
  {
    mode: "playground",
    title: "DAG playground",
    pill: "Intermediate · Hands-on",
    description:
      "Draw causal graphs, test d-separation, find backdoor paths. The AI analyzer tells you which variables to adjust for.",
    icon: Share2,
    iconBg: "bg-amber-50",
    iconText: "text-amber-700",
    pillBg: "bg-amber-50",
    pillText: "text-amber-700",
    chips: ["Drag & drop", "Live analyzer"],
    cta: "Open playground",
  },
  {
    mode: "sandbox",
    title: "Dataset sandbox",
    pill: "Intermediate · Real data",
    description:
      "Pick a real question, choose an estimator (OLS, IV, RDD, matching), and read an AI interpretation of your result.",
    icon: Database,
    iconBg: "bg-cyan-50",
    iconText: "text-cyan-700",
    pillBg: "bg-cyan-50",
    pillText: "text-cyan-700",
    chips: ["8 queries", "6 estimators"],
    cta: "Open sandbox",
  },
  {
    mode: "lab",
    title: "Research lab",
    pill: "Advanced · AI critique",
    description:
      "Drop in a PDF or describe a study. The Lab maps the DAG and flags hidden assumptions, threats, and alternatives.",
    icon: FlaskConical,
    iconBg: "bg-indigo-50",
    iconText: "text-indigo-700",
    pillBg: "bg-indigo-50",
    pillText: "text-indigo-700",
    chips: ["PDF upload", "Methodology audit"],
    cta: "Open research lab",
  },
];

interface StartPath {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  mode: FeatureMode;
}

const START_PATHS: StartPath[] = [
  {
    title: "New to causality",
    description: "Start with the curriculum to learn the language.",
    icon: Sprout,
    iconColor: "text-emerald-700",
    mode: "curriculum",
  },
  {
    title: "Know the theory",
    description: "Practice in the DAG playground, then run estimators.",
    icon: Target,
    iconColor: "text-cyan-700",
    mode: "playground",
  },
  {
    title: "Reviewing a research paper or study",
    description: "Drop it into the Research Lab for a methodology critique.",
    icon: FileSearch,
    iconColor: "text-indigo-700",
    mode: "lab",
  },
];

function HeroDAG() {
  return (
    <svg
      viewBox="0 0 220 170"
      className="w-full h-full"
      role="img"
      aria-label="A small causal graph: X and Y both share Z as a common cause."
    >
      <defs>
        <marker
          id="welcome-hero-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#818cf8" />
        </marker>
      </defs>
      {/* X → Z: line ends just outside Z (r=22 at 110,40) so the arrowhead tip touches the boundary */}
      <line x1="71" y1="110" x2="99" y2="60" stroke="#818cf8" strokeWidth="1.5" markerEnd="url(#welcome-hero-arrow)" />
      {/* Y → Z: same, from the right node */}
      <line x1="149" y1="110" x2="121" y2="60" stroke="#818cf8" strokeWidth="1.5" markerEnd="url(#welcome-hero-arrow)" />
      {/* Dashed X ⋯ Y: endpoints sit on each node's outer edge */}
      <line x1="84" y1="130" x2="136" y2="130" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="3 3" />
      <g>
        <circle cx="110" cy="40" r="22" fill="#e0e7ff" />
        <text x="110" y="45" textAnchor="middle" fontSize="14" fontWeight="500" fill="#4338ca">Z</text>
      </g>
      <g>
        <circle cx="60" cy="130" r="22" fill="#cffafe" />
        <text x="60" y="135" textAnchor="middle" fontSize="14" fontWeight="500" fill="#0e7490">X</text>
      </g>
      <g>
        <circle cx="160" cy="130" r="22" fill="#ffe4e6" />
        <text x="160" y="135" textAnchor="middle" fontSize="14" fontWeight="500" fill="#be123c">Y</text>
      </g>
      <text x="110" y="165" textAnchor="middle" fontSize="10" fill="#94a3b8">Does X really cause Y?</text>
    </svg>
  );
}

function JourneySVG() {
  const steps = [
    { n: 1, x: 70, label: "Learn", fill: "#d1fae5", text: "#047857" },
    { n: 2, x: 240, label: "Visualize", fill: "#fef3c7", text: "#b45309" },
    { n: 3, x: 410, label: "Apply", fill: "#cffafe", text: "#0e7490" },
    { n: 4, x: 570, label: "Critique", fill: "#e0e7ff", text: "#4338ca" },
  ];
  return (
    <svg
      viewBox="0 0 640 80"
      className="w-full h-20"
      role="img"
      aria-label="A four step learning journey: Learn, Visualize, Apply, Critique."
    >
      <path
        d="M 70 40 Q 220 -10, 240 40 T 410 40 T 570 40"
        stroke="#818cf8"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 4"
      />
      {steps.map((s) => (
        <g key={s.n}>
          <circle cx={s.x} cy="40" r="20" fill={s.fill} />
          <text x={s.x} y="46" textAnchor="middle" fontSize="14" fontWeight="500" fill={s.text}>
            {s.n}
          </text>
          <text x={s.x} y="76" textAnchor="middle" fontSize="10" fill="#94a3b8">
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function FeatureTile({ card, onNavigate }: { card: FeatureCard; onNavigate: (m: FeatureMode) => void }) {
  const Icon = card.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(card.mode)}
      className="group text-left w-full bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-2.5 hover:border-indigo-200 hover:shadow-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
    >
      <div className="flex items-center justify-between">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.iconBg} ${card.iconText}`}>
          <Icon size={18} />
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${card.pillBg} ${card.pillText}`}>
          {card.pill}
        </span>
      </div>

      <div>
        <p className="text-[15px] font-medium text-slate-900 mb-1">{card.title}</p>
        <p className="text-xs text-slate-500 leading-relaxed">{card.description}</p>
      </div>

      <div className="flex flex-wrap gap-1">
        {card.chips.map((chip) => (
          <span key={chip} className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
            {chip}
          </span>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between">
        <span className="text-xs font-medium text-indigo-600">{card.cta}</span>
        <ArrowRight size={14} className="text-indigo-600 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function StartPathTile({ path, onNavigate }: { path: StartPath; onNavigate: (m: FeatureMode) => void }) {
  const Icon = path.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(path.mode)}
      className="text-left border border-slate-200 rounded-lg p-3 hover:border-indigo-200 hover:bg-slate-50 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={16} className={path.iconColor} />
        <span className="text-xs font-medium text-slate-900">{path.title}</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">{path.description}</p>
    </button>
  );
}

export default function WelcomeHome({ onNavigate }: WelcomeHomeProps) {
  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto">

          {/* Hero */}
          <section className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-6 items-center mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
                  <BrainCircuit className="text-white" size={30} />
                </div>
                <span className="font-bold text-slate-900 text-5xl tracking-tight">Causal Tutor</span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 mb-3.5">
                <Sparkles size={14} />
                Built for new learners
              </span>
              <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight leading-tight mb-2.5">
                Learn to tell causation from correlation.
              </h1>
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                Causal Tutor walks you from the basics to real-world data analysis through theory,
                interactive graphs, and AI feedback on your reasoning.
              </p>
              <button
                type="button"
                onClick={() => onNavigate("curriculum")}
                className="inline-flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                Start with lesson 1
                <ArrowRight size={16} />
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 aspect-[1.2/1] flex items-center justify-center">
              <HeroDAG />
            </div>
          </section>

          {/* "Why this matters" hook */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 md:p-5 mb-8">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
                <Lightbulb size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900 mb-1">Why this matters</p>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Ice cream sales and drowning deaths rise together every summer but ice cream
                  doesn&apos;t cause drowning. Hot weather causes both. Spotting the hidden cause is
                  what makes a good scientist, a careful data analyst, and a sharp critical thinker.
                </p>
              </div>
            </div>
          </section>

          {/* Learning journey */}
          <section className="mb-8">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.08em] mb-3">
              Your learning journey
            </p>
            <JourneySVG />
          </section>

          {/* Feature cards */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
            {FEATURES.map((card) => (
              <FeatureTile key={card.mode} card={card} onNavigate={onNavigate} />
            ))}
          </section>

          {/* Personalized start */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5">
            <p className="text-sm font-medium text-slate-900 mb-3">Not sure where to begin?</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {START_PATHS.map((path) => (
                <StartPathTile key={path.title} path={path} onNavigate={onNavigate} />
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
