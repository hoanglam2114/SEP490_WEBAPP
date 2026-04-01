import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CriteriaDetail {
  name: string;
  base_score: number;
  ft_score: number;
  base_reason?: string;
  ft_reason?: string;
}

interface ResultItem {
  subject: string;
  instruction: string;
  base_answer: string;
  ft_answer: string;
  expected: string;
  eval_method: string;
  base_score: number;
  ft_score: number;
  delta: number;
  criteria_detail?: CriteriaDetail[];
}

interface EvaluationData {
  modelEvalId: string;
  jobId: string;
  projectName?: string;
  isPinned?: boolean;
  status: string;
  totalSamples: number;
  subjectBreakdown: Record<string, number>;
  skippedBySimilarity: number;
  results: ResultItem[];
  judgeModel?: string;
  summary: {
    overall: { base_avg: number; ft_avg: number; delta?: number; improvement_pct: number };
    quality?: { base_avg: number; ft_avg: number; weight: number };
    hallucination?: { base_avg: number; ft_avg: number; weight: number; sample_count: number };
    speed?: { base_avg_ms: number; ft_avg_ms: number; base_score: number; ft_score: number; weight: number };
    by_subject: Record<string, { base_avg: number; ft_avg: number; improvement_pct: number }>;
    max_possible: number;
    reference_metrics?: {
      bleu: { base: number; ft: number };
      rouge_l: { base: number; ft: number };
    };
  };
  startedAt: string;
  completedAt: string;
}

type SortKey = 'index' | 'subject' | 'base' | 'ft' | 'delta';
type SortDir = 'asc' | 'desc';

// ─── Tooltip chú thích (portal + fixed: tránh cắt bởi viewport & overflow) ───

type HoverTooltipPlacement = 'top' | 'bottom' | 'auto';
type HoverTooltipAlign = 'center' | 'start' | 'end';

function HoverTooltip({
  text,
  children,
  placement = 'auto',
  align = 'center',
}: {
  text: string;
  children: React.ReactNode;
  placement?: HoverTooltipPlacement;
  align?: HoverTooltipAlign;
}) {
  const [show, setShow] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;

    const r = wrap.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const pad = 8;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const th = tipRect.height;
    const tw = tipRect.width;

    let place: 'top' | 'bottom';
    if (placement === 'top') place = 'top';
    else if (placement === 'bottom') place = 'bottom';
    else {
      const spaceAbove = r.top - pad;
      const spaceBelow = vh - r.bottom - pad;
      const need = th + gap;
      if (spaceAbove < need && spaceBelow >= need) place = 'bottom';
      else if (spaceBelow < need && spaceAbove >= need) place = 'top';
      else place = spaceBelow >= spaceAbove ? 'bottom' : 'top';
    }

    let left =
      align === 'center'
        ? r.left + r.width / 2 - tw / 2
        : align === 'start'
          ? r.left
          : r.right - tw;

    left = Math.max(pad, Math.min(left, vw - tw - pad));

    let top = place === 'bottom' ? r.bottom + gap : r.top - th - gap;
    top = Math.max(pad, Math.min(top, vh - th - pad));

    setPos({ top, left });
  }, [placement, align, text]);

  useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    reposition();
    const ro = new ResizeObserver(() => reposition());
    if (tipRef.current) ro.observe(tipRef.current);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [show, reposition]);

  const tip = show && (
    <div
      ref={tipRef}
      className={`fixed z-[100] w-[min(15rem,calc(100vw-16px))] bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-xl pointer-events-none whitespace-normal ${
        align === 'center' ? 'text-center' : 'text-left'
      }`}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? 0,
        opacity: pos ? 1 : 0,
      }}
    >
      {text}
    </div>
  );

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {typeof document !== 'undefined' && tip && createPortal(tip, document.body)}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-slate-400 hover:text-slate-500 transition cursor-help shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ─── Tooltips nội dung ────────────────────────────────────────────────────────

const TOOLTIPS = {
  overall: 'Điểm tổng hợp = Chất lượng (50%) + Hallucination (35%) + Tốc độ (15%). Thang điểm 0–5, hiển thị theo %.',
  quality: 'Trung bình điểm chất lượng câu trả lời qua 4 tiêu chí: Correctness, Explanation, Pedagogy, Language Quality. Chiếm 50% điểm tổng.',
  hallucination: 'Đánh giá khả năng mô hình biết khi nào nên từ chối và không bịa đặt thông tin. Chiếm 35% điểm tổng.',
  speed: 'Tốc độ sinh câu trả lời so với model gốc. FT nhanh hơn → điểm cao hơn. Chiếm 15% điểm tổng.',
  bleu: 'BLEU đo mức độ trùng lặp n-gram giữa câu trả lời và đáp án chuẩn. Điểm thấp với tiếng Việt là bình thường — dùng để theo dõi xu hướng, không phải điểm tuyệt đối.',
  rouge_l: 'ROUGE-L đo độ trùng lặp chuỗi con dài nhất chung (LCS). Phù hợp hơn BLEU cho câu dài. Cũng chỉ dùng để so sánh xu hướng FT vs Base.',
  correctness: 'Tính đúng đắn: công thức, tính toán, đáp án có chính xác không.',
  explanation: 'Trình bày: có đủ các bước, logic rõ ràng, dễ theo dõi không.',
  pedagogy: 'Sư phạm: ngôn ngữ có phù hợp học sinh THPT, dễ hiểu không.',
  language_quality: 'Chất lượng ngôn ngữ: ngữ pháp tiếng Việt, dấu câu, văn phong có tự nhiên không.',
  refusal_accuracy: 'Mô hình có biết khi nào nên từ chối (câu ngoài phạm vi) và khi nào nên trả lời không.',
  factual_faithfulness: 'Mô hình có bịa thêm thông tin không có trong đáp án chuẩn không.',
  specificity_accuracy: 'Số liệu, tên riêng, công thức cụ thể có đúng không.',
};

function criteriaTooltip(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, '_') as keyof typeof TOOLTIPS;
  return TOOLTIPS[key] ?? `Tiêu chí đánh giá: ${name}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtPct = (v: number, max: number) => ((v / max) * 100).toFixed(1);

function deltaInfo(b: number, f: number) {
  const d = ((f - b) / Math.max(0.01, b)) * 100;
  return { val: d, pos: d >= 0, txt: `${d >= 0 ? '+' : ''}${d.toFixed(1)}%` };
}

function MiniBar({ base, ft }: { base: number; ft: number }) {
  return (
    <div className="mt-3 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 w-7 shrink-0">Base</span>
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-slate-400 rounded-full transition-all" style={{ width: `${Math.min(base, 100)}%` }} />
        </div>
        <span className="text-[10px] text-slate-500 w-10 text-right">{base.toFixed(1)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-purple-400 w-7 shrink-0">FT</span>
        <div className="flex-1 h-1.5 bg-purple-100 rounded-full overflow-hidden">
          <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${Math.min(ft, 100)}%` }} />
        </div>
        <span className="text-[10px] text-purple-600 font-semibold w-10 text-right">{ft.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const Icons = {
  chart: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>),
  academic: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>),
  shield: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>),
  bolt: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>),
  search: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>),
  x: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>),
  chevLeft: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>),
  chevRight: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>),
  ruler: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 19.5l15-15M8.25 3.75l3 3M10.5 9l1.5 1.5M12.75 11.25l1.5 1.5M15 13.5l1.5 1.5M17.25 15.75l1.5 1.5" /></svg>),
  pin: (<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17a1 1 0 11-2 0V5.477L6.237 7.082l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" /></svg>),
};

// ─── Slide Panel ──────────────────────────────────────────────────────────────

function SlidePanel({ row, max, index, onClose }: { row: ResultItem; max: number; index: number; onClose: () => void }) {
  const deltaPos = row.delta >= 0;
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[520px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500">Question #{index + 1}</span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded inline-flex w-fit">{row.subject}</span>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${deltaPos ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              Δ {row.delta >= 0 ? '+' : ''}{row.delta}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">{Icons.x}</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wide">Question</p>
            <p className="text-sm text-slate-800 leading-relaxed">{row.instruction}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
              <p className="text-[10px] text-slate-400 font-semibold uppercase mb-1">Base</p>
              <p className="text-2xl font-bold text-slate-600">{row.base_score}<span className="text-sm font-normal text-slate-400">/{max}</span></p>
            </div>
            <div className="bg-purple-50 rounded-xl p-3 border border-purple-100 text-center">
              <p className="text-[10px] text-purple-500 font-semibold uppercase mb-1">Fine-tuned</p>
              <p className="text-2xl font-bold text-purple-700">{row.ft_score}<span className="text-sm font-normal text-purple-400">/{max}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 border border-slate-200 rounded-xl">
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Base Answer</p>
              <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{row.base_answer}</p>
            </div>
            <div className="bg-purple-50 p-3 border border-purple-100 rounded-xl">
              <p className="text-[10px] uppercase font-bold text-purple-500 mb-2">FT Answer</p>
              <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{row.ft_answer}</p>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Expected / Hints</p>
            <p className="text-xs text-slate-700 italic whitespace-pre-wrap leading-relaxed">{row.expected}</p>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Eval method</p>
            <p className="text-xs text-slate-700 font-mono">{row.eval_method}</p>
          </div>

          {row.criteria_detail && row.criteria_detail.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 border-b border-slate-100 pb-1">Criteria breakdown</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {row.criteria_detail.map((c, ci) => (
                  <div key={ci} className="bg-white p-3 rounded-lg border border-slate-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-semibold text-slate-800">
                      <HoverTooltip text={criteriaTooltip(c.name)} align="start">
                        <span className="flex items-center gap-1 cursor-help">{c.name} <InfoIcon /></span>
                      </HoverTooltip>
                      <span className="text-purple-600 border px-2 py-0.5 rounded-md bg-purple-50">
                        Base {c.base_score} → FT {c.ft_score}
                      </span>
                    </div>
                    {c.base_reason && <p className="text-slate-500"><span className="font-semibold">Base reasoning:</span> {c.base_reason}</p>}
                    {c.ft_reason && <p className="text-slate-500"><span className="font-semibold">FT reasoning:</span> {c.ft_reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Score Card ───────────────────────────────────────────────────────────────

function ScoreCard({ icon, iconBg, title, tooltip, badge, badgeColor, baseVal, ftVal, deltaStr, deltaPos, sub }: {
  icon: React.ReactNode; iconBg: string; title: string; tooltip: string;
  badge?: string; badgeColor?: string;
  baseVal: string; ftVal: string; deltaStr: string; deltaPos: boolean;
  sub?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
          <HoverTooltip text={tooltip}>
            <span className="flex items-center gap-1 text-sm font-semibold text-slate-700 cursor-help">
              {title} <InfoIcon />
            </span>
          </HoverTooltip>
        </div>
        {badge && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>{badge}</span>}
      </div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-2xl font-bold text-purple-700">{ftVal}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400">vs base {baseVal}</span>
        <span className={`text-xs font-bold ${deltaPos ? 'text-emerald-600' : 'text-red-500'}`}>{deltaStr} {deltaPos ? '↑' : '↓'}</span>
      </div>
      <MiniBar base={parseFloat(baseVal)} ft={parseFloat(ftVal)} />
      {sub && <div className="mt-2">{sub}</div>}
    </div>
  );
}

// ─── Lexical Metric Card ──────────────────────────────────────────────────────

function LexicalCard({ label, baseVal, ftVal, tooltip }: { label: string; baseVal: number; ftVal: number; tooltip: string }) {
  const delta = ftVal - baseVal;
  const deltaPos = delta >= 0;
  // bar max = max of both values, min 0.1 để bar không quá nhỏ
  const barMax = Math.max(baseVal, ftVal, 0.05);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <HoverTooltip text={tooltip}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-1 cursor-help">
          {label} <InfoIcon />
        </p>
      </HoverTooltip>

      {/* So sánh 2 model trực quan */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 w-8 shrink-0">Base</span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-slate-400 rounded-full transition-all" style={{ width: `${(baseVal / barMax) * 100}%` }} />
          </div>
          <span className="text-[11px] font-mono text-slate-600 w-12 text-right">{baseVal.toFixed(3)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-purple-500 w-8 shrink-0">FT</span>
          <div className="flex-1 h-2 bg-purple-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${(ftVal / barMax) * 100}%` }} />
          </div>
          <span className="text-[11px] font-mono font-semibold text-purple-700 w-12 text-right">{ftVal.toFixed(3)}</span>
        </div>
      </div>

      {/* Delta */}
      <div className="mt-2 flex items-center justify-end">
        <span className={`text-[11px] font-semibold ${deltaPos ? 'text-emerald-600' : 'text-red-500'}`}>
          {deltaPos ? '+' : ''}{delta.toFixed(3)} {deltaPos ? '↑' : '↓'}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export const ModelEvalResultScreen: React.FC = () => {
  const { evalId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartFilter, setChartFilter] = useState<string>('all');

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [tablePage, setTablePage] = useState(1);
  const [tableSubjectFilter, setTableSubjectFilter] = useState<string>('all');
  const [slideRow, setSlideRow] = useState<ResultItem | null>(null);
  const [slideIndex, setSlideIndex] = useState<number | null>(null);

  const styleRef = useRef(false);
  if (!styleRef.current) {
    styleRef.current = true;
    const s = document.createElement('style');
    s.textContent = `@keyframes slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}} .animate-slide-in{animation:slide-in 0.22s cubic-bezier(0.16,1,0.3,1)}`;
    document.head.appendChild(s);
  }

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
      <svg className="w-8 h-8 animate-spin text-purple-500 mb-3" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm text-slate-500">Đang tải kết quả đánh giá…</p>
    </div>
  );

  if (!data) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <p className="text-slate-500 font-medium">Không tìm thấy kết quả đánh giá</p>
      <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700">Quay lại</button>
    </div>
  );

  const max = data.summary.max_possible;
  const p_base = (data.summary.overall.base_avg / max) * 100;
  const p_ft = (data.summary.overall.ft_avg / max) * 100;
  const imp = data.summary.overall.improvement_pct;

  const qualityData = data.summary.quality ?? (() => {
    const keys = Object.keys(data.summary.by_subject || {}).filter(k => k !== 'hallucination');
    if (!keys.length) return null;
    const b = keys.reduce((s, k) => s + data.summary.by_subject[k].base_avg, 0) / keys.length;
    const f = keys.reduce((s, k) => s + data.summary.by_subject[k].ft_avg, 0) / keys.length;
    return { base_avg: b, ft_avg: f, weight: 1.0 };
  })();
  const hallData = data.summary.hallucination ?? null;
  const speedData = data.summary.speed ?? null;

  const availableSubjects = Object.entries(data.subjectBreakdown)
    .filter(([, count]) => count > 0).map(([s]) => s)
    .sort((a, b) => a === 'hallucination' ? 1 : b === 'hallucination' ? -1 : 0);

  let chartData: any[] = [];
  if (chartFilter === 'all') {
    chartData = Object.entries(data.summary.by_subject || {}).map(([subj, stats]) => ({
      name: subj.toUpperCase(),
      Base: parseFloat(((stats.base_avg / max) * 100).toFixed(1)),
      Finetuned: parseFloat(((stats.ft_avg / max) * 100).toFixed(1)),
    }));
  } else {
    const subjResults = data.results.filter(r => r.subject === chartFilter && r.criteria_detail?.length);
    if (subjResults.length > 0) {
      const sums: Record<string, { b: number; f: number; n: number }> = {};
      subjResults.forEach(r => r.criteria_detail!.forEach((c: CriteriaDetail) => {
        if (!sums[c.name]) sums[c.name] = { b: 0, f: 0, n: 0 };
        sums[c.name].b += c.base_score; sums[c.name].f += c.ft_score; sums[c.name].n++;
      }));
      chartData = Object.entries(sums).map(([n, v]) => ({
        name: n,
        Base: parseFloat(((v.b / v.n / max) * 100).toFixed(1)),
        Finetuned: parseFloat(((v.f / v.n / max) * 100).toFixed(1)),
      }));
    } else {
      const s = (data.summary.by_subject as any)[chartFilter];
      if (s) chartData = [{ name: chartFilter.toUpperCase(), Base: parseFloat(((s.base_avg / max) * 100).toFixed(1)), Finetuned: parseFloat(((s.ft_avg / max) * 100).toFixed(1)) }];
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setTablePage(1);
  };
  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 opacity-50">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  );

  const filtered = data.results
    .filter(r => !search || r.instruction.toLowerCase().includes(search.toLowerCase()))
    .filter(r => tableSubjectFilter === 'all' || r.subject === tableSubjectFilter)
    .map((r, i) => ({ ...r, _origIdx: i }));

  const sorted = [...filtered].sort((a, b) => {
    let v = 0;
    if (sortKey === 'subject') v = a.subject.localeCompare(b.subject);
    else if (sortKey === 'base') v = a.base_score - b.base_score;
    else if (sortKey === 'ft') v = a.ft_score - b.ft_score;
    else if (sortKey === 'delta') v = a.delta - b.delta;
    else v = a._origIdx - b._origIdx;
    return sortDir === 'asc' ? v : -v;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const shortEvalId = evalId ? evalId.slice(0, 16) + '…' : '';
  const judgeLabel = data.judgeModel
    ? (data.judgeModel.includes('haiku') ? 'Haiku' : data.judgeModel.includes('sonnet') ? 'Sonnet' : data.judgeModel.includes('opus') ? 'Opus' : data.judgeModel)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">{Icons.chevLeft}</button>
            <div className="flex flex-col">
              <nav className="flex items-center gap-1 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <span className="text-slate-600">{Icons.chart}</span>
                  <button onClick={() => navigate('/model-eval/leaderboard')} className="hover:text-slate-700 transition">Model eval</button>
                </span>
                <span>/</span>
                <button onClick={() => navigate(`/model-eval/history/${data.jobId}`)} className="hover:text-slate-700 transition font-mono text-[11px]">{data.jobId.slice(0, 8)}…</button>
                <span>/</span>
                <span className="text-slate-600 font-medium">Result</span>
              </nav>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {data.projectName ? data.projectName : `Job ${data.jobId.slice(0, 8)}…`}
                </span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>Completed at {new Date(data.completedAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Badge Pinned */}
            {data.isPinned && (
              <HoverTooltip text="Đây là eval được chọn làm kết quả chính thức (Official) hiển thị trên Leaderboard.">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-full cursor-help">
                  {Icons.pin} Official
                </span>
              </HoverTooltip>
            )}
            {judgeLabel && (
              <HoverTooltip text={`Mô hình chấm điểm (Judge): ${data.judgeModel}`}>
                <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full border border-slate-200 cursor-help">
                  Judge: {judgeLabel}
                </span>
              </HoverTooltip>
            )}
            <button onClick={() => navigate(`/model-eval/history/${data.jobId}`)} className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline transition">
              View all runs →
            </button>
            <span className="text-[10px] text-slate-400 font-mono hidden md:block">{shortEvalId}</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Zone A: 4 Score Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <ScoreCard
            icon={<span className="text-purple-600">{Icons.chart}</span>}
            iconBg="bg-purple-50" title="Overall" tooltip={TOOLTIPS.overall}
            baseVal={p_base.toFixed(1)} ftVal={p_ft.toFixed(1)}
            deltaStr={`${imp >= 0 ? '+' : ''}${imp.toFixed(1)}%`} deltaPos={imp >= 0}
            badge={`${data.totalSamples} samples`} badgeColor="bg-slate-50 text-slate-500 border-slate-200"
          />

          {qualityData ? (() => {
            const d = deltaInfo(qualityData.base_avg, qualityData.ft_avg);
            return (
              <ScoreCard
                icon={<span className="text-indigo-600">{Icons.academic}</span>}
                iconBg="bg-indigo-50" title="Quality" tooltip={TOOLTIPS.quality}
                baseVal={parseFloat(fmtPct(qualityData.base_avg, max)).toFixed(1)}
                ftVal={parseFloat(fmtPct(qualityData.ft_avg, max)).toFixed(1)}
                deltaStr={d.txt} deltaPos={d.pos}
                badge={qualityData.weight < 1 ? `${(qualityData.weight * 100).toFixed(0)}% weight` : undefined}
                badgeColor="bg-indigo-50 text-indigo-600 border-indigo-200"
              />
            );
          })() : (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-indigo-200 mb-2">{Icons.academic}</span>
              <p className="text-sm font-semibold text-slate-400">Quality</p>
              <p className="text-xs text-slate-300 mt-1">No data</p>
            </div>
          )}

          {hallData ? (() => {
            const d = deltaInfo(hallData.base_avg, hallData.ft_avg);
            return (
              <ScoreCard
                icon={<span className="text-orange-600">{Icons.shield}</span>}
                iconBg="bg-orange-50" title="Hallucination" tooltip={TOOLTIPS.hallucination}
                baseVal={parseFloat(fmtPct(hallData.base_avg, max)).toFixed(1)}
                ftVal={parseFloat(fmtPct(hallData.ft_avg, max)).toFixed(1)}
                deltaStr={d.txt} deltaPos={d.pos}
                badge={`${hallData.sample_count} tests`} badgeColor="bg-orange-50 text-orange-600 border-orange-200"
              />
            );
          })() : (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-orange-200 mb-2">{Icons.shield}</span>
              <p className="text-sm font-semibold text-slate-400">Hallucination</p>
              <p className="text-xs text-slate-300 mt-1">Add subject=hallucination</p>
            </div>
          )}

          {speedData ? (() => {
            const faster = speedData.ft_avg_ms < speedData.base_avg_ms;
            const ratio = speedData.base_avg_ms > 0 ? ((speedData.ft_avg_ms / speedData.base_avg_ms - 1) * 100) : 0;
            return (
              <ScoreCard
                icon={<span className="text-sky-600">{Icons.bolt}</span>}
                iconBg="bg-sky-50" title="Speed" tooltip={TOOLTIPS.speed}
                baseVal={((speedData.base_score / max) * 100).toFixed(1)}
                ftVal={((speedData.ft_score / max) * 100).toFixed(1)}
                deltaStr={`${ratio >= 0 ? '+' : ''}${ratio.toFixed(1)}%`} deltaPos={faster}
                badge={`${speedData.ft_avg_ms.toFixed(0)}ms`} badgeColor="bg-sky-50 text-sky-600 border-sky-200"
                sub={<p className="text-[10px] text-slate-400 text-center">{speedData.base_avg_ms.toFixed(0)}ms → {speedData.ft_avg_ms.toFixed(0)}ms</p>}
              />
            );
          })() : (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="text-sky-200 mb-2">{Icons.bolt}</span>
              <p className="text-sm font-semibold text-slate-400">Speed</p>
              <p className="text-xs text-slate-300 mt-1">No data</p>
            </div>
          )}
        </div>

        {/* Zone C: Lexical Metrics — redesigned */}
        {data.summary.reference_metrics && (() => {
          const rm = data.summary.reference_metrics!;
          return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <HoverTooltip text="Các metric tham chiếu lexical — không tính vào điểm tổng. Dùng để theo dõi xu hướng cải thiện.">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium flex items-center gap-1.5 cursor-help">
                    <span className="text-slate-500">{Icons.ruler}</span>
                    Lexical reference metrics — non-scoring
                    <InfoIcon />
                  </p>
                </HoverTooltip>
                <p className="text-[10px] text-slate-400 italic">Giá trị thấp với tiếng Việt là bình thường — chỉ dùng để so sánh xu hướng.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LexicalCard label="BLEU-4" baseVal={rm.bleu.base} ftVal={rm.bleu.ft} tooltip={TOOLTIPS.bleu} />
                <LexicalCard label="ROUGE-L" baseVal={rm.rouge_l.base} ftVal={rm.rouge_l.ft} tooltip={TOOLTIPS.rouge_l} />
              </div>
            </div>
          );
        })()}

        {/* Zone B: Bar Chart */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-slate-800">Performance Chart</h2>
            <div className="flex bg-slate-100 p-1 rounded-lg gap-1 flex-wrap">
              <button onClick={() => setChartFilter('all')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${chartFilter === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>All</button>
              {availableSubjects.map(subj => (
                <button key={subj} onClick={() => setChartFilter(subj)} className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${chartFilter === subj ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  {subj.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} domain={[0, 100]} tickFormatter={(v: any) => `${v}%`} />
                <Tooltip cursor={{ fill: '#F1F5F9' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Bar dataKey="Base" fill="#94A3B8" radius={[4, 4, 0, 0]} maxBarSize={60} />
                <Bar dataKey="Finetuned" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Zone D: Results Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-slate-800">
              Detailed Results
              <span className="ml-2 text-xs font-normal text-slate-400">({filtered.length} rows)</span>
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Subject</span>
                <select value={tableSubjectFilter} onChange={e => { setTableSubjectFilter(e.target.value); setTablePage(1); }}
                  className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 focus:outline-none focus:border-slate-400">
                  <option value="all">All</option>
                  {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{Icons.search}</div>
                <input value={search} onChange={e => { setSearch(e.target.value); setTablePage(1); }}
                  placeholder="Tìm câu hỏi…"
                  className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-slate-400 w-56 transition" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => handleSort('index')}># <SortIcon k="index" /></th>
                  <th className="px-5 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => handleSort('subject')}>Subject <SortIcon k="subject" /></th>
                  <th className="px-5 py-3">Question</th>
                  <th className="px-5 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => handleSort('base')}>Base <SortIcon k="base" /></th>
                  <th className="px-5 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => handleSort('ft')}>FT <SortIcon k="ft" /></th>
                  <th className="px-5 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => handleSort('delta')}>Δ <SortIcon k="delta" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400 text-sm">Không tìm thấy kết quả.</td></tr>
                ) : paginated.map((r, i) => {
                  const deltaColor = r.delta > 0 ? 'text-emerald-600' : r.delta < 0 ? 'text-red-500' : 'text-slate-400';
                  return (
                    <tr key={i} className="hover:bg-purple-50/40 transition cursor-pointer" onClick={() => { setSlideRow(r); setSlideIndex((safePage - 1) * PAGE_SIZE + i); }}>
                      <td className="px-5 py-3.5 text-slate-400 text-xs">{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-5 py-3.5"><span className="text-xs font-bold uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{r.subject}</span></td>
                      <td className="px-5 py-3.5 text-slate-600 max-w-xs"><p className="truncate text-sm" title={r.instruction}>{r.instruction.length > 60 ? r.instruction.slice(0, 60) + '…' : r.instruction}</p></td>
                      <td className="px-5 py-3.5 font-medium text-slate-500 text-sm">{r.base_score}<span className="text-slate-300">/{max}</span></td>
                      <td className="px-5 py-3.5 font-bold text-purple-700 text-sm">{r.ft_score}<span className="text-purple-300 font-normal">/{max}</span></td>
                      <td className={`px-5 py-3.5 font-bold text-sm ${deltaColor}`}>{r.delta > 0 ? '+' : ''}{r.delta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-400">Trang {safePage} / {totalPages} · {sorted.length} rows</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition">{Icons.chevLeft}</button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pg = Math.max(1, Math.min(safePage - 2, totalPages - 4)) + i;
                  return (
                    <button key={pg} onClick={() => setTablePage(pg)} className={`w-8 h-8 text-xs rounded-lg border transition ${pg === safePage ? 'bg-purple-600 border-purple-600 text-white font-bold' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{pg}</button>
                  );
                })}
                <button onClick={() => setTablePage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition">{Icons.chevRight}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {slideRow && slideIndex !== null && (
        <SlidePanel row={slideRow} max={max} index={slideIndex} onClose={() => { setSlideRow(null); setSlideIndex(null); }} />
      )}
    </div>
  );
};