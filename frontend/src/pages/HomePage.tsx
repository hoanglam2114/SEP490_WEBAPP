import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { clearUserScopedQueryCache } from '../services/queryClient';

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
          d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    ),
  },
  {
    title: 'Dataset Preparation History',
    description: 'View past preparation efforts, manually re-evaluate records, and manage dataset quality.',
    path: '/preparation-history',
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
    title: 'Community Hub',
    description: 'Browse public projects and jump directly into Data Labeling as a public user or assignee',
    path: '/community-hub',
    tag: 'Community',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M17 20h5V10H2v10h5m10 0v-5a3 3 0 00-6 0v5m6 0H7" />
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
  Community: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);
  const { user, logout, token } = useAuthStore();
  const [inputUrl, setInputUrl] = useState('');
  const [connectedUrl, setConnectedUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);


  React.useEffect(() => {
    // Load history from localStorage
    try {
      const h = JSON.parse(localStorage.getItem('gpu_url_history') || '[]');
      setUrlHistory(Array.isArray(h) ? h : []);
    } catch { /* ignore */ }

    // Nếu user đã chủ động ngắt kết nối thì không restore
    const wasDisconnected = localStorage.getItem('gpu_disconnected') === 'true';
    if (wasDisconnected) return;

    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/config/gpu-url`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.gpuUrl && data.configured) {
            setInputUrl(data.gpuUrl);
            setConnectedUrl(data.gpuUrl);
            // Ping 1 lần khi navigate về home để xác nhận GPU còn online không
            try {
              const ping = await fetch('/api/model-eval/gpu-status', {
                signal: AbortSignal.timeout(6000)
              });
              setConnectionStatus(ping.ok ? 'connected' : 'error');
            } catch {
              setConnectionStatus('error');
            }
          }
        }
      } catch (err) {
        console.error('Failed to load GPU config', err);
      }
    };
    fetchConfig();
  }, [token]);


  const handleConnect = async () => {
    const url = inputUrl.trim();
    if (!url) return;
    setConnectionStatus('connecting');
    setShowHistory(false);
    try {
      await fetch(`/api/config/gpu-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ gpuUrl: url })
      });
      const pingRes = await fetch(`/api/model-eval/gpu-status`);
      if (pingRes.ok) {
        setConnectedUrl(url);
        setConnectionStatus('connected');
        localStorage.removeItem('gpu_disconnected');
        setUrlHistory(prev => {
          const next = [url, ...prev.filter(u => u !== url)].slice(0, 5);
          localStorage.setItem('gpu_url_history', JSON.stringify(next));
          return next;
        });
      } else {
        setConnectionStatus('error');
      }
    } catch {
      setConnectionStatus('error');
    }
  };

  const handleDisconnect = async () => {
    setConnectedUrl('');
    setInputUrl('');
    setConnectionStatus('idle');
    localStorage.setItem('gpu_disconnected', 'true');
    try {
      await fetch(`/api/config/gpu-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ gpuUrl: '' })
      });
    } catch { /* ignore */ }
  };

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
            <span className="text-sm font-bold text-slate-800 tracking-tight whitespace-nowrap">Chatbot Training Toolkit</span>
          </div>
          
          {/* GPU Connection widget */}
          <div className="flex-1 max-w-sm mx-6 hidden md:block relative">
            {connectionStatus === 'connected' ? (
              /* ── Compact connected badge ── */
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <span
                  className="text-xs text-emerald-700 font-mono truncate flex-1 min-w-0"
                  title={connectedUrl}
                >
                  {connectedUrl}
                </span>
                <button
                  onClick={handleDisconnect}
                  className="flex-shrink-0 text-xs text-slate-400 hover:text-red-500 transition-colors ml-1 whitespace-nowrap"
                  title="Ngắt kết nối GPU"
                >
                  Ngắt
                </button>
              </div>
            ) : (
              /* ── Input mode when idle / error / connecting ── */
              <div className="flex items-center gap-2">
                <span
                  title={connectionStatus === 'connecting' ? 'Đang kết nối...' : connectionStatus === 'error' ? 'Kết nối thất bại' : 'Chưa kết nối GPU'}
                  className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                    connectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
                    connectionStatus === 'error'      ? 'bg-red-400' :
                                                        'bg-slate-300'
                  }`}
                />
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => { setInputUrl(e.target.value); if (connectionStatus === 'error') setConnectionStatus('idle'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                    disabled={connectionStatus === 'connecting'}
                    className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-800 transition-all placeholder:text-slate-400 disabled:opacity-50 font-mono pr-6"
                    placeholder="https://xyz.ngrok-free.app"
                  />
                  {/* History button inside input */}
                  {urlHistory.length > 0 && connectionStatus !== 'connecting' && (
                    <button
                      onClick={() => setShowHistory(v => !v)}
                      title="Lịch sử kết nối"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs leading-none transition-colors"
                    >▾</button>
                  )}
                </div>
                {/* History dropdown */}
                {showHistory && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowHistory(false)} />
                    <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 w-full overflow-hidden">
                      <div className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        Lịch sử kết nối
                      </div>
                      {urlHistory.map((url, i) => (
                        <button
                          key={i}
                          onClick={() => { setInputUrl(url); setShowHistory(false); setConnectionStatus('idle'); }}
                          className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 font-mono truncate block transition-colors"
                          title={url}
                        >
                          {url}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  onClick={handleConnect}
                  disabled={!inputUrl.trim() || connectionStatus === 'connecting'}
                  className="flex-shrink-0 text-xs font-semibold bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {connectionStatus === 'connecting' ? '…' : 'Kết nối'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-slate-700">Hello, {user.name}</span>
                <button
                  onClick={() => {
                    logout();
                    clearUserScopedQueryCache();
                    navigate('/login');
                  }}
                  className="text-sm font-medium text-red-600 hover:text-red-800"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="text-sm font-medium text-slate-700 hover:text-slate-900 bg-slate-100 px-3 py-1.5 rounded-md"
              >
                Sign In
              </button>
            )}
            <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">v1.0</span>
          </div>
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
