import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConvResult {
  conv_index: number;
  num_turns: number;
  avg_latency_ms: number;
  criteria_scores: Record<string, number>;
  criteria_reasons: Record<string, string>;
  group_scores: {
    group_a: number; group_b: number; group_c: number; group_d: number;
    overall: number; a1_hard_constraint_triggered: boolean;
  };
  non_scoring: { bleu: number; rouge_l: number; question_detection_rate: number };
}

interface EvaluationData {
  modelEvalId: string;
  jobId: string;
  projectName?: string;
  isPinned?: boolean;
  status: string;
  totalConversations: number;
  validConversations: number;
  judgeModel?: string;
  results: ConvResult[];
  summary: {
    overall: number;
    group_a: number;
    group_b: number;
    group_c: number;
    group_d: number;
    criteria: Record<string, number>;
    avg_latency_ms: number;
    non_scoring: { bleu: number; rouge_l: number; question_detection_rate: number };
    max_possible: number;
  };
  startedAt: string;
  completedAt: string;
}

type SortKey = 'index' | 'overall' | 'group_a' | 'group_b' | 'latency';
type SortDir = 'asc' | 'desc';

// ─── Metadata về các tiêu chí (A1–D2) ───────────────────────────────────────

const CRITERIA_META: Record<string, { group: string; name: string; desc: string; weight: string }> = {
  A1: { group: 'A', name: 'Answer Withholding', weight: '50% nhóm A',
        desc: 'Model có tự đưa ra đáp án cuối cùng không. Hard constraint: nếu A1=0, toàn nhóm A bị giới hạn ở 1.0.' },
  A2: { group: 'A', name: 'Scaffolding Quality', weight: '30% nhóm A',
        desc: 'Câu hỏi gợi mở có đủ cụ thể để học sinh biết suy nghĩ tiếp không, có theo đúng flow bài học không.' },
  A3: { group: 'A', name: 'Adaptive Response', weight: '20% nhóm A',
        desc: 'Model phản ứng đúng với từng kiểu input: đúng→khen; sai→gợi ý; lạc đề→redirect; mơ hồ→làm rõ.' },
  B1: { group: 'B', name: 'Factual Accuracy', weight: '60% nhóm B',
        desc: 'Kiến thức được trình bày trong các turn có chính xác không — đặc biệt lý thuyết đầu hội thoại.' },
  B2: { group: 'B', name: 'Grade-level', weight: '40% nhóm B',
        desc: 'Ngôn ngữ, ví dụ, và độ phức tạp có phù hợp với học sinh cấp 2-3 không.' },
  C1: { group: 'C', name: 'Robustness', weight: '40% nhóm C',
        desc: 'Khi học sinh gửi input mơ hồ/off-topic, model xử lý mượt và redirect tự nhiên về bài học.' },
  C2: { group: 'C', name: 'Coherence', weight: '40% nhóm C',
        desc: 'Các turn sau có nhớ và kế thừa context các turn trước không; flow hội thoại có tự nhiên không.' },
  C3: { group: 'C', name: 'Tone & Encouragement', weight: '20% nhóm C',
        desc: 'Giọng điệu ấm áp, khích lệ, không phán xét khi học sinh sai — phù hợp lứa tuổi.' },
  D1: { group: 'D', name: 'Hallucination', weight: '50% nhóm D',
        desc: 'Không bịa context bài học, không bịa lịch sử hội thoại, không bịa câu trả lời của học sinh.' },
  D2: { group: 'D', name: 'Speed (Latency)', weight: '50% nhóm D',
        desc: 'Latency trung bình mỗi turn: ≤2s=5đ, ≤4s=4đ, ≤7s=3đ, ≤12s=2đ, >12s=1đ.' },
};

const GROUP_META = {
  A: { label: 'A · Socratic Compliance', weight: '40%', color: 'indigo', text: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  B: { label: 'B · Độ chính xác', weight: '25%', color: 'orange', text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  C: { label: 'C · Chất lượng sư phạm', weight: '25%', color: 'teal', text: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200' },
  D: { label: 'D · Hallucination + Tốc độ', weight: '10%', color: 'sky', text: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
};

// ─── HoverTooltip ─────────────────────────────────────────────────────────────

function HoverTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const wrap = wrapRef.current; const tip = tipRef.current;
    if (!wrap || !tip) return;
    const r = wrap.getBoundingClientRect();
    const { height: th, width: tw } = tip.getBoundingClientRect();
    const pad = 8; const gap = 6; const vw = window.innerWidth; const vh = window.innerHeight;
    const top = r.top - th - gap < pad ? r.bottom + gap : r.top - th - gap;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, vw - tw - pad));
    setPos({ top: Math.max(pad, Math.min(top, vh - th - pad)), left });
  }, []);

  useLayoutEffect(() => {
    if (!show) { setPos(null); return; }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [show, reposition]);

  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-1" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && typeof document !== 'undefined' && createPortal(
        <div ref={tipRef} className="fixed z-[100] w-[min(18rem,calc(100vw-16px))] bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}>
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 transition cursor-help shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const r = 28; const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const colorMap: Record<string, string> = {
    purple: '#7C3AED', indigo: '#4F46E5', orange: '#EA580C', teal: '#0F766E', sky: '#0284C7',
  };
  const stroke = colorMap[color] ?? '#7C3AED';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#E2E8F0" strokeWidth="6" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="6"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-800">{value.toFixed(2)}</span>
        </div>
      </div>
      <span className="text-[10px] font-semibold text-slate-500 text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Criteria Score Row (trong bảng per-conv expandable) ──────────────────────

function CriteriaRow({ code, score, reason }: { code: string; score: number; reason: string }) {
  const meta = CRITERIA_META[code];
  const gKey = code[0] as keyof typeof GROUP_META;
  const gm = GROUP_META[gKey] ?? GROUP_META.A;
  const barPct = (score / 5) * 100;
  const barColor = score >= 4 ? 'bg-emerald-400' : score >= 2.5 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
      <HoverTooltip text={`${meta?.name ?? code} (${meta?.weight ?? ''}) — ${meta?.desc ?? ''}`}>
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${gm.bg} ${gm.text} ${gm.border} border cursor-help`}>{code}</span>
      </HoverTooltip>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
          </div>
          <span className="text-xs font-bold text-slate-700 tabular-nums w-6 text-right">{score}</span>
        </div>
        {reason && <p className="text-[10px] text-slate-500 leading-relaxed truncate" title={reason}>{reason}</p>}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export const ModelEvalResultScreen: React.FC = () => {
  const { evalId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [tablePage, setTablePage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    if (!evalId) return;
    fetch(`/api/model-eval/${evalId}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [evalId]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <svg className="w-8 h-8 animate-spin text-indigo-500 mb-3" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm text-slate-500">Đang tải kết quả…</p>
    </div>
  );

  if (!data) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <p className="text-slate-500 font-medium">Không tìm thấy kết quả đánh giá</p>
      <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl text-sm hover:bg-slate-700 transition">Quay lại</button>
    </div>
  );

  const max = data.summary.max_possible;
  const judgeLabel = data.judgeModel
    ? (data.judgeModel.includes('sonnet') ? 'Sonnet' : data.judgeModel.includes('haiku') ? 'Haiku' : data.judgeModel.includes('opus') ? 'Opus' : data.judgeModel)
    : null;

  // Radar data
  const radarData = [
    { axis: 'Socratic',  value: data.summary.group_a, fullMark: max },
    { axis: 'Accuracy',  value: data.summary.group_b, fullMark: max },
    { axis: 'Pedagogy',  value: data.summary.group_c, fullMark: max },
    { axis: 'Hall+Speed',value: data.summary.group_d, fullMark: max },
  ];

  // Criteria bar chart — map code → friendly label
  const criteriaChartData = Object.entries(data.summary.criteria ?? {}).map(([k, v]) => ({
    name: k,
    fullName: CRITERIA_META[k]?.name ?? k,
    score: parseFloat(v.toFixed(2)),
    pct: parseFloat(((v / max) * 100).toFixed(1)),
  }));

  // Sorted table
  const indexed = data.results.map((r, i) => ({ ...r, _origIdx: i }));
  const sorted = [...indexed].sort((a, b) => {
    let v = 0;
    if (sortKey === 'overall')  v = (a.group_scores?.overall ?? 0) - (b.group_scores?.overall ?? 0);
    else if (sortKey === 'group_a') v = (a.group_scores?.group_a ?? 0) - (b.group_scores?.group_a ?? 0);
    else if (sortKey === 'group_b') v = (a.group_scores?.group_b ?? 0) - (b.group_scores?.group_b ?? 0);
    else if (sortKey === 'latency') v = (a.avg_latency_ms ?? 0) - (b.avg_latency_ms ?? 0);
    else v = a._origIdx - b._origIdx;
    return sortDir === 'asc' ? v : -v;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setTablePage(1);
  };
  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 text-[10px] opacity-50">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  );

  // A1 hard constraint triggered count
  const constraintCount = data.results.filter(r => r.group_scores?.a1_hard_constraint_triggered).length;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">

      {/* ── Sticky header ── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <nav className="flex items-center gap-1 text-xs text-slate-400">
                <button onClick={() => navigate('/model-eval/leaderboard')} className="hover:text-slate-700 transition">Leaderboard</button>
                <span>/</span>
                <button onClick={() => navigate(`/model-eval/history/${data.jobId}`)} className="hover:text-slate-700 transition font-mono">{data.jobId.slice(0, 8)}…</button>
                <span>/</span>
                <span className="text-slate-600 font-medium">Kết quả</span>
              </nav>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-700">{data.projectName ?? `Job ${data.jobId.slice(0, 8)}`}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-400">{new Date(data.completedAt).toLocaleString('vi-VN')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.isPinned && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded-full">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17a1 1 0 11-2 0V5.477L6.237 7.082l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z"/></svg>
                Official
              </span>
            )}
            {judgeLabel && (
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full border border-slate-200">
                Judge: {judgeLabel}
              </span>
            )}
            <button onClick={() => navigate(`/model-eval/history/${data.jobId}`)} className="text-xs font-semibold text-blue-600 hover:underline transition">
              Tất cả runs →
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* ═══════════════════════════════════════════════════════
            ZONE 1 — Tổng quan điểm số
        ═══════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-slate-700">Tổng quan điểm số</h2>
            <span className="text-[11px] text-slate-400">— thang 0–{max}, đánh giá {data.totalConversations} conversations</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Overall ring + radar */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center gap-4">
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Overall Score</div>
                <ScoreRing value={data.summary.overall} max={max} label="Overall" color="purple" />
                <p className="text-[11px] text-slate-500 mt-2 max-w-[160px] text-center leading-relaxed">
                  Tổng hợp từ 4 nhóm A·B·C·D theo trọng số
                </p>
              </div>
              {constraintCount > 0 && (
                <div className="w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-center">
                  <p className="text-[10px] text-red-700 font-semibold">
                    ⚠ {constraintCount} conversation vi phạm A1=0 (hard constraint)
                  </p>
                  <p className="text-[10px] text-red-500 mt-0.5">Nhóm A bị giới hạn ở 1.0 trong {constraintCount} trường hợp</p>
                </div>
              )}
              {/* 4 rings nhóm */}
              <div className="grid grid-cols-2 gap-3 w-full">
                {[
                  { key: 'group_a', val: data.summary.group_a, label: 'A · Socratic', color: 'indigo' },
                  { key: 'group_b', val: data.summary.group_b, label: 'B · Accuracy', color: 'orange' },
                  { key: 'group_c', val: data.summary.group_c, label: 'C · Pedagogy', color: 'teal' },
                  { key: 'group_d', val: data.summary.group_d, label: 'D · Hall+Spd', color: 'sky' },
                ].map(g => (
                  <ScoreRing key={g.key} value={g.val} max={max} label={g.label} color={g.color} />
                ))}
              </div>
            </div>

            {/* Radar chart */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Radar — 4 nhóm tiêu chí</div>
              <p className="text-[10px] text-slate-400 mb-3">Mỗi trục là điểm trung bình của 1 nhóm tiêu chí</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="70%">
                    <PolarGrid stroke="#E2E8F0" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <PolarRadiusAxis domain={[0, max]} tick={{ fontSize: 9 }} />
                    <Radar dataKey="value" stroke="#6366F1" fill="#6366F1" fillOpacity={0.2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Stats bên phải */}
            <div className="space-y-3">
              {/* Latency */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Latency trung bình / turn</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-800">{data.summary.avg_latency_ms?.toFixed(0) ?? '—'}</span>
                  <span className="text-sm text-slate-400">ms</span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${(data.summary.avg_latency_ms ?? 0) <= 2000 ? 'bg-emerald-400' : (data.summary.avg_latency_ms ?? 0) <= 7000 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(((data.summary.avg_latency_ms ?? 0) / 15000) * 100, 100)}%` }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  {(data.summary.avg_latency_ms ?? 0) <= 2000 ? '≤2s — 5đ (tốt nhất)' :
                   (data.summary.avg_latency_ms ?? 0) <= 4000 ? '2–4s — 4đ' :
                   (data.summary.avg_latency_ms ?? 0) <= 7000 ? '4–7s — 3đ' :
                   (data.summary.avg_latency_ms ?? 0) <= 12000 ? '7–12s — 2đ' : '>12s — 1đ'}
                </p>
              </div>

              {/* Non-scoring metrics */}
              {data.summary.non_scoring && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Metric tham chiếu</div>
                  <p className="text-[10px] text-slate-400 italic mb-3">Không tính vào điểm — chỉ để theo dõi xu hướng</p>
                  <div className="space-y-2">
                    {[
                      { label: 'BLEU-4', val: data.summary.non_scoring.bleu, note: 'n-gram overlap (thấp với tiếng Việt là bình thường)' },
                      { label: 'ROUGE-L', val: data.summary.non_scoring.rouge_l, note: 'Longest common subsequence' },
                      { label: 'Question Rate', val: data.summary.non_scoring.question_detection_rate, note: '% turn kết thúc bằng câu hỏi' },
                    ].map(m => (
                      <div key={m.label}>
                        <div className="flex items-center justify-between mb-0.5">
                          <HoverTooltip text={m.note}>
                            <span className="text-[11px] text-slate-600 flex items-center gap-1 cursor-help">{m.label} <InfoIcon /></span>
                          </HoverTooltip>
                          <span className="text-[11px] font-semibold tabular-nums text-slate-700">{m.val.toFixed(3)}</span>
                        </div>
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-400 rounded-full" style={{ width: `${Math.min(m.val * 100, 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            ZONE 2 — Chi tiết 9 tiêu chí
        ═══════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-slate-700">Chi tiết 9 tiêu chí (A1–D1)</h2>
            <span className="text-[11px] text-slate-400">— điểm trung bình trên tất cả conversations</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-4">
            Hover vào badge tiêu chí để xem mô tả. Thanh màu phản ánh mức độ: <span className="text-emerald-600 font-semibold">xanh ≥4</span>, <span className="text-amber-600 font-semibold">vàng ≥2.5</span>, <span className="text-red-600 font-semibold">đỏ &lt;2.5</span>.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['A', 'B', 'C', 'D'] as const).map(gKey => {
              const gm = GROUP_META[gKey];
              const codes = Object.keys(CRITERIA_META).filter(k => k.startsWith(gKey));
              const groupScore = data.summary[`group_${gKey.toLowerCase()}` as 'group_a' | 'group_b' | 'group_c' | 'group_d'];
              return (
                <div key={gKey} className={`bg-white rounded-2xl border shadow-sm overflow-hidden`}>
                  {/* Group header */}
                  <div className={`px-5 py-3 border-b ${gm.bg} ${gm.border} flex items-center justify-between`}>
                    <div>
                      <span className={`text-sm font-bold ${gm.text}`}>{gm.label}</span>
                      <span className="text-xs text-slate-400 ml-2">Trọng số {gm.weight}</span>
                    </div>
                    <div className={`text-lg font-black ${gm.text}`}>{groupScore.toFixed(2)}<span className="text-xs font-normal text-slate-400">/{max}</span></div>
                  </div>

                  {/* Criteria */}
                  <div className="px-5 py-3">
                    {codes.map(code => {
                      const score = data.summary.criteria?.[code] ?? 0;
                      // Lấy reason tổng hợp từ conversation đầu tiên (nếu có)
                      const sampleReason = data.results[0]?.criteria_reasons?.[`${code.toLowerCase()}_${CRITERIA_META[code]?.name.toLowerCase().replace(/ /g, '_')}`] ?? '';
                      const barColor = score >= 4 ? 'bg-emerald-400' : score >= 2.5 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={code} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <HoverTooltip text={`${CRITERIA_META[code]?.name} (${CRITERIA_META[code]?.weight}) — ${CRITERIA_META[code]?.desc}`}>
                            <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${gm.bg} ${gm.text} border ${gm.border} cursor-help`}>{code}</span>
                          </HoverTooltip>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${(score / max) * 100}%` }} />
                              </div>
                              <span className="text-xs font-bold tabular-nums text-slate-700 w-8 text-right">{score.toFixed(2)}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">{CRITERIA_META[code]?.name}</p>
                          </div>
                        </div>
                      );
                    })}
                    {gKey === 'A' && (
                      <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                        <p className="text-[10px] text-amber-700">
                          <strong>Hard constraint:</strong> Nếu A1 = 0 → toàn nhóm A bị cap ở 1.0, bất kể A2/A3 đạt bao nhiêu.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bar chart 9 tiêu chí */}
          <div className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="text-[11px] font-semibold text-slate-500 mb-1">So sánh trực quan 9 tiêu chí</div>
            <p className="text-[10px] text-slate-400 mb-4">Hover vào cột để xem điểm số cụ thể</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={criteriaChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis domain={[0, max]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8' }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      const meta = CRITERIA_META[d.name];
                      return (
                        <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-xs max-w-[200px]">
                          <div className="font-bold text-slate-800">{d.name} — {meta?.name}</div>
                          <div className="text-indigo-600 font-semibold mt-0.5">{d.score}/{max}</div>
                          {meta && <div className="text-slate-500 mt-1 leading-relaxed">{meta.desc}</div>}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {criteriaChartData.map((entry, i) => {
                      const gKey = entry.name[0];
                      const colors: Record<string, string> = { A: '#6366F1', B: '#EA580C', C: '#0F766E', D: '#0284C7' };
                      return <Cell key={i} fill={colors[gKey] ?? '#8B5CF6'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            ZONE 3 — Per-conversation breakdown
        ═══════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-bold text-slate-700">Kết quả từng conversation</h2>
            <span className="text-[11px] text-slate-400">— {sorted.length} conversations · click để xem chi tiết tiêu chí</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-4">
            Mỗi hàng là 1 cuộc hội thoại được model replay lại. Điểm Overall tính theo công thức có trọng số. Badge đỏ <strong>A1=0</strong> nghĩa là conversation này vi phạm hard constraint.
          </p>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort('index')}># <SortIcon k="index" /></th>
                    <th className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none text-center" onClick={() => handleSort('overall')}>Overall <SortIcon k="overall" /></th>
                    <th className="px-4 py-3 cursor-pointer hover:text-indigo-600 select-none text-center text-indigo-500" onClick={() => handleSort('group_a')}>
                      A · Socratic <SortIcon k="group_a" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-orange-600 select-none text-center text-orange-500" onClick={() => handleSort('group_b')}>
                      B · Accuracy <SortIcon k="group_b" />
                    </th>
                    <th className="px-4 py-3 text-center text-teal-500">C · Pedagogy</th>
                    <th className="px-4 py-3 text-center text-sky-500">D · Hall+Spd</th>
                    <th className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none text-center" onClick={() => handleSort('latency')}>Latency <SortIcon k="latency" /></th>
                    <th className="px-4 py-3 text-center text-slate-400">Turns</th>
                    <th className="px-4 py-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r) => {
                    const ov   = r.group_scores?.overall  ?? 0;
                    const ga   = r.group_scores?.group_a  ?? 0;
                    const gb   = r.group_scores?.group_b  ?? 0;
                    const gc   = r.group_scores?.group_c  ?? 0;
                    const gd   = r.group_scores?.group_d  ?? 0;
                    const constraint = r.group_scores?.a1_hard_constraint_triggered;
                    const isExpanded = expandedRow === r.conv_index;

                    const scoreColor = (v: number) =>
                      v >= 4 ? 'text-emerald-700 font-bold' : v >= 2.5 ? 'text-amber-700 font-semibold' : 'text-red-600 font-semibold';

                    return (
                      <React.Fragment key={r.conv_index}>
                        <tr
                          className={`border-b border-slate-100 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/60'}`}
                          onClick={() => setExpandedRow(isExpanded ? null : r.conv_index)}
                        >
                          <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">{r.conv_index + 1}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`text-sm tabular-nums ${scoreColor(ov)}`}>{ov.toFixed(3)}</span>
                              {constraint && (
                                <HoverTooltip text="A1=0: model đã đưa đáp án trực tiếp — nhóm A bị giới hạn ở 1.0">
                                  <span className="text-[9px] bg-red-100 text-red-600 font-bold px-1 py-0.5 rounded cursor-help">A1=0</span>
                                </HoverTooltip>
                              )}
                            </div>
                          </td>
                          <td className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(ga)}`}>{ga.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gb)}`}>{gb.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gc)}`}>{gc.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gd)}`}>{gd.toFixed(2)}</td>
                          <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-500">{r.avg_latency_ms?.toFixed(0)}ms</td>
                          <td className="px-4 py-3 text-center text-xs text-slate-400">{r.num_turns}</td>
                          <td className="px-4 py-3 text-center">
                            <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </td>
                        </tr>

                        {/* Expanded: chi tiết 9 tiêu chí + reasons */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={9} className="px-6 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                                {(['A', 'B', 'C', 'D'] as const).map(gKey => {
                                  const gm = GROUP_META[gKey];
                                  const codes = Object.keys(CRITERIA_META).filter(k => k.startsWith(gKey));
                                  return (
                                    <div key={gKey} className="mb-3">
                                      <div className={`text-[10px] font-bold uppercase tracking-wider ${gm.text} mb-1.5`}>{gm.label}</div>
                                      {codes.map(code => {
                                        const score = r.criteria_scores?.[code] ?? 0;
                                        // reason key dạng "A1_answer_withholding"
                                        const reasonKey = Object.keys(r.criteria_reasons ?? {}).find(k => k.startsWith(code));
                                        const reason = reasonKey ? r.criteria_reasons[reasonKey] : '';
                                        return <CriteriaRow key={code} code={code} score={score} reason={reason} />;
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-400">Trang {safePage}/{totalPages} · {sorted.length} conversations</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const pg = Math.max(1, Math.min(safePage - 2, totalPages - 4)) + i;
                    return (
                      <button key={pg} onClick={() => setTablePage(pg)} className={`w-8 h-8 text-xs rounded-lg border transition ${pg === safePage ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{pg}</button>
                    );
                  })}
                  <button onClick={() => setTablePage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
};