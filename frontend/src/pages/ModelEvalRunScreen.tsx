import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface CompletedJob {
  jobId: string;
  projectName: string;
  baseModel: string;
  hfRepoId: string;
  completedAt: string;
  status?: string;
  evalCount?: number;
  pinnedOverallPct?: number | null;
}

// Mỗi eval run đang chạy hoặc đã xong hôm nay
interface EvalRun {
  evalJobId: string;
  jobId: string;
  projectName: string;
  judgeModel: string;
  phase: EvalPhase;
  progress: { pct: number; stage_label: string; stage_detail: string; current: number; total: number; } | null;
  etaSeconds: number | null;
  logs: string[];
  errorMsg: string;
  doneEvalId: string | null;
  currentSample: { index: number; instruction: string; ft_answer: string | null; base_answer: string | null; } | null;
  // kết quả tóm tắt khi COMPLETED (từ SSE end event)
  overallFt?: number | null;
  deltaImprov?: number | null;
  completedAt?: string;
}

type EvalPhase = 'idle' | 'uploading' | 'running' | 'done' | 'error';

// Judge models cố định — thêm vào đây khi có model mới
const JUDGE_MODELS = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    note: 'Khuyên dùng',
    recommended: true,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    note: 'Chính xác cao, chậm hơn',
    recommended: false,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    note: 'Nhanh, chi phí thấp',
    recommended: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    note: 'Cân bằng tốc độ/chất lượng',
    recommended: false,
  },
];


const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: 'bg-amber-50 text-amber-700 border-amber-200',
  Google: 'bg-sky-50 text-sky-700 border-sky-200',
  OpenAI: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// ─── ETA: khởi tạo 340 + N×15.5s; mỗi giây -=1; SSE tính lại theo stage ───────────────

const SEC_INIT = 340;
const SEC_PER_SAMPLE_INIT = 15.5;
const SEC_AFTER_BASE_TAIL = 310 + 10; // 310s rubric + 10s finalize
const SEC_PER_SAMPLE_BASE = 13; // N×13s trong phase infer_ft
const SEC_RUBRIC = 310;
const SEC_FINALIZE = 10;

type EvalStageKey = 'infer_ft' | 'infer_base' | 'rubric' | 'finalize' | 'unknown';

function detectEvalStage(payload: Record<string, unknown>): EvalStageKey {
  const raw = String(payload.stage ?? payload.stage_label ?? '').toLowerCase();
  if (raw.includes('finalize') || raw.includes('tổng hợp')) return 'finalize';
  if (raw.includes('rubric') || raw.includes('hallucinat')) return 'rubric';
  if (raw.includes('infer_base') || (raw.includes('infer') && raw.includes('base'))) return 'infer_base';
  if (raw.includes('infer_ft') || (raw.includes('infer') && raw.includes('ft'))) return 'infer_ft';

  const sample = payload.current_sample as { ft_answer?: string | null; base_answer?: string | null } | undefined;
  if (sample) {
    if (sample.ft_answer == null && sample.base_answer == null) return 'infer_ft';
    if (sample.ft_answer != null && sample.base_answer == null) return 'infer_base';
  }
  return 'unknown';
}

/** ms: ưu tiên *_ms; field gốc: nếu > 1e4 coi là ms, ngược lại coi là giây (cho thời gian ngắn) */
function pickMsMs(payload: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'number' && isFinite(v) && v >= 0) {
      if (k.endsWith('_ms') || v > 1e4) return v;
      return v * 1000;
    }
  }
  return 0;
}

function pickRubricElapsedSec(payload: Record<string, unknown>): number {
  const ms = payload.elapsed_rubric_ms;
  if (typeof ms === 'number' && isFinite(ms) && ms >= 0) return ms / 1000;
  const s = payload.elapsed_rubric;
  if (typeof s === 'number' && isFinite(s) && s >= 0) return s;
  return 0;
}

/** 1-based: câu K/N — mặc định stage_current là 0-based; optional stage_current_1based */
function oneBasedKFromPayload(payload: Record<string, unknown>): number {
  const n = Number(payload.stage_total) || 0;
  const c = Number(payload.stage_current ?? 0);
  const oneBased = payload.stage_current_1based === true;
  const k1 = oneBased ? Math.max(1, c) : c + 1;
  return Math.max(1, n ? Math.min(n, k1) : k1);
}

/**
 * Trả về ETA còn lại (giây) hoặc null nếu không đủ dữ liệu.
 */
function computeEtaFromPayload(payload: Record<string, unknown>): number | null {
  const stage = detectEvalStage(payload);
  const N = Number(payload.stage_total) || 0;

  if (stage === 'finalize') return SEC_FINALIZE;

  if (stage === 'rubric') {
    const elapsedSec = pickRubricElapsedSec(payload);
    if (elapsedSec <= 0) return SEC_RUBRIC;
    return Math.max(0, SEC_RUBRIC - elapsedSec);
  }

  const K = oneBasedKFromPayload(payload);
  if (N <= 0) return null;

  if (stage === 'infer_ft') {
    const elapsedFt = pickMsMs(payload, ['elapsed_ft_ms', 'elapsed_ft']);
    if (elapsedFt <= 0) return null;
    const ftDoneMs = elapsedFt / K;
    const remainingMs =
      (N - K) * ftDoneMs + N * SEC_PER_SAMPLE_BASE * 1000 + SEC_AFTER_BASE_TAIL * 1000;
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  if (stage === 'infer_base') {
    const elapsedBase = pickMsMs(payload, ['elapsed_base_ms', 'elapsed_base']);
    if (elapsedBase <= 0) return null;
    const baseDoneMs = elapsedBase / K;
    const remainingMs = (N - K) * baseDoneMs + SEC_AFTER_BASE_TAIL * 1000;
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  return null;
}

function formatEtaCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// ── RunCard: hiển thị 1 eval run (active hoặc done/error) ────────────────────
const RunCard: React.FC<{
  run: EvalRun;
  expanded: boolean;
  expandedTab: 'log' | 'preview';
  logEndRef: React.RefObject<HTMLDivElement>;
  onToggle: () => void;
  onTabChange: (tab: 'log' | 'preview') => void;
  onNavigate: (path: string) => void;
}> = ({ run, expanded, expandedTab, logEndRef, onToggle, onTabChange, onNavigate }) => {
  const isActive = run.phase === 'running' || run.phase === 'uploading';

  const badgeClass = {
    uploading: 'bg-amber-50 text-amber-700 border border-amber-200',
    running: 'bg-blue-50 text-blue-700 border border-blue-200',
    done: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    error: 'bg-red-50 text-red-700 border border-red-200',
    idle: '',
  }[run.phase];

  const badgeLabel = {
    uploading: 'Uploading', running: 'Running',
    done: 'Completed', error: 'Failed', idle: '',
  }[run.phase];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Status indicator */}
        {run.phase === 'running' && (
          <div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin shrink-0" />
        )}
        {run.phase === 'done' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />}
        {run.phase === 'error' && <div className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />}
        {run.phase === 'uploading' && <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">{run.projectName}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}>{badgeLabel}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {run.judgeModel}
            {run.phase === 'running' && run.progress && run.progress.total > 0 && (
              <> · {run.progress.stage_label} · {run.progress.current}/{run.progress.total} mẫu</>
            )}
            {run.phase === 'done' && run.completedAt && <> · Hoàn thành lúc {run.completedAt}</>}
            {run.phase === 'error' && <> · <span className="text-red-400">{run.errorMsg}</span></>}
          </div>
        </div>

        {/* ETA / action */}
        <div className="flex items-center gap-2 shrink-0">
          {run.phase === 'running' && run.etaSeconds != null && (
            <span className="text-xs font-mono text-slate-500">~{formatEtaCountdown(run.etaSeconds)}</span>
          )}
          {run.phase === 'done' && run.doneEvalId && (
            <button onClick={() => onNavigate(`/model-eval/${run.doneEvalId}`)}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 border border-slate-200 px-2.5 py-1 rounded-lg transition">
              Xem kết quả
            </button>
          )}
          <button onClick={onToggle}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar (active only, always visible) */}
      {isActive && (
        <div className="px-4 pb-3">
          {/* Stage steps */}
          <div className="flex gap-1 mb-2">
            {Object.entries({ 'Khởi động': 5, 'Inference FT': 35, 'Inference Base': 60, 'Chấm điểm': 85, 'Tổng hợp': 98 })
              .map(([label, threshold]) => {
                const pct = run.progress?.pct ?? 0;
                const done = pct >= threshold;
                const active = pct >= threshold - 25 && pct < threshold;
                return (
                  <div key={label} className="flex-1">
                    <div className={`h-0.5 rounded-full mb-1 transition-all duration-500 ${done ? 'bg-emerald-400' : active ? 'bg-blue-400' : 'bg-slate-200'}`} />
                    <p className={`text-[9px] text-center truncate ${done ? 'text-emerald-600' : active ? 'text-blue-500' : 'text-slate-300'}`}>{label}</p>
                  </div>
                );
              })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-slate-700 rounded-full transition-all duration-500" style={{ width: `${run.progress?.pct ?? 0}%` }} />
            </div>
            <span className="text-[10px] font-mono text-slate-400 shrink-0">{run.progress?.pct ?? 0}%</span>
          </div>
        </div>
      )}

      {/* Expanded: Log + Preview */}
      {expanded && (
        <div className="border-t border-slate-100">
          <div className="flex border-b border-slate-100">
            {(['log', 'preview'] as const).map(tab => (
              <button key={tab} onClick={() => onTabChange(tab)}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${expandedTab === tab ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {tab === 'log' ? 'Terminal Log' : 'Inference Preview'}
                {tab === 'preview' && run.currentSample !== null && (
                  <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold">LIVE</span>
                )}
              </button>
            ))}
          </div>

          {expandedTab === 'log' && (
            <div className="bg-slate-900 p-4 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {run.logs.length === 0
                ? <p className="text-slate-500">Chờ log từ GPU service...</p>
                : run.logs.map((log, i) => (
                  <p key={i} className={
                    log.includes('✅') || log.includes('🎉') ? 'text-emerald-400' :
                      log.includes('❌') || log.includes('LỖI') ? 'text-red-400' :
                        log.includes('⚡') || log.includes('📊') || log.includes('📐') ? 'text-blue-400' :
                          log.includes('⚙️') ? 'text-amber-400' : 'text-slate-300'
                  }>{log}</p>
                ))}
              <div ref={logEndRef} />
            </div>
          )}

          {expandedTab === 'preview' && (
            <div className="p-4 h-48 overflow-y-auto">
              {run.currentSample === null ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                  <svg className="w-7 h-7 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <p className="text-xs">Chờ inference bắt đầu...</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Câu #{run.currentSample.index + 1}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${run.currentSample.base_answer !== null ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {run.currentSample.base_answer !== null ? 'FT + Base ✓' : 'FT only — Base đang chạy...'}
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Câu hỏi</p>
                    <p className="text-xs text-slate-800 leading-relaxed">{run.currentSample.instruction}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-purple-50 rounded-lg p-2.5 border border-purple-100">
                      <p className="text-[10px] uppercase font-bold text-purple-500 mb-1">FT Answer</p>
                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">{run.currentSample.ft_answer ?? '—'}</p>
                    </div>
                    <div className={`rounded-lg p-2.5 border ${run.currentSample.base_answer !== null ? 'bg-slate-50 border-slate-200' : 'bg-slate-50 border-dashed border-slate-200'}`}>
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Base Answer</p>
                      {run.currentSample.base_answer !== null
                        ? <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{run.currentSample.base_answer}</p>
                        : <p className="text-xs text-slate-400 animate-pulse">Đang chạy...</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ModelEvalRunScreen: React.FC = () => {
  const navigate = useNavigate();

  // ── Jobs list (cho form chọn model) ──────────────────────────────────
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // ── Dashboard: danh sách runs ─────────────────────────────────────────
  const [runs, setRuns] = useState<EvalRun[]>([]);
  // evalJobId của run đang expand (hiện log + preview)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<'log' | 'preview'>('log');

  // ── Modal tạo eval mới ────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [judgeModel, setJudgeModel] = useState<string>(JUDGE_MODELS[0].id);
  const [jobSearch, setJobSearch] = useState<string>('');
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // SSE refs: evalJobId → EventSource
  const sseMapRef = useRef<Map<string, EventSource>>(new Map());
  // ETA refs: evalJobId → { seconds, lastStage }
  const etaMapRef = useRef<Map<string, { seconds: number | null; lastStage: EvalStageKey }>>(new Map());

  // ── Fetch jobs list ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/train/history?status=COMPLETED')
      .then(r => r.json())
      .then((data: CompletedJob[]) => {
        const completedWithRepo = data.filter(j =>
          j.hfRepoId && (!j.status || j.status.toUpperCase() === 'COMPLETED')
        );
        setJobs(completedWithRepo);
        setLoadingJobs(false);
      })
      .catch(() => setLoadingJobs(false));
  }, []);

  // ── Auto-scroll log ───────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runs, expandedRunId]);

  // ── ETA countdown: 1 interval dùng chung, tick mỗi giây ──────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      setRuns(prev => prev.map(run => {
        if (run.phase !== 'running') return run;
        const eta = etaMapRef.current.get(run.evalJobId);
        if (!eta || eta.seconds === null) return run;
        const next = eta.seconds > 0 ? eta.seconds - 1 : 0;
        eta.seconds = next;
        return { ...run, etaSeconds: next };
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Cleanup all SSE on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      sseMapRef.current.forEach(es => es.close());
    };
  }, []);

  // ── Reconnect từ sessionStorage khi mount ────────────────────────────
  useEffect(() => {
    const stored = sessionStorage.getItem('active_eval_runs');
    if (!stored) return;
    try {
      const saved: Array<{ evalJobId: string; jobId: string; projectName: string; judgeModel: string }> = JSON.parse(stored);
      saved.forEach(s => {
        const run: EvalRun = {
          evalJobId: s.evalJobId, jobId: s.jobId,
          projectName: s.projectName, judgeModel: s.judgeModel,
          phase: 'running', progress: null, etaSeconds: null,
          logs: [`[🔄] Khôi phục kết nối: ${s.evalJobId}`],
          errorMsg: '', doneEvalId: null, currentSample: null,
        };
        setRuns(prev => [...prev, run]);
        connectSSE(s.evalJobId);
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Lưu active runs vào sessionStorage mỗi khi runs thay đổi ─────────
  useEffect(() => {
    const active = runs
      .filter(r => r.phase === 'running' || r.phase === 'uploading')
      .map(r => ({ evalJobId: r.evalJobId, jobId: r.jobId, projectName: r.projectName, judgeModel: r.judgeModel }));
    if (active.length > 0) {
      sessionStorage.setItem('active_eval_runs', JSON.stringify(active));
    } else {
      sessionStorage.removeItem('active_eval_runs');
    }
  }, [runs]);

  // ── Helper: update 1 run trong list ──────────────────────────────────
  const updateRun = (evalJobId: string, patch: Partial<EvalRun>) => {
    setRuns(prev => prev.map(r => r.evalJobId === evalJobId ? { ...r, ...patch } : r));
  };

  // ── connectSSE: kết nối SSE cho 1 eval run ───────────────────────────
  const connectSSE = (evalJobId: string) => {
    if (sseMapRef.current.has(evalJobId)) return; // đã có rồi
    etaMapRef.current.set(evalJobId, { seconds: null, lastStage: 'unknown' });

    const es = new EventSource(`/api/model-eval/stream/${evalJobId}`);
    sseMapRef.current.set(evalJobId, es);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        const p = payload as Record<string, unknown>;

        const progressPatch = typeof payload.progress === 'number' ? {
          progress: {
            pct: payload.progress,
            stage_label: payload.stage_label || '',
            stage_detail: payload.stage_detail || '',
            current: payload.stage_current || 0,
            total: payload.stage_total || 0,
          }
        } : {};

        // ETA
        const eta = etaMapRef.current.get(evalJobId)!;
        const currentStage = detectEvalStage(p);
        const etaRecalc = computeEtaFromPayload(p);
        if (etaRecalc !== null) {
          const isTransition = currentStage !== 'unknown' && currentStage !== eta.lastStage;
          if (isTransition) { eta.seconds = etaRecalc; eta.lastStage = currentStage; }
          else if (eta.seconds === null) { eta.seconds = etaRecalc; }
          else if (etaRecalc < eta.seconds) { eta.seconds = etaRecalc; }
        } else if (typeof p.stage_total === 'number' && p.stage_total > 0 && eta.seconds === null) {
          eta.seconds = SEC_INIT + p.stage_total * SEC_PER_SAMPLE_INIT;
        }
        if (currentStage !== 'unknown') eta.lastStage = currentStage;

        updateRun(evalJobId, {
          ...progressPatch,
          etaSeconds: eta.seconds,
          ...(payload.logs?.length ? {
            logs: (() => {
              let updated: string[] = [];
              setRuns(prev => {
                const run = prev.find(r => r.evalJobId === evalJobId);
                const existing = run?.logs ?? [];
                const newLogs = payload.logs.filter((l: string) => !existing.includes(l));
                updated = [...existing, ...newLogs];
                return prev;
              });
              return updated;
            })()
          } : {}),
          ...(payload.current_sample ? { currentSample: payload.current_sample } : {}),
        });

        // logs cần update riêng để tránh closure stale
        if (payload.logs?.length) {
          setRuns(prev => prev.map(r => {
            if (r.evalJobId !== evalJobId) return r;
            const newLogs = payload.logs.filter((l: string) => !r.logs.includes(l));
            return newLogs.length ? { ...r, logs: [...r.logs, ...newLogs] } : r;
          }));
        }
      } catch { /* ignore */ }
    };

    es.addEventListener('end', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.status === 'COMPLETED') {
          updateRun(evalJobId, {
            phase: 'done',
            doneEvalId: evalJobId,
            logs: (() => { let l: string[] = []; setRuns(prev => { l = [...(prev.find(r => r.evalJobId === evalJobId)?.logs ?? []), '[🎉] Đánh giá hoàn tất!']; return prev; }); return l; })(),
          });
          setRuns(prev => prev.map(r => r.evalJobId === evalJobId
            ? {
              ...r, phase: 'done', doneEvalId: evalJobId, logs: [...r.logs, '[🎉] Đánh giá hoàn tất!'],
              completedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            }
            : r
          ));
        } else {
          updateRun(evalJobId, { phase: 'error', errorMsg: payload.error || 'Eval thất bại' });
        }
      } catch { /* ignore */ }
      es.close();
      sseMapRef.current.delete(evalJobId);
    });

    es.addEventListener('error', (e) => {
      try { updateRun(evalJobId, { phase: 'error', errorMsg: JSON.parse((e as MessageEvent).data).error || 'Lỗi kết nối' }); } catch {
        updateRun(evalJobId, { phase: 'error', errorMsg: 'Lỗi kết nối SSE' });
      }
      es.close();
      sseMapRef.current.delete(evalJobId);
    });
  };

  // ── Validate file ─────────────────────────────────────────────────────
  const validateAndSetFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['json', 'jsonl'].includes(ext ?? '')) {
      setSubmitError('Chỉ chấp nhận file .json hoặc .jsonl');
      return;
    }
    setEvalFile(file);
    setSubmitError('');
  };

  // ── Submit eval mới ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedJobId || !evalFile) return;
    setSubmitPhase('uploading');
    setSubmitError('');

    try {
      const formData = new FormData();
      formData.append('eval_file', evalFile);
      formData.append('judge_model', judgeModel);

      const res = await fetch(`/api/model-eval/run/${selectedJobId}`, { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setSubmitPhase('error');
        if (res.status === 503 && data.error === 'worker_busy') {
          setSubmitError('Tất cả workers đang bận. Vui lòng thử lại sau ít phút.');
        } else {
          setSubmitError(data.error || 'Không thể bắt đầu đánh giá');
        }
        return;
      }

      const newEvalJobId: string = data.eval_job_id;
      const selectedJob = jobs.find(j => j.jobId === selectedJobId);
      const newRun: EvalRun = {
        evalJobId: newEvalJobId,
        jobId: selectedJobId,
        projectName: selectedJob?.projectName ?? selectedJobId,
        judgeModel,
        phase: 'running',
        progress: null,
        etaSeconds: null,
        logs: [`[✅] Eval job bắt đầu: ${newEvalJobId}`],
        errorMsg: '',
        doneEvalId: null,
        currentSample: null,
      };

      setRuns(prev => [newRun, ...prev]);
      connectSSE(newEvalJobId);
      setExpandedRunId(newEvalJobId);

      // Reset modal
      setShowModal(false);
      setSubmitPhase('idle');
      setSelectedJobId('');
      setEvalFile(null);
      setJobSearch('');
    } catch (err: any) {
      setSubmitPhase('error');
      setSubmitError(err.message || 'Lỗi không xác định');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const activeRuns = runs.filter(r => r.phase === 'running' || r.phase === 'uploading');
  const todayRuns = runs.filter(r => r.phase === 'done' || r.phase === 'error');
  const selectedJob = jobs.find(j => j.jobId === selectedJobId);
  const filteredJobs = jobs.filter(j => {
    const q = jobSearch.toLowerCase();
    return j.projectName.toLowerCase().includes(q) || j.baseModel.toLowerCase().includes(q) || j.hfRepoId.toLowerCase().includes(q);
  });
  const canSubmit = !!selectedJobId && !!evalFile && !!judgeModel && submitPhase === 'idle';
  const workerCount = Math.min(activeRuns.length, 3);
  const maxEta = activeRuns.reduce((max, r) => Math.max(max, r.etaSeconds ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/model-eval/leaderboard')} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Đánh giá model</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeRuns.length > 0
                  ? `${activeRuns.length} đang chạy · ${3 - activeRuns.length} slot trống`
                  : 'Chưa có eval nào đang chạy'}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setShowModal(true); setSubmitPhase('idle'); setSubmitError(''); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-800 text-white hover:bg-slate-700 transition shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo eval mới
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Workers</p>
            <p className="text-2xl font-bold text-slate-800">{workerCount} <span className="text-slate-300 font-normal text-base">/ 3</span></p>
            <div className="flex gap-1.5 mt-2">
              {[0, 1, 2].map(i => (
                <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < activeRuns.length ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Đang chạy</p>
            <p className="text-2xl font-bold text-slate-800">{activeRuns.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              {maxEta > 0 ? `còn ~${formatEtaCountdown(maxEta)}` : activeRuns.length > 0 ? 'Đang khởi động...' : '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Hôm nay</p>
            <p className="text-2xl font-bold text-slate-800">{runs.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">{todayRuns.filter(r => r.phase === 'done').length} completed</p>
          </div>
        </div>

        {/* Active runs */}
        {activeRuns.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Đang chạy</p>
            <div className="space-y-3">
              {activeRuns.map(run => (
                <RunCard
                  key={run.evalJobId}
                  run={run}
                  expanded={expandedRunId === run.evalJobId}
                  expandedTab={expandedTab}
                  logEndRef={logEndRef}
                  onToggle={() => setExpandedRunId(prev => prev === run.evalJobId ? null : run.evalJobId)}
                  onTabChange={setExpandedTab}
                  onNavigate={navigate}
                />
              ))}
            </div>
          </div>
        )}

        {/* Today runs */}
        {todayRuns.length > 0 && (
          <div>
            <div className="border-t border-slate-200 pt-6">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Hôm nay</p>
              <div className="space-y-2">
                {todayRuns.map(run => (
                  <RunCard
                    key={run.evalJobId}
                    run={run}
                    expanded={expandedRunId === run.evalJobId}
                    expandedTab={expandedTab}
                    logEndRef={logEndRef}
                    onToggle={() => setExpandedRunId(prev => prev === run.evalJobId ? null : run.evalJobId)}
                    onTabChange={setExpandedTab}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {runs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <svg className="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-sm">Chưa có eval nào. Bấm "Tạo eval mới" để bắt đầu.</p>
          </div>
        )}
      </div>

      {/* Modal tạo eval mới */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">Tạo eval mới</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Step 1 + Step 2 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Step 1 — Fine-tuned model */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                  <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                      <h2 className="text-sm font-bold text-slate-800">Model cần đánh giá</h2>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 ml-7">Chọn job đã fine-tune có trạng thái COMPLETED</p>
                  </div>
                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <input type="text" placeholder="Tìm project, base model, HF repo..."
                        value={jobSearch} onChange={e => setJobSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 transition bg-slate-50" />
                      {jobSearch && (
                        <button onClick={() => setJobSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-52 px-3 py-2">
                    {loadingJobs ? (
                      <div className="flex items-center justify-center py-6 gap-2 text-xs text-slate-400">
                        <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />Đang tải...
                      </div>
                    ) : filteredJobs.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">
                        {jobs.length === 0 ? 'Chưa có model COMPLETED nào có HF Repo.' : 'Không tìm thấy kết quả.'}
                      </div>
                    ) : filteredJobs.map(job => (
                      <button key={job.jobId} onClick={() => setSelectedJobId(job.jobId)}
                        className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition ${selectedJobId === job.jobId ? 'bg-slate-800' : 'hover:bg-slate-50'}`}>
                        <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${selectedJobId === job.jobId ? 'border-white' : 'border-slate-300'}`}>
                          {selectedJobId === job.jobId && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold truncate ${selectedJobId === job.jobId ? 'text-white' : 'text-slate-800'}`}>{job.projectName}</div>
                          <div className={`text-[10px] mt-0.5 ${selectedJobId === job.jobId ? 'text-slate-400' : 'text-slate-400'}`}>
                            {job.baseModel.split('/').pop()} · {new Date(job.completedAt).toLocaleDateString('vi-VN')}
                          </div>
                        </div>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${selectedJobId === job.jobId ? 'bg-slate-700 border-slate-600 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                          {job.hfRepoId.split('/').pop()}
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedJob && (
                    <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                      <p className="text-[10px] text-slate-500">Đã chọn: <span className="font-semibold text-slate-700">{selectedJob.projectName}</span></p>
                    </div>
                  )}
                </div>

                {/* Step 2 — Judge model */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                  <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                      <h2 className="text-sm font-bold text-slate-800">Model chấm điểm</h2>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 ml-7">AI model dùng để đánh giá chất lượng câu trả lời</p>
                  </div>
                  <div className="px-4 py-4 space-y-2 flex-1">
                    {JUDGE_MODELS.map(m => (
                      <button key={m.id} onClick={() => setJudgeModel(m.id)}
                        className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition ${judgeModel === m.id ? 'border-slate-800 bg-slate-800' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                        <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${judgeModel === m.id ? 'border-white' : 'border-slate-300'}`}>
                          {judgeModel === m.id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold flex items-center gap-2 ${judgeModel === m.id ? 'text-white' : 'text-slate-800'}`}>
                            {m.name}
                            {m.recommended && <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded">★ Khuyên dùng</span>}
                          </div>
                          <div className={`text-[10px] mt-0.5 ${judgeModel === m.id ? 'text-slate-400' : 'text-slate-400'}`}>{m.note}</div>
                        </div>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${judgeModel === m.id ? 'bg-slate-700 border-slate-600 text-slate-300' : PROVIDER_COLORS[m.provider]}`}>
                          {m.provider}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step 3 — Upload file */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                  <h2 className="text-sm font-bold text-slate-800">Upload file đánh giá</h2>
                  <span className="text-[11px] text-slate-400">— .json hoặc .jsonl</span>
                </div>
                <div
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) validateAndSetFile(f); }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-6 text-center cursor-pointer transition ${dragOver ? 'border-slate-500 bg-slate-50' : evalFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-400'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".json,.jsonl" className="hidden"
                    onChange={e => e.target.files?.[0] && validateAndSetFile(e.target.files[0])} />
                  {evalFile ? (
                    <div className="flex items-center justify-center gap-4">
                      <svg className="w-6 h-6 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-slate-700">{evalFile.name}</p>
                        <p className="text-xs text-slate-400">{(evalFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setEvalFile(null); }}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-1 rounded-lg">Xóa</button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-slate-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-sm font-medium">Kéo thả hoặc click để chọn file</p>
                      <p className="text-xs">.json / .jsonl · tối đa 50MB</p>
                    </div>
                  )}
                </div>
                {submitError && <p className="mt-2 text-xs text-red-500 font-medium">{submitError}</p>}
              </div>

              {/* Submit row */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="text-xs text-slate-400">
                  {activeRuns.length >= 3
                    ? <span className="text-amber-600 font-medium">Đã đạt giới hạn 3 workers đồng thời</span>
                    : `${3 - activeRuns.length} slot còn trống`}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || activeRuns.length >= 3}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {submitPhase === 'uploading' && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                    {submitPhase === 'uploading' ? 'Đang gửi...' : 'Bắt đầu đánh giá'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};