import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';

type Status = 'loading' | 'connected' | 'disconnected';

const HISTORY_KEY = 'gpu_url_history';
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(url: string) {
  const prev = loadHistory().filter(u => u !== url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([url, ...prev].slice(0, MAX_HISTORY)));
}

export function GpuStatusIndicator() {
  const [status, setStatus]           = useState<Status>('loading');
  const [connectedUrl, setConnectedUrl] = useState('');
  const [inputUrl, setInputUrl]       = useState('');
  const [connecting, setConnecting]   = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory]         = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const data = await apiService.getGpuConfig();
      setStatus(data.connected ? 'connected' : 'disconnected');
      setConnectedUrl(data.connected ? data.url : '');
    } catch {
      setStatus('disconnected');
    }
  };

  useEffect(() => {
    fetchStatus();
    setHistory(loadHistory());
    const t = setInterval(fetchStatus, 30_000);
    return () => clearInterval(t);
  }, []);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleConnect = async (url = inputUrl) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setConnecting(true);
    setErrorMsg('');
    setShowHistory(false);
    try {
      const data = await apiService.setGpuConfig(trimmed);
      if (data.connected) {
        saveToHistory(data.url);
        setHistory(loadHistory());
        setStatus('connected');
        setConnectedUrl(data.url);
        setInputUrl('');
      }
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || 'Không kết nối được');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiService.disconnectGpu();
    } catch { /* ignore */ }
    setStatus('disconnected');
    setConnectedUrl('');
  };

  /* ── Connected ── */
  if (status === 'connected') {
    const preview = connectedUrl.slice(0, 20) + (connectedUrl.length > 20 ? '…' : '');
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
        <span>GPU</span>
        <span
          className="font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded cursor-default"
          title={connectedUrl}
        >
          {preview}
        </span>
        <button
          onClick={handleDisconnect}
          className="text-xs px-2.5 py-1 bg-slate-200 text-slate-600 rounded hover:bg-red-100 hover:text-red-600 transition-colors"
        >
          Ngắt
        </button>
      </div>
    );
  }

  /* ── Disconnected ── */
  return (
    <div className="flex items-center gap-2" ref={wrapperRef}>
      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
      <span className="text-xs text-slate-400">GPU</span>

      {/* Input + history dropdown */}
      <div className="relative">
        <input
          type="text"
          value={inputUrl}
          onChange={e => { setInputUrl(e.target.value); setErrorMsg(''); }}
          onFocus={() => history.length > 0 && setShowHistory(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleConnect();
            if (e.key === 'Escape') setShowHistory(false);
          }}
          placeholder="Dán link GPU…"
          disabled={connecting}
          className="text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-slate-400 w-44 placeholder-slate-300 disabled:opacity-50"
        />

        {showHistory && history.length > 0 && (
          <ul className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded shadow-md z-50 overflow-hidden">
            {history.map(url => (
              <li
                key={url}
                onMouseDown={() => handleConnect(url)}
                className="text-xs px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer font-mono text-slate-500 truncate"
                title={url}
              >
                {url}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={() => handleConnect()}
        disabled={connecting || !inputUrl.trim()}
        className="text-xs px-2.5 py-1 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {connecting ? '…' : 'Kết nối'}
      </button>

      {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
    </div>
  );
}
