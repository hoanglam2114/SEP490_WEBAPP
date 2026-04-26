import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ShieldCheck, Lock, AlertTriangle, RefreshCw } from 'lucide-react';
import { pinApi, PinStatus } from '../../services/adminApiService';
import toast from 'react-hot-toast';

interface PinGateProps {
  onUnlocked: (token: string) => void;
}

export function PinGate({ onUnlocked }: PinGateProps) {
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [mode, setMode] = useState<'verify' | 'setup' | 'change'>('verify');
  const [setupDigits, setSetupDigits] = useState<string[]>(Array(6).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Load trạng thái PIN ───────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const s = await pinApi.getStatus();
      setStatus(s);
      if (!s.initialized) setMode('setup');
      else setMode('verify');
      if (s.isLocked && s.remainingSeconds > 0) setCountdown(s.remainingSeconds);
    } catch {
      setError('Không thể kết nối server.');
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // ── Countdown khi bị khoá ────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { loadStatus(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown, loadStatus]);

  // ── Xử lý nhập PIN ──────────────────────────────────────────────────────
  const handleDigitChange = (
    index: number,
    value: string,
    arr: string[],
    setArr: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...arr];
    next[index] = v;
    setArr(next);
    if (v && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    arr: string[],
    setArr: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (e.key === 'Backspace' && !arr[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      const pin = arr.join('');
      if (pin.length === 6) handleSubmit(pin);
    }
  };

  const handlePaste = (
    e: React.ClipboardEvent,
    setArr: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (paste.length === 6) {
      setArr(paste.split(''));
      inputRefs.current[5]?.focus();
    }
    e.preventDefault();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (pin: string) => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'setup') {
        await pinApi.setup(pin);
        toast.success('PIN đã được thiết lập!');
        setMode('verify');
        setSetupDigits(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      } else {
        const { token } = await pinApi.verify(pin);
        onUnlocked(token);
      }
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.remainingSeconds) {
        setCountdown(data.remainingSeconds);
        setError(data.error || 'Bị khoá tạm thời.');
      } else {
        setError(data?.error || 'PIN không đúng.');
      }
      if (mode === 'verify') setDigits(Array(6).fill(''));
      else setSetupDigits(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const isLocked = countdown > 0;
  const activeDigits = mode === 'setup' ? setupDigits : digits;
  const setActiveDigits = mode === 'setup' ? setSetupDigits : setDigits;
  const pin = activeDigits.join('');

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-sm p-8">

        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center
            ${isLocked ? 'bg-red-50' : 'bg-slate-800'}`}>
            {isLocked
              ? <Lock className="w-8 h-8 text-red-500" />
              : <ShieldCheck className="w-8 h-8 text-white" />
            }
          </div>
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-slate-800 text-center mb-1">
          {mode === 'setup' ? 'Thiết lập PIN' : 'Quản lý API Keys'}
        </h1>
        <p className="text-sm text-slate-500 text-center mb-6">
          {mode === 'setup'
            ? 'Tạo PIN 6 chữ số để bảo vệ trang này'
            : 'Nhập PIN 6 chữ số để tiếp tục'}
        </p>

        {/* Countdown khi bị khoá */}
        {isLocked && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-red-600 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-semibold">Tài khoản tạm thời bị khoá</span>
            </div>
            <div className="text-3xl font-bold text-red-500 font-mono">
              {formatTime(countdown)}
            </div>
            <p className="text-xs text-red-400 mt-1">Vui lòng thử lại sau</p>
          </div>
        )}

        {/* 6-digit PIN input */}
        {!isLocked && (
          <div className="flex gap-2 justify-center mb-4">
            {activeDigits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={d}
                disabled={loading}
                onChange={(e) => handleDigitChange(i, e.target.value, activeDigits, setActiveDigits)}
                onKeyDown={(e) => handleKeyDown(e, i, activeDigits, setActiveDigits)}
                onPaste={(e) => handlePaste(e, setActiveDigits)}
                className={`w-11 h-12 text-center text-xl font-bold border-2 rounded-xl outline-none transition-all
                  ${d ? 'border-slate-800 bg-slate-50' : 'border-slate-200'}
                  focus:border-slate-800 focus:ring-2 focus:ring-slate-200
                  disabled:opacity-50`}
              />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLocked && (
          <p className="text-sm text-red-500 text-center mb-3">{error}</p>
        )}

        {/* Submit button */}
        {!isLocked && (
          <button
            onClick={() => handleSubmit(pin)}
            disabled={pin.length < 6 || loading}
            className="w-full py-3 bg-slate-800 text-white font-semibold rounded-xl
              hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
            {mode === 'setup' ? 'Thiết lập PIN' : 'Xác nhận'}
          </button>
        )}

        {/* Remaining attempts info */}
        {status && !isLocked && mode === 'verify' && status.failCount > 0 && (
          <p className="text-xs text-slate-400 text-center mt-3">
            Đã sai {status.failCount} lần.{' '}
            {status.failCount < 5
              ? `Còn ${5 - status.failCount} lần trước khi bị khoá 30 giây.`
              : `Còn ${10 - status.failCount} lần trước khi bị khoá 5 phút.`}
          </p>
        )}
      </div>
    </div>
  );
}
