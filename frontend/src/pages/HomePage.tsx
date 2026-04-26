import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GpuStatusIndicator } from '../components/GpuStatusIndicator';

const tools = [
  {
    title: 'Data Preparation',
    description: 'Convert chatbot data to Alpaca/OpenAI messages format, clean data, evaluate dataset quality',
    path: '/chatbotconverter',
    tag: 'Preparation',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    title: 'AutoTrain',
    description: 'Fine-tune LLM models with custom datasets on GPU',
    path: '/autotrain',
    tag: 'Training',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: 'Training History',
    description: 'View and manage all past training runs and checkpoints',
    path: '/training-history',
    tag: 'History',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Model Evaluation',
    description: 'Evaluate fine-tuned models and compare against baseline performance',
    path: '/model-eval/leaderboard',
    tag: 'Evaluation',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: 'Model Registry',
    description: 'Central repository to manage model versions, metrics, and deployment status',
    path: '/model-registry',
    tag: 'Registry',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012v2M7 7h10" />
      </svg>
    ),
  },
  {
    title: 'Dataset Evaluation History',
    description: 'View past evaluations, manually re-evaluate records, and manage dataset quality.',
    path: '/evaluation-history',
    tag: 'History',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 17v-2m3 2v-4m3 4V9m3 10H6a2 2 0 01-2-2V7a2 2 0 012-2h3l2-2h2l2 2h3a2 2 0 012 2v10a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: 'AI Chatbot',
    description: 'Chat with fine-tuned models and test inference',
    path: '/chat',
    tag: 'Inference',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    title: 'API Key Manager',
    description: 'Quản lý API keys an toàn — mã hoá AES-256, bảo vệ bằng PIN',
    path: '/admin/api-keys',
    tag: 'Admin',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ),
  },
];

const TAG_COLORS: Record<string, string> = {
  Preprocessing: 'bg-sky-50 text-sky-600 border-sky-200',
  Training: 'bg-violet-50 text-violet-600 border-violet-200',
  History: 'bg-slate-100 text-slate-500 border-slate-200',
  Evaluation: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  Registry: 'bg-blue-50 text-blue-600 border-blue-200',
  Inference: 'bg-amber-50 text-amber-600 border-amber-200',
  Admin: 'bg-rose-50 text-rose-600 border-rose-200',
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-slate-800 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-bold text-slate-800 tracking-tight">Chatbot Training Toolkit</span>
          </div>
          <GpuStatusIndicator />
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-14 pb-10">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
          Platform
        </p>
        <h1 className="text-4xl font-bold text-slate-900 leading-tight">
          Train. Evaluate.<br />
          <span className="text-slate-400">Deploy.</span>
        </h1>
        <p className="mt-4 text-slate-500 text-base max-w-md">
          End-to-end toolkit for fine-tuning large language models — from data prep to evaluation.
        </p>
      </div>

      {/* Tool grid */}
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            const isHovered = hovered === tool.path;
            return (
              <button
                key={tool.path}
                onClick={() => navigate(tool.path)}
                onMouseEnter={() => setHovered(tool.path)}
                onMouseLeave={() => setHovered(null)}
                className={`group text-left bg-white border rounded-2xl p-6 transition-all duration-200 cursor-pointer
                  ${isHovered
                    ? 'border-slate-800 shadow-md shadow-slate-200'
                    : 'border-slate-200 hover:border-slate-300 shadow-sm'
                  }`}
              >
                {/* Icon + tag row */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-2.5 rounded-xl border transition-colors duration-200
                    ${isHovered ? 'bg-slate-800 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    {tool.icon}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[tool.tag]}`}>
                    {tool.tag}
                  </span>
                </div>

                {/* Text */}
                <h2 className="text-sm font-bold text-slate-800 mb-1.5">{tool.title}</h2>
                <p className="text-xs text-slate-400 leading-relaxed">{tool.description}</p>

                {/* Arrow */}
                <div className={`mt-4 flex items-center gap-1 text-xs font-semibold transition-all duration-200
                  ${isHovered ? 'text-slate-800 translate-x-0.5' : 'text-slate-300'}`}>
                  Open
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
};