import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConvResult {
  conv_index: number;
  num_turns: number;
  avg_latency_ms: number;
  replay_turns?: { user: string; model: string; latency_ms: number }[];
  criteria_scores: Record<string, number>;
  criteria_reasons: Record<string, string>;
  group_scores: {
    group_a: number;
    group_b: number;
    group_c: number;
    group_d: number;
    overall: number;
    a1_hard_constraint_triggered: boolean;
  };
  non_scoring: {
    bleu: number;
    rouge_l: number;
    question_detection_rate: number;
  };
  confidence?: {
    overall: number;
    by_group: Record<string, number>;
    is_low: boolean;
  };
  human_review?: {
    verdict: "agree" | "disagree" | "skip";
    note?: string;
    reviewer?: string;
    reviewed_at: string;
  };
}

interface EvaluationData {
  modelEvalId: string;
  jobId: string;
  projectName?: string;
  isPinned?: boolean;
  status: string;
  evalMode?: "single" | "paired";
  ftModelRepo?: string;
  baseModelRepo?: string;
  totalConversations: number;
  validConversations: number;
  judgeModel?: string;
  results: ConvResult[];
  baseResults?: ConvResult[];
  baseSummary?: {
    overall: number;
    group_a: number; group_b: number; group_c: number; group_d: number;
    criteria: Record<string, number>;
    avg_latency_ms: number;
    avg_confidence?: number;
    low_confidence_count?: number;
    non_scoring: { bleu: number; rouge_l: number; question_detection_rate: number };
    max_possible: number;
  };
  delta?: {
    overall: number;
    group_a: number;
    group_b: number;
    group_c: number;
    group_d: number;
    criteria: Record<string, number>;
    avg_latency_ms: number;
  };
  summary: {
    overall: number;
    group_a: number;
    group_b: number;
    group_c: number;
    group_d: number;
    criteria: Record<string, number>;
    avg_latency_ms: number;
    avg_confidence?: number;
    low_confidence_count?: number;
    non_scoring: {
      bleu: number;
      rouge_l: number;
      question_detection_rate: number;
    };
    max_possible: number;
  };
  startedAt: string;
  completedAt: string;
}

type SortKey = "index" | "overall" | "group_a" | "group_b" | "latency";
type SortDir = "asc" | "desc";

// ─── Metadata về các tiêu chí (A1–D2) ───────────────────────────────────────

const CRITERIA_META: Record<
  string,
  { group: string; name: string; desc: string; weight: string }
> = {
  A1: {
    group: "A",
    name: "Answer Withholding",
    weight: "50% nhóm A",
    desc: "Model có tự đưa ra đáp án cuối cùng không. Hard constraint: nếu A1=0, toàn nhóm A bị giới hạn ở 1.0.",
  },
  A2: {
    group: "A",
    name: "Scaffolding Quality",
    weight: "30% nhóm A",
    desc: "Câu hỏi gợi mở có đủ cụ thể để học sinh biết suy nghĩ tiếp không, có theo đúng flow bài học không.",
  },
  A3: {
    group: "A",
    name: "Adaptive Response",
    weight: "20% nhóm A",
    desc: "Model phản ứng đúng với từng kiểu input: đúng→khen; sai→gợi ý; lạc đề→redirect; mơ hồ→làm rõ.",
  },
  B1: {
    group: "B",
    name: "Factual Accuracy",
    weight: "60% nhóm B",
    desc: "Kiến thức được trình bày trong các turn có chính xác không — đặc biệt lý thuyết đầu hội thoại.",
  },
  B2: {
    group: "B",
    name: "Grade-level",
    weight: "40% nhóm B",
    desc: "Ngôn ngữ, ví dụ, và độ phức tạp có phù hợp với học sinh cấp 2-3 không.",
  },
  C1: {
    group: "C",
    name: "Robustness",
    weight: "40% nhóm C",
    desc: "Khi học sinh gửi input mơ hồ/off-topic, model xử lý mượt và redirect tự nhiên về bài học.",
  },
  C2: {
    group: "C",
    name: "Coherence",
    weight: "40% nhóm C",
    desc: "Các turn sau có nhớ và kế thừa context các turn trước không; flow hội thoại có tự nhiên không.",
  },
  C3: {
    group: "C",
    name: "Tone & Encouragement",
    weight: "20% nhóm C",
    desc: "Giọng điệu ấm áp, khích lệ, không phán xét khi học sinh sai — phù hợp lứa tuổi.",
  },
  D1: {
    group: "D",
    name: "Hallucination",
    weight: "50% nhóm D",
    desc: "Không bịa context bài học, không bịa lịch sử hội thoại, không bịa câu trả lời của học sinh.",
  },
  D2: {
    group: "D",
    name: "Speed (Latency)",
    weight: "50% nhóm D",
    desc: "Latency trung bình mỗi turn: ≤2s=5đ, ≤4s=4đ, ≤7s=3đ, ≤12s=2đ, >12s=1đ.",
  },
};

const GROUP_META = {
  A: {
    label: "A · Socratic Compliance",
    weight: "40%",
    color: "indigo",
    text: "text-indigo-700",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
  },
  B: {
    label: "B · Độ chính xác",
    weight: "25%",
    color: "orange",
    text: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
  C: {
    label: "C · Chất lượng sư phạm",
    weight: "25%",
    color: "teal",
    text: "text-teal-700",
    bg: "bg-teal-50",
    border: "border-teal-200",
  },
  D: {
    label: "D · Hallucination + Tốc độ",
    weight: "10%",
    color: "sky",
    text: "text-sky-700",
    bg: "bg-sky-50",
    border: "border-sky-200",
  },
};

// ─── HoverTooltip ─────────────────────────────────────────────────────────────

function HoverTooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
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
    const { height: th, width: tw } = tip.getBoundingClientRect();
    const pad = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = r.top - th - gap < pad ? r.bottom + gap : r.top - th - gap;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, vw - tw - pad));
    setPos({ top: Math.max(pad, Math.min(top, vh - th - pad)), left });
  }, []);

  useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [show, reposition]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            className="fixed z-[100] w-[min(18rem,calc(100vw-16px))] bg-slate-800 text-white text-xs leading-relaxed rounded-lg px-3 py-2 shadow-xl pointer-events-none"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? 0,
              opacity: pos ? 1 : 0,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 transition cursor-help shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({
  value,
  max,
  label,
  color,
}: {
  value: number;
  max: number;
  label: string;
  color: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const colorMap: Record<string, string> = {
    purple: "#7C3AED",
    indigo: "#4F46E5",
    orange: "#EA580C",
    teal: "#0F766E",
    sky: "#0284C7",
  };
  const stroke = colorMap[color] ?? "#7C3AED";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="6"
          />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-800">
            {value.toFixed(2)}
          </span>
        </div>
      </div>
      <span className="text-[10px] font-semibold text-slate-500 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

// ─── Criteria Score Row (trong bảng per-conv expandable) ──────────────────────

function CriteriaRow({
  code,
  score,
  reason,
}: {
  code: string;
  score: number;
  reason: string;
}) {
  const meta = CRITERIA_META[code];
  const gKey = code[0] as keyof typeof GROUP_META;
  const gm = GROUP_META[gKey] ?? GROUP_META.A;
  const barPct = (score / 5) * 100;
  const barColor =
    score >= 4
      ? "bg-emerald-400"
      : score >= 2.5
        ? "bg-amber-400"
        : "bg-red-400";
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
      <HoverTooltip
        text={`${meta?.name ?? code} (${meta?.weight ?? ""}) — ${meta?.desc ?? ""}`}
      >
        <span
          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${gm.bg} ${gm.text} ${gm.border} border cursor-help`}
        >
          {code}
        </span>
      </HoverTooltip>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-700 tabular-nums w-6 text-right">
            {score}
          </span>
        </div>
        {reason && (
          <p
            className="text-[10px] text-slate-500 leading-relaxed truncate"
            title={reason}
          >
            {reason}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

function RubricTab() {
  const RUBRIC = [
    {
      group: "A",
      label: "Socratic Compliance",
      weight: "40%",
      color: "indigo",
      textColor: "text-indigo-700",
      bgColor: "bg-indigo-50",
      borderColor: "border-indigo-200",
      intro:
        "Đây là nhóm cốt lõi, phản ánh trực tiếp mục tiêu fine-tune theo phương pháp Socratic. Hard constraint: nếu A1=0, toàn nhóm A bị giới hạn ở 1.0 bất kể các tiêu chí khác.",
      criteria: [
        {
          code: "A1",
          name: "Answer Withholding",
          weight: "50%",
          desc: 'Model có tự đưa ra đáp án cuối cùng không — kể cả khi học sinh hỏi thẳng, nài nỉ, hoặc nói "khó quá".',
          scale: [
            {
              score: "5",
              desc: "Không bao giờ đưa đáp án trực tiếp trong toàn bộ hội thoại. Mọi turn đều dẫn dắt.",
            },
            {
              score: "3–4",
              desc: "Phần lớn giữ được, nhưng 1–2 turn có hint rõ đến mức gần như lộ đáp án.",
            },
            {
              score: "1–2",
              desc: "Có ít nhất 1 turn đưa đáp án trực tiếp dù học sinh chưa tự tìm ra.",
            },
            {
              score: "0",
              desc: "Đưa đáp án ngay từ đầu hoặc đưa liên tục khi học sinh yêu cầu.",
            },
          ],
        },
        {
          code: "A2",
          name: "Scaffolding Quality",
          weight: "30%",
          desc: 'Câu hỏi gợi mở có đủ cụ thể để học sinh biết suy nghĩ tiếp không? Có theo đúng flow bài học không? Tránh câu hỏi chung chung vô nghĩa như "Bạn nghĩ sao?".',
          scale: [
            {
              score: "5",
              desc: "Câu hỏi cụ thể, bám sát nội dung, từng bước thu hẹp khoảng cách nhận thức.",
            },
            {
              score: "3–4",
              desc: "Câu hỏi đúng hướng nhưng đôi khi quá chung hoặc không kết nối với câu trả lời trước.",
            },
            {
              score: "1–2",
              desc: "Câu hỏi lặp lại, không dựa trên context, học sinh không biết phải trả lời gì.",
            },
            {
              score: "0",
              desc: "Không có câu hỏi dẫn dắt, hoặc câu hỏi hoàn toàn lạc đề.",
            },
          ],
        },
        {
          code: "A3",
          name: "Adaptive Response",
          weight: "20%",
          desc: "Model phản ứng đúng với từng kiểu input: đúng→khen+tiếp theo; sai→gợi ý không phán xét; lạc đề→redirect khéo; mơ hồ→làm rõ.",
          scale: [
            {
              score: "5",
              desc: "Phản ứng phù hợp 100% với tất cả kiểu input học sinh trong hội thoại.",
            },
            {
              score: "3–4",
              desc: "Phần lớn đúng, có 1–2 turn xử lý chưa khéo (ví dụ: phán xét thay vì gợi ý khi học sinh sai).",
            },
            {
              score: "1–2",
              desc: "Thường phản ứng cứng nhắc, không thích ứng với context học sinh.",
            },
            {
              score: "0",
              desc: "Bỏ qua hoàn toàn context của học sinh, trả lời theo kịch bản cố định.",
            },
          ],
        },
      ],
    },
    {
      group: "B",
      label: "Độ chính xác nội dung",
      weight: "25%",
      color: "orange",
      textColor: "text-orange-700",
      bgColor: "bg-orange-50",
      borderColor: "border-orange-200",
      intro:
        "Đánh giá kiến thức được trình bày trong hội thoại có chính xác và phù hợp trình độ không.",
      criteria: [
        {
          code: "B1",
          name: "Factual Accuracy",
          weight: "60%",
          desc: "Kiến thức được trình bày trong các turn của model có chính xác không — đặc biệt ở phần lý thuyết đầu hội thoại.",
          scale: [
            {
              score: "5",
              desc: "Không có lỗi kiến thức nào trong toàn bộ hội thoại.",
            },
            {
              score: "3–4",
              desc: "Có 1 lỗi nhỏ hoặc diễn đạt chưa chính xác, nhưng không gây hiểu nhầm nghiêm trọng.",
            },
            {
              score: "1–2",
              desc: "Có 1–2 lỗi kiến thức rõ ràng, học sinh có thể học sai.",
            },
            {
              score: "0",
              desc: "Sai kiến thức nghiêm trọng, hoặc bịa đặt nội dung bài học (hallucinate).",
            },
          ],
        },
        {
          code: "B2",
          name: "Grade-level Appropriateness",
          weight: "40%",
          desc: "Ngôn ngữ, ví dụ, và độ phức tạp có phù hợp với học sinh cấp 2–3 không?",
          scale: [
            {
              score: "5",
              desc: "Ngôn ngữ thân thiện, ví dụ gần gũi, độ khó vừa đủ với THCS/THPT.",
            },
            {
              score: "3–4",
              desc: "Phần lớn phù hợp, có vài chỗ dùng thuật ngữ quá chuyên sâu hoặc giải thích quá dài.",
            },
            {
              score: "1–2",
              desc: "Nhiều đoạn quá học thuật hoặc quá đơn giản so với trình độ mục tiêu.",
            },
            {
              score: "0",
              desc: "Hoàn toàn không phù hợp trình độ — quá khó hoặc quá trẻ con.",
            },
          ],
        },
      ],
    },
    {
      group: "C",
      label: "Chất lượng sư phạm",
      weight: "25%",
      color: "teal",
      textColor: "text-teal-700",
      bgColor: "bg-teal-50",
      borderColor: "border-teal-200",
      intro:
        "Đánh giá tổng thể về mạch lạc, xử lý tình huống và giọng điệu của hội thoại.",
      criteria: [
        {
          code: "C1",
          name: "Robustness",
          weight: "40%",
          desc: 'Khi học sinh gửi "xin chào", "ok", "khó quá", hay input không liên quan, model xử lý thế nào.',
          scale: [
            {
              score: "5",
              desc: "Luôn xử lý mượt — redirect về bài học tự nhiên hoặc phản hồi phù hợp context.",
            },
            {
              score: "3–4",
              desc: "Hầu hết ổn, đôi khi bị confuse hoặc phản hồi không nhất quán với 1–2 turn.",
            },
            {
              score: "1–2",
              desc: 'Thường xuyên bị mất hướng với input đơn giản như "xin chào" hay "ok".',
            },
            {
              score: "0",
              desc: "Bịa context bài học từ system prompt không có thông tin.",
            },
          ],
        },
        {
          code: "C2",
          name: "Conversational Coherence",
          weight: "40%",
          desc: "Các turn sau có nhớ và kế thừa context các turn trước không? Flow hội thoại có tự nhiên, không bị lặp lại hay nhảy cóc không?",
          scale: [
            {
              score: "5",
              desc: "Hội thoại mạch lạc xuyên suốt, mỗi turn kế thừa tốt câu trả lời trước của học sinh.",
            },
            {
              score: "3–4",
              desc: "Phần lớn mạch lạc, có 1–2 turn bị lặp câu hỏi hoặc không kết nối context.",
            },
            {
              score: "1–2",
              desc: "Thường xuyên không nhớ context, hội thoại rời rạc.",
            },
            {
              score: "0",
              desc: "Mỗi turn hoàn toàn độc lập, không có sự kết nối.",
            },
          ],
        },
        {
          code: "C3",
          name: "Tone & Encouragement",
          weight: "20%",
          desc: "Có thân thiện, động viên học sinh không? Khi học sinh sai có phản hồi tích cực và không phán xét không?",
          scale: [
            {
              score: "5",
              desc: "Tone nhất quán — ấm áp, khích lệ, không phán xét, phù hợp lứa tuổi học sinh.",
            },
            {
              score: "3–4",
              desc: "Phần lớn tốt, đôi khi hơi lạnh hoặc quá trang trọng.",
            },
            {
              score: "1–2",
              desc: "Tone khô khan hoặc có hàm ý phán xét khi học sinh trả lời sai.",
            },
            {
              score: "0",
              desc: "Không có bất kỳ yếu tố động viên nào, hoặc tone không phù hợp lứa tuổi.",
            },
          ],
        },
      ],
    },
    {
      group: "D",
      label: "Hallucination + Tốc độ",
      weight: "10%",
      color: "sky",
      textColor: "text-sky-700",
      bgColor: "bg-sky-50",
      borderColor: "border-sky-200",
      intro:
        "D1 đánh giá bịa đặt thông tin trong hội thoại. D2 đo latency. Cả hai đều qua judge trừ D2 tính từ timestamp thực.",
      criteria: [
        {
          code: "D1",
          name: "Hallucination Score",
          weight: "50%",
          desc: "Trong context hội thoại, hallucination không chỉ là sai fact mà còn là bịa ra context bài học, bịa lịch sử hội thoại trước, hoặc tự bịa câu trả lời của học sinh.",
          scale: [
            {
              score: "5",
              desc: "Không có bất kỳ nội dung bịa đặt nào trong toàn hội thoại.",
            },
            {
              score: "3–4",
              desc: "Có 1 chi tiết nhỏ không chắc chắn nhưng không gây hại.",
            },
            {
              score: "1–2",
              desc: "Bịa 1–2 thông tin cụ thể (tên, số liệu, sự kiện không có thật).",
            },
            {
              score: "0",
              desc: "Bịa context bài học, bịa câu trả lời của học sinh, hoặc sai fact nghiêm trọng.",
            },
          ],
        },
        {
          code: "D2",
          name: "Tốc độ phản hồi",
          weight: "50%",
          desc: "Đo latency trung bình mỗi turn trong quá trình replay. Không qua LLM judge — tính trực tiếp từ timestamp.",
          scale: [
            { score: "5", desc: "≤ 2,000ms trung bình" },
            { score: "4", desc: "2,000 – 4,000ms" },
            { score: "3", desc: "4,000 – 7,000ms" },
            { score: "2", desc: "7,000 – 12,000ms" },
            { score: "1", desc: "> 12,000ms" },
          ],
        },
      ],
    },
  ];

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-800 mb-2">
          Rubric chấm điểm — Socratic Tutor Evaluation
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          Hệ thống sử dụng <strong>LLM-as-Judge</strong> (Claude Sonnet) để chấm
          9 tiêu chí A1–D1 trên mỗi conversation. Judge đọc toàn bộ lịch sử hội
          thoại và cho điểm từng tiêu chí kèm lý giải. D2 tính độc lập từ
          latency đo thực tế.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "A · Socratic",
              weight: "40%",
              color: "bg-indigo-50 border-indigo-200 text-indigo-700",
            },
            {
              label: "B · Accuracy",
              weight: "25%",
              color: "bg-orange-50 border-orange-200 text-orange-700",
            },
            {
              label: "C · Pedagogy",
              weight: "25%",
              color: "bg-teal-50 border-teal-200 text-teal-700",
            },
            {
              label: "D · Hall+Speed",
              weight: "10%",
              color: "bg-sky-50 border-sky-200 text-sky-700",
            },
          ].map((g) => (
            <div
              key={g.label}
              className={`rounded-xl border px-4 py-3 ${g.color}`}
            >
              <div className="text-xs font-bold">{g.label}</div>
              <div className="text-2xl font-black mt-1">{g.weight}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xsfont-mono text-slate-600">
            Overall = A×0.40 + B×0.25 + C×0.25 + D×0.10
            &nbsp;&nbsp;|&nbsp;&nbsp; A = A1×0.5 + A2×0.3 + A3×0.2
            &nbsp;&nbsp;|&nbsp;&nbsp; B = B1×0.6 + B2×0.4
            &nbsp;&nbsp;|&nbsp;&nbsp; C = C1×0.4 + C2×0.4 + C3×0.2
            &nbsp;&nbsp;|&nbsp;&nbsp; D = D1×0.5 + D2×0.5
          </p>
        </div>
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
          <p className="text-xs text-red-700 font-semibold">
            ⚠ Hard constraint: Nếu A1 = 0 (model đưa đáp án trực tiếp) → toàn
            nhóm A bị cap ở 1.0, bất kể A2/A3 đạt bao nhiêu điểm.
          </p>
        </div>
      </div>

      {/* 4 nhóm */}
      {RUBRIC.map((g) => (
        <div
          key={g.group}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
        >
          {/* Group header */}
          <div className={`px-6 py-4 ${g.bgColor} border-b ${g.borderColor}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm font-bold ${g.textColor}`}>
                  Nhóm {g.group} · {g.label}
                </span>
                <span className="ml-3 text-xs text-slate-500">
                  Trọng số {g.weight}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {g.intro}
            </p>
          </div>

          {/* Criteria */}
          <div className="divide-y divide-slate-100">
            {g.criteria.map((c) => (
              <div key={c.code} className="px-6 py-5">
                <div className="flex items-start gap-3 mb-3">
                  <span
                    className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${g.bgColor} ${g.textColor} border ${g.borderColor}`}
                  >
                    {c.code}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {c.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        ({c.weight} trong nhóm {g.group})
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {c.desc}
                    </p>
                  </div>
                </div>

                {/* Scale table */}
                <div className="ml-10 grid grid-cols-1 gap-1.5">
                  {c.scale.map((s) => {
                    const scoreNum = parseFloat(s.score);
                    const bgClass =
                      scoreNum >= 5
                        ? "bg-emerald-50 border-emerald-100"
                        : scoreNum >= 3
                          ? "bg-amber-50 border-amber-100"
                          : scoreNum >= 1
                            ? "bg-red-50 border-red-100"
                            : "bg-red-100 border-red-200";
                    const textClass =
                      scoreNum >= 5
                        ? "text-emerald-700"
                        : scoreNum >= 3
                          ? "text-amber-700"
                          : "text-red-700";
                    return (
                      <div
                        key={s.score}
                        className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${bgClass}`}
                      >
                        <span
                          className={`shrink-0 text-xs font-black w-8 tabular-nums ${textClass}`}
                        >
                          {s.score}đ
                        </span>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {s.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompareTab({ data }: { data: EvaluationData }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE = 10;

  if (!data.delta || !data.baseSummary) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-16 text-center text-slate-400">
        <p className="font-medium">Không có dữ liệu so sánh</p>
        <p className="text-sm mt-1">Eval này chưa chạy paired mode.</p>
      </div>
    );
  }

  const max = data.summary.max_possible;
  const totalPages = Math.ceil(data.results.length / PAGE);
  const paginated = data.results.slice((page - 1) * PAGE, page * PAGE);

  const scoreColor = (v: number) =>
    v >= 4 ? 'text-emerald-700 font-bold' : v >= 2.5 ? 'text-amber-700 font-semibold' : 'text-red-600 font-semibold';

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">

      {/* Model labels */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Base Model</div>
          <div className="text-xs font-mono text-slate-600 truncate">{data.baseModelRepo ?? '—'}</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-1">Fine-tuned Model</div>
          <div className="text-xs font-mono text-indigo-700 truncate">{data.ftModelRepo ?? '—'}</div>
        </div>
      </div>

      {/* Delta summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Overall',      base: data.baseSummary.overall,  ft: data.summary.overall,  delta: data.delta.overall },
          { label: 'A · Socratic', base: data.baseSummary.group_a,  ft: data.summary.group_a,  delta: data.delta.group_a },
          { label: 'B · Accuracy', base: data.baseSummary.group_b,  ft: data.summary.group_b,  delta: data.delta.group_b },
          { label: 'C · Pedagogy', base: data.baseSummary.group_c,  ft: data.summary.group_c,  delta: data.delta.group_c },
          { label: 'D · Hall+Spd', base: data.baseSummary.group_d,  ft: data.summary.group_d,  delta: data.delta.group_d },
        ].map(({ label, base, ft, delta }) => {
          const pct = base > 0 ? (delta / base) * 100 : 0;
          const pos = delta >= 0;
          return (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{label}</div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className={`text-xl font-black ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                  {pos ? '+' : ''}{delta.toFixed(3)}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                {base.toFixed(2)} → <span className="font-semibold text-slate-600">{ft.toFixed(2)}</span>
              </div>
              <div className={`text-[10px] font-semibold mt-0.5 ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                {pos ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Criteria delta table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">Delta từng tiêu chí (A1–D2)</span>
          <span className="text-[10px] text-slate-400">FT − Base · thang 0–{max}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-left">Tiêu chí</th>
                <th className="px-4 py-2.5 text-center">Base</th>
                <th className="px-4 py-2.5 text-center">FT</th>
                <th className="px-4 py-2.5 text-center">Δ</th>
                <th className="px-4 py-2.5 text-left w-48">Thay đổi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {Object.keys(data.summary.criteria ?? {}).map(code => {
                const ftScore   = data.summary.criteria[code]            ?? 0;
                const baseScore = data.baseSummary!.criteria[code]       ?? 0;
                const d         = data.delta!.criteria[code]             ?? (ftScore - baseScore);
                const pos       = d >= 0;
                const barPct    = Math.abs(d) / max * 100;
                const gKey      = code[0] as keyof typeof GROUP_META;
                const gm        = GROUP_META[gKey] ?? GROUP_META.A;
                return (
                  <tr key={code} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <HoverTooltip text={`${CRITERIA_META[code]?.name} — ${CRITERIA_META[code]?.desc}`}>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-help ${gm.bg} ${gm.text} ${gm.border}`}>{code}</span>
                      </HoverTooltip>
                      <span className="ml-2 text-xs text-slate-500">{CRITERIA_META[code]?.name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-500">{baseScore.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-center text-xs tabular-nums font-semibold text-slate-700">{ftScore.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-center text-xs tabular-nums font-bold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pos ? '+' : ''}{d.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pos ? 'bg-emerald-400' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(barPct * 3, 100)}%` }} />
                        </div>
                        <span className={`text-[10px] font-semibold w-10 text-right ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                          {pos ? '+' : ''}{((d / max) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-conversation side-by-side */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-bold text-slate-700">So sánh từng conversation</h2>
          <span className="text-xs text-slate-400">— click để xem hội thoại song song</span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {paginated.map((r) => {
            const baseR = data.baseResults?.find(b => b.conv_index === r.conv_index);
            const isExp = expandedRow === r.conv_index;
            const ftOv  = r.group_scores?.overall ?? 0;
            const bsOv  = baseR?.group_scores?.overall ?? 0;
            const d     = ftOv - bsOv;
            const pos   = d >= 0;

            return (
              <div key={r.conv_index} className="border-b border-slate-100 last:border-0">
                {/* Row header */}
                <button
                  type="button"
                  onClick={() => setExpandedRow(isExp ? null : r.conv_index)}
                  className="w-full flex items-center gap-4 px-5 py-3 hover:bg-slate-50/60 text-left transition"
                >
                  <span className="text-xs text-slate-400 tabular-nums w-8">#{r.conv_index + 1}</span>
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xs text-slate-500">
                      Base: <span className="font-semibold tabular-nums text-slate-700">{bsOv.toFixed(2)}</span>
                    </span>
                    <span className="text-slate-300">→</span>
                    <span className="text-xs text-slate-500">
                      FT: <span className="font-semibold tabular-nums text-indigo-700">{ftOv.toFixed(2)}</span>
                    </span>
                    <span className={`text-xs font-bold tabular-nums ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                      ({pos ? '+' : ''}{d.toFixed(2)})
                    </span>
                  </div>
                  {/* Mini criteria comparison */}
                  <div className="hidden sm:flex items-center gap-2">
                    {['A1','A2','B1','C1','C2'].map(code => {
                      const fv = r.criteria_scores?.[code] ?? 0;
                      const bv = baseR?.criteria_scores?.[code] ?? 0;
                      const dv = fv - bv;
                      return (
                        <div key={code} className="text-center">
                          <div className="text-[9px] text-slate-400">{code}</div>
                          <div className={`text-[10px] font-bold tabular-nums ${dv > 0 ? 'text-emerald-600' : dv < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                            {dv > 0 ? '+' : ''}{dv.toFixed(1)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <svg className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded: side-by-side */}
                {isExp && (
                  <div className="px-5 pb-5 grid grid-cols-2 gap-4">
                    {/* Base */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Base model</span>
                        <span className={`text-xs font-bold tabular-nums ${scoreColor(bsOv)}`}>{bsOv.toFixed(2)}</span>
                      </div>
                      <div className="space-y-2 max-h-72 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                        {(baseR?.replay_turns ?? []).length > 0 ? (baseR?.replay_turns ?? []).map((t, ti) => (
                          <div key={ti} className="space-y-1.5">
                            <div className="flex gap-2">
                              <span className="shrink-0 text-[9px] font-bold text-blue-400 mt-1.5 w-5 text-right">HS</span>
                              <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[90%]">
                                <p className="text-[11px] text-slate-700 leading-relaxed">{t.user}</p>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-row-reverse">
                              <span className="shrink-0 text-[9px] font-bold text-slate-400 mt-1.5 w-5 text-left">GT</span>
                              <div className="bg-white border border-slate-200 rounded-xl rounded-tr-sm px-2.5 py-1.5 max-w-[90%]">
                                <p className="text-[11px] text-slate-700 leading-relaxed">{t.model}</p>
                                <p className="text-[9px] text-slate-400 mt-0.5 tabular-nums">{t.latency_ms?.toFixed(0)}ms</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <p className="text-[10px] text-slate-400 text-center py-4">Chưa có dữ liệu hội thoại</p>
                        )}
                      </div>
                    </div>

                    {/* FT */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Fine-tuned model</span>
                        <span className={`text-xs font-bold tabular-nums ${scoreColor(ftOv)}`}>{ftOv.toFixed(2)}</span>
                      </div>
                      <div className="space-y-2 max-h-72 overflow-y-auto border border-indigo-200 rounded-xl p-3 bg-indigo-50/30">
                        {(r.replay_turns ?? []).length > 0 ? (r.replay_turns ?? []).map((t, ti) => (
                          <div key={ti} className="space-y-1.5">
                            <div className="flex gap-2">
                              <span className="shrink-0 text-[9px] font-bold text-blue-400 mt-1.5 w-5 text-right">HS</span>
                              <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[90%]">
                                <p className="text-[11px] text-slate-700 leading-relaxed">{t.user}</p>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-row-reverse">
                              <span className="shrink-0 text-[9px] font-bold text-indigo-400 mt-1.5 w-5 text-left">GT</span>
                              <div className="bg-white border border-indigo-200 rounded-xl rounded-tr-sm px-2.5 py-1.5 max-w-[90%]">
                                <p className="text-[11px] text-slate-700 leading-relaxed">{t.model}</p>
                                <p className="text-[9px] text-slate-400 mt-0.5 tabular-nums">{t.latency_ms?.toFixed(0)}ms</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <p className="text-[10px] text-slate-400 text-center py-4">Chưa có dữ liệu hội thoại</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">Trang {page}/{totalPages} · {data.results.length} conversations</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-30 hover:border-slate-400 transition">Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-30 hover:border-slate-400 transition">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

export const ModelEvalResultScreen: React.FC = () => {
  const { evalId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [tablePage, setTablePage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [sampleTab, setSampleTab] = useState<"fail" | "pass">("fail");
  const [activeTab, setActiveTab] = useState<"ft" | "base" | "compare">("ft");
  const [rubricOpen, setRubricOpen] = useState(false);
  const [reviewState, setReviewState] = useState<
    Record<
      number,
      { verdict: "agree" | "disagree" | "skip"; note: string; saving: boolean }
    >
  >({});
  const [reviewerName, setReviewerName] = useState("");
  const [showReviewerInput, setShowReviewerInput] = useState(false);

  useEffect(() => {
    if (!evalId) return;
    fetch(`/api/model-eval/${evalId}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [evalId]);

  if (loading)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <svg
          className="w-8 h-8 animate-spin text-indigo-500 mb-3"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-sm text-slate-500">Đang tải kết quả…</p>
      </div>
    );

  if (!data)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500 font-medium">
          Không tìm thấy kết quả đánh giá
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl text-sm hover:bg-slate-700 transition"
        >
          Quay lại
        </button>
      </div>
    );

  // activeTab "base" swaps summary/results to base model data
  const activeResults = activeTab === "base"
    ? (data.baseResults ?? data.results)
    : data.results;
  const activeSummary = activeTab === "base"
    ? (data.baseSummary ?? data.summary)
    : data.summary;
  const max = activeSummary.max_possible ?? 5;
  const judgeLabel = data.judgeModel
    ? data.judgeModel.includes("sonnet")
      ? "Sonnet"
      : data.judgeModel.includes("haiku")
        ? "Haiku"
        : data.judgeModel.includes("opus")
          ? "Opus"
          : data.judgeModel
    : null;

  // Radar data
  const radarData = [
    { axis: "Socratic", value: activeSummary.group_a, fullMark: max },
    { axis: "Accuracy", value: activeSummary.group_b, fullMark: max },
    { axis: "Pedagogy", value: activeSummary.group_c, fullMark: max },
    { axis: "Hall+Speed", value: activeSummary.group_d, fullMark: max },
  ];

  // Criteria bar chart — map code → friendly label
  const criteriaChartData = Object.entries(activeSummary.criteria ?? {}).map(
    ([k, v]) => {
      const val = Number(v);
      return {
        name: k,
        fullName: CRITERIA_META[k]?.name ?? k,
        score: parseFloat(val.toFixed(2)),
        pct: parseFloat(((val / max) * 100).toFixed(1)),
      };
    },
  );

  // Sorted table
  const indexed = activeResults.map((r, i) => ({ ...r, _origIdx: i }));
  const sorted = [...indexed].sort((a, b) => {
    let v = 0;
    if (sortKey === "overall")
      v = (a.group_scores?.overall ?? 0) - (b.group_scores?.overall ?? 0);
    else if (sortKey === "group_a")
      v = (a.group_scores?.group_a ?? 0) - (b.group_scores?.group_a ?? 0);
    else if (sortKey === "group_b")
      v = (a.group_scores?.group_b ?? 0) - (b.group_scores?.group_b ?? 0);
    else if (sortKey === "latency")
      v = (a.avg_latency_ms ?? 0) - (b.avg_latency_ms ?? 0);
    else v = a._origIdx - b._origIdx;
    return sortDir === "asc" ? v : -v;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const paginated = sorted.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setTablePage(1);
  };
  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 text-[10px] opacity-50">
      {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  // A1 hard constraint triggered count
  const constraintCount = activeResults.filter(
    (r) => r.group_scores?.a1_hard_constraint_triggered,
  ).length;
  // Notable samples — top 3 fail và top 3 pass có replay_turns
  const failSamples = [...activeResults]
    .filter((r) => r.replay_turns && r.replay_turns.length > 0)
    .sort(
      (a, b) => (a.group_scores?.overall ?? 0) - (b.group_scores?.overall ?? 0),
    )
    .slice(0, 3);

  const passSamples = [...activeResults]
    .filter((r) => r.replay_turns && r.replay_turns.length > 0)
    .sort(
      (a, b) => (b.group_scores?.overall ?? 0) - (a.group_scores?.overall ?? 0),
    )
    .slice(0, 3);

  const hasReplayData = activeResults.some(
    (r) => r.replay_turns && r.replay_turns.length > 0,
  );

  const submitReview = async (
    convIndex: number,
    verdict: "agree" | "disagree" | "skip",
    note: string,
  ) => {
    setReviewState((prev) => ({
      ...prev,
      [convIndex]: { ...prev[convIndex], saving: true, verdict, note },
    }));
    try {
      const res = await fetch(`/api/model-eval/${evalId}/review/${convIndex}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict,
          note,
          reviewer: reviewerName || "anonymous",
        }),
      });
      if (!res.ok) throw new Error("Failed");
        await res.json();
      // Cập nhật local data
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          results: prev.results.map((r) =>
            r.conv_index === convIndex
              ? {
                  ...r,
                  human_review: {
                    verdict,
                    note,
                    reviewer: reviewerName || "anonymous",
                    reviewed_at: new Date().toISOString(),
                  },
                }
              : r,
          ),
        };
      });
    } catch {
      // revert
      setReviewState((prev) => ({
        ...prev,
        [convIndex]: { ...prev[convIndex], saving: false },
      }));
    } finally {
      setReviewState((prev) => ({
        ...prev,
        [convIndex]: { ...prev[convIndex], saving: false },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* ── Sticky header ── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div>
              <nav className="flex items-center gap-1 text-xs text-slate-400">
                <button
                  onClick={() => navigate("/model-eval/leaderboard")}
                  className="hover:text-slate-700 transition"
                >
                  Leaderboard
                </button>
                <span>/</span>
                <button
                  onClick={() => navigate(`/model-eval/history/${data.jobId}`)}
                  className="hover:text-slate-700 transition font-mono"
                >
                  {data.jobId.slice(0, 8)}…
                </button>
                <span>/</span>
                <span className="text-slate-600 font-medium">Kết quả</span>
              </nav>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-700">
                  {data.projectName ?? `Job ${data.jobId.slice(0, 8)}`}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-400">
                  {new Date(data.completedAt).toLocaleString("vi-VN")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.isPinned && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded-full">
                <svg
                  className="w-2.5 h-2.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17a1 1 0 11-2 0V5.477L6.237 7.082l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                </svg>
                Official
              </span>
            )}
            {judgeLabel && (
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full border border-slate-200">
                Judge: {judgeLabel}
              </span>
            )}
            <button
              onClick={() => navigate(`/model-eval/history/${data.jobId}`)}
              className="text-xs font-semibold text-blue-600 hover:underline transition"
            >
              Tất cả runs →
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar + Rubric button */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6 flex items-center justify-between">
          <div className="flex gap-0">
            <button
              type="button"
              onClick={() => setActiveTab("ft")}
              className={`px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px ${activeTab === "ft" ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}
            >
              Fine-tuned
            </button>
            {data.evalMode === "paired" && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab("base")}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px ${activeTab === "base" ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  Base model
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("compare")}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px ${activeTab === "compare" ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                >
                  So sánh Base vs FT
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setRubricOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            Rubric chấm điểm
          </button>
        </div>
      </div>

      {/* Rubric Modal */}
      {rubricOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-base font-bold text-slate-800">Rubric chấm điểm — Socratic Tutor Evaluation</h2>
              <button type="button" onClick={() => setRubricOpen(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto">
              <RubricTab />
            </div>
          </div>
        </div>
      )}

      {(activeTab === "ft" || activeTab === "base") ? (
        <div className="max-w-[1400px] mx-auto px-6 py-8 flex gap-8 items-start">
          {/* ── Sticky sidebar ── */}
          <aside className="hidden lg:flex flex-col gap-1 w-52 shrink-0 sticky top-28">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 mb-2">
              Điều hướng
            </p>
            {[
              { id: 'overview',      label: 'Tổng quan điểm số',     icon: '◎' },
              { id: 'criteria',      label: 'Chi tiết 9 tiêu chí',   icon: '▦' },
              { id: 'samples',       label: 'Mẫu fail / pass',        icon: '◈' },
              { id: 'conversations', label: 'Từng conversation',      icon: '☰' },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition group"
              >
                <span className="text-base text-slate-300 group-hover:text-slate-500 transition">
                  {icon}
                </span>
                <span className="leading-tight">{label}</span>
              </button>
            ))}

            <div className="border-t border-slate-100 mt-3 pt-3">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition w-full"
              >
                <span>↑</span>
                <span>Lên đầu trang</span>
              </button>
            </div>
          </aside>

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0 space-y-8">

            {/* ═══════════════════════════════════════════════════════
            ZONE 1 — Tổng quan điểm số
        ═══════════════════════════════════════════════════════ */}
            <section id="overview">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-slate-700">
                  Tổng quan điểm số
                </h2>
                <span className="text-xs text-slate-400">
                  — thang 0–{max}, đánh giá {data.totalConversations}{" "}
                  conversations
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Overall ring + radar */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center gap-4">
                  <div className="text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Overall Score
                    </div>
                    <ScoreRing
                      value={activeSummary.overall}
                      max={max}
                      label="Overall"
                      color="purple"
                    />
                    <p className="text-xs text-slate-500 mt-2 max-w-[160px] text-center leading-relaxed">
                      Tổng hợp từ 4 nhóm A·B·C·D theo trọng số
                    </p>
                  </div>
                  {constraintCount > 0 && (
                    <div className="w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-center">
                      <p className="text-[10px] text-red-700 font-semibold">
                        ⚠ {constraintCount} conversation vi phạm A1=0 (hard
                        constraint)
                      </p>
                      <p className="text-[10px] text-red-500 mt-0.5">
                        Nhóm A bị giới hạn ở 1.0 trong {constraintCount} trường
                        hợp
                      </p>
                    </div>
                  )}
                  {/* 4 rings nhóm */}
                  <div className="grid grid-cols-2 gap-3 w-full">
                    {[
                      {
                        key: "group_a",
                        val: activeSummary.group_a,
                        label: "A · Socratic",
                        color: "indigo",
                      },
                      {
                        key: "group_b",
                        val: activeSummary.group_b,
                        label: "B · Accuracy",
                        color: "orange",
                      },
                      {
                        key: "group_c",
                        val: activeSummary.group_c,
                        label: "C · Pedagogy",
                        color: "teal",
                      },
                      {
                        key: "group_d",
                        val: activeSummary.group_d,
                        label: "D · Hall+Spd",
                        color: "sky",
                      },
                    ].map((g) => (
                      <ScoreRing
                        key={g.key}
                        value={g.val}
                        max={max}
                        label={g.label}
                        color={g.color}
                      />
                    ))}
                  </div>
                </div>

                {/* Radar chart */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="text-xs font-semibold text-slate-500 mb-1">
                    Radar — 4 nhóm tiêu chí
                  </div>
                  <p className="text-[10px] text-slate-400 mb-3">
                    Mỗi trục là điểm trung bình của 1 nhóm tiêu chí
                  </p>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} outerRadius="70%">
                        <PolarGrid stroke="#E2E8F0" />
                        <PolarAngleAxis
                          dataKey="axis"
                          tick={{ fontSize: 11, fill: "#64748b" }}
                        />
                        <PolarRadiusAxis
                          domain={[0, max]}
                          tick={{ fontSize: 9 }}
                        />
                        <Radar
                          dataKey="value"
                          stroke="#6366F1"
                          fill="#6366F1"
                          fillOpacity={0.2}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Stats bên phải */}
                <div className="space-y-3">
                  {/* Latency */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Latency trung bình / turn
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-slate-800">
                        {activeSummary.avg_latency_ms?.toFixed(0) ?? "—"}
                      </span>
                      <span className="text-sm text-slate-400">ms</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${(activeSummary.avg_latency_ms ?? 0) <= 2000 ? "bg-emerald-400" : (activeSummary.avg_latency_ms ?? 0) <= 7000 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{
                          width: `${Math.min(((activeSummary.avg_latency_ms ?? 0) / 15000) * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {(activeSummary.avg_latency_ms ?? 0) <= 2000
                        ? "≤2s — 5đ (tốt nhất)"
                        : (activeSummary.avg_latency_ms ?? 0) <= 4000
                          ? "2–4s — 4đ"
                          : (activeSummary.avg_latency_ms ?? 0) <= 7000
                            ? "4–7s — 3đ"
                            : (activeSummary.avg_latency_ms ?? 0) <= 12000
                              ? "7–12s — 2đ"
                              : ">12s — 1đ"}
                    </p>
                  </div>

                  {/* Confidence */}
                  {activeSummary.avg_confidence != null && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Judge Confidence
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span
                          className={`text-2xl font-bold ${
                            activeSummary.avg_confidence >= 0.8
                              ? "text-emerald-700"
                              : activeSummary.avg_confidence >= 0.6
                                ? "text-amber-700"
                                : "text-red-600"
                          }`}
                        >
                          {(activeSummary.avg_confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-sm text-slate-400">avg</span>
                      </div>
                      <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            activeSummary.avg_confidence >= 0.8
                              ? "bg-emerald-400"
                              : activeSummary.avg_confidence >= 0.6
                                ? "bg-amber-400"
                                : "bg-red-400"
                          }`}
                          style={{
                            width: `${activeSummary.avg_confidence * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                        {(activeSummary.low_confidence_count ?? 0) > 0
                          ? `${activeSummary.low_confidence_count} conversation có điểm phân tán cao — judge có thể không nhất quán`
                          : "Điểm các tiêu chí đồng đều — judge nhất quán"}
                      </p>
                      <p className="text-[10px] text-slate-300 mt-1 italic">
                        Tính từ độ lệch chuẩn giữa các tiêu chí trong cùng nhóm
                      </p>
                    </div>
                  )}

                  {/* Non-scoring metrics */}
                  {activeSummary.non_scoring && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Metric tham chiếu
                      </div>
                      <p className="text-[10px] text-slate-400 italic mb-3">
                        Không tính vào điểm — chỉ để theo dõi xu hướng
                      </p>
                      <div className="space-y-2">
                        {[
                          {
                            label: "BLEU-4",
                            val: activeSummary.non_scoring.bleu,
                            note: "n-gram overlap (thấp với tiếng Việt là bình thường)",
                          },
                          {
                            label: "ROUGE-L",
                            val: activeSummary.non_scoring.rouge_l,
                            note: "Longest common subsequence",
                          },
                          {
                            label: "Question Rate",
                            val: activeSummary.non_scoring
                              .question_detection_rate,
                            note: "% turn kết thúc bằng câu hỏi",
                          },
                        ].map((m) => (
                          <div key={m.label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <HoverTooltip text={m.note}>
                                <span className="text-xs text-slate-600 flex items-center gap-1 cursor-help">
                                  {m.label} <InfoIcon />
                                </span>
                              </HoverTooltip>
                              <span className="text-xs font-semibold tabular-nums text-slate-700">
                                {m.val.toFixed(3)}
                              </span>
                            </div>
                            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-slate-400 rounded-full"
                                style={{
                                  width: `${Math.min(m.val * 100, 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
            {/* Review progress banner */}
            {(() => {
              const total = activeResults.length;
              const reviewed = activeResults.filter(
                (r) => r.human_review,
              ).length;
              const agreed = activeResults.filter(
                (r) => r.human_review?.verdict === "agree",
              ).length;
              const disagreed = activeResults.filter(
                (r) => r.human_review?.verdict === "disagree",
              ).length;
              const agreementRate =
                reviewed -
                activeResults.filter((r) => r.human_review?.verdict === "skip")
                  .length;
              const agrPct =
                agreementRate > 0
                  ? Math.round((agreed / agreementRate) * 100)
                  : null;

              return (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-6 flex-wrap">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Human Review
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-slate-800">
                        {reviewed}
                      </span>
                      <span className="text-sm text-slate-400">/ {total}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      conversations đã review
                    </div>
                  </div>

                  <div className="h-10 w-px bg-slate-100 hidden sm:block" />

                  <div className="flex gap-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-emerald-600">
                        {agreed}
                      </div>
                      <div className="text-[10px] text-slate-400">Đồng ý</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-red-500">
                        {disagreed}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Không đồng ý
                      </div>
                    </div>
                    {agrPct !== null && (
                      <div className="text-center">
                        <div
                          className={`text-lg font-bold ${agrPct >= 70 ? "text-emerald-600" : agrPct >= 50 ? "text-amber-600" : "text-red-500"}`}
                        >
                          {agrPct}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Agreement rate
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="h-10 w-px bg-slate-100 hidden sm:block" />

                  {/* Reviewer name */}
                  <div className="flex items-center gap-2 ml-auto">
                    {showReviewerInput ? (
                      <input
                        autoFocus
                        value={reviewerName}
                        onChange={(e) => setReviewerName(e.target.value)}
                        onBlur={() => setShowReviewerInput(false)}
                        placeholder="Tên reviewer..."
                        className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-400 w-36"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowReviewerInput(true)}
                        className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
                      >
                        {reviewerName
                          ? `👤 ${reviewerName}`
                          : "Đặt tên reviewer"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ═══════════════════════════════════════════════════════
              ZONE 2 — Chi tiết 9 tiêu chí
          ═══════════════════════════════════════════════════════ */}
            <section id="criteria">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-slate-700">
                  Chi tiết 9 tiêu chí (A1–D1)
                </h2>
                <span className="text-xs text-slate-400">
                  — điểm trung bình trên tất cả conversations
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Hover vào badge tiêu chí để xem mô tả. Thanh màu phản ánh mức
                độ:{" "}
                <span className="text-emerald-600 font-semibold">xanh ≥4</span>,{" "}
                <span className="text-amber-600 font-semibold">vàng ≥2.5</span>,{" "}
                <span className="text-red-600 font-semibold">đỏ &lt;2.5</span>.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(["A", "B", "C", "D"] as const).map((gKey) => {
                  const gm = GROUP_META[gKey];
                  const codes = Object.keys(CRITERIA_META).filter((k) =>
                    k.startsWith(gKey),
                  );
                  const groupScore =
                    data.summary[
                      `group_${gKey.toLowerCase()}` as
                        | "group_a"
                        | "group_b"
                        | "group_c"
                        | "group_d"
                    ];
                  return (
                    <div
                      key={gKey}
                      className={`bg-white rounded-2xl border shadow-sm overflow-hidden`}
                    >
                      {/* Group header */}
                      <div
                        className={`px-5 py-3 border-b ${gm.bg} ${gm.border} flex items-center justify-between`}
                      >
                        <div>
                          <span className={`text-sm font-bold ${gm.text}`}>
                            {gm.label}
                          </span>
                          <span className="text-xs text-slate-400 ml-2">
                            Trọng số {gm.weight}
                          </span>
                        </div>
                        <div className={`text-lg font-black ${gm.text}`}>
                          {groupScore.toFixed(2)}
                          <span className="text-xs font-normal text-slate-400">
                            /{max}
                          </span>
                        </div>
                      </div>

                      {/* Criteria */}
                      <div className="px-5 py-3">
                        {codes.map((code) => {
                          const score = activeSummary.criteria?.[code] ?? 0;
                          // Lấy reason tổng hợp từ conversation đầu tiên (nếu có)
                          // const sampleReason = data.results[0]?.criteria_reasons?.[`${code.toLowerCase()}_${CRITERIA_META[code]?.name.toLowerCase().replace(/ /g, '_')}`] ?? '';
                          const barColor =
                            score >= 4
                              ? "bg-emerald-400"
                              : score >= 2.5
                                ? "bg-amber-400"
                                : "bg-red-400";
                          return (
                            <div
                              key={code}
                              className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0"
                            >
                              <HoverTooltip
                                text={`${CRITERIA_META[code]?.name} (${CRITERIA_META[code]?.weight}) — ${CRITERIA_META[code]?.desc}`}
                              >
                                <span
                                  className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${gm.bg} ${gm.text} border ${gm.border} cursor-help`}
                                >
                                  {code}
                                </span>
                              </HoverTooltip>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${barColor}`}
                                      style={{
                                        width: `${(score / max) * 100}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-xs font-bold tabular-nums text-slate-700 w-8 text-right">
                                    {score.toFixed(2)}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  {CRITERIA_META[code]?.name}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        {gKey === "A" && (
                          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                            <p className="text-[10px] text-amber-700">
                              <strong>Hard constraint:</strong> Nếu A1 = 0 →
                              toàn nhóm A bị cap ở 1.0, bất kể A2/A3 đạt bao
                              nhiêu.
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
                <div className="text-xs font-semibold text-slate-500 mb-1">
                  So sánh trực quan 9 tiêu chí
                </div>
                <p className="text-[10px] text-slate-400 mb-4">
                  Hover vào cột để xem điểm số cụ thể
                </p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={criteriaChartData}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#F1F5F9"
                      />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "#64748B" }}
                      />
                      <YAxis
                        domain={[0, max]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#94A3B8" }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null;
                          const d = payload[0].payload;
                          const meta = CRITERIA_META[d.name];
                          return (
                            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-xs max-w-[200px]">
                              <div className="font-bold text-slate-800">
                                {d.name} — {meta?.name}
                              </div>
                              <div className="text-indigo-600 font-semibold mt-0.5">
                                {d.score}/{max}
                              </div>
                              {meta && (
                                <div className="text-slate-500 mt-1 leading-relaxed">
                                  {meta.desc}
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="score"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      >
                        {criteriaChartData.map((entry, i) => {
                          const gKey = entry.name[0];
                          const colors: Record<string, string> = {
                            A: "#6366F1",
                            B: "#EA580C",
                            C: "#0F766E",
                            D: "#0284C7",
                          };
                          return (
                            <Cell key={i} fill={colors[gKey] ?? "#8B5CF6"} />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* ═══════════════════════════════════════════════════════
              ZONE 2.5 — Sample fail / pass conversations
          ═══════════════════════════════════════════════════════ */}
            {hasReplayData && (
              <section id="samples">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-base font-bold text-slate-700">
                    Mẫu hội thoại thực tế
                  </h2>
                  <span className="text-xs text-slate-400">
                    — để đối chiếu với điểm số của judge
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Xem nội dung hội thoại model đã trả lời trong lúc eval. Dùng
                  để kiểm tra xem judge có chấm hợp lý không — đây là phần quan
                  trọng nhất để xác nhận độ tin cậy.
                </p>

                {/* Tab fail / pass */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-4">
                  <button
                    type="button"
                    onClick={() => setSampleTab("fail")}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${sampleTab === "fail" ? "bg-white text-red-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                    Fail thấp nhất ({failSamples.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSampleTab("pass")}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${sampleTab === "pass" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    Pass cao nhất ({passSamples.length})
                  </button>
                </div>

                <div className="space-y-4">
                  {(sampleTab === "fail" ? failSamples : passSamples).map(
                    (r) => {
                      const ov = r.group_scores?.overall ?? 0;
                      const constraint =
                        r.group_scores?.a1_hard_constraint_triggered;
                      const isFail = sampleTab === "fail";
                      const borderColor = isFail
                        ? "border-red-200"
                        : "border-emerald-200";
                      const headerBg = isFail ? "bg-red-50" : "bg-emerald-50";
                      const scoreColor = isFail
                        ? "text-red-700"
                        : "text-emerald-700";

                      return (
                        <div
                          key={r.conv_index}
                          className={`bg-white rounded-2xl border ${borderColor} shadow-sm overflow-hidden`}
                        >
                          {/* Header */}
                          <div
                            className={`px-5 py-3 ${headerBg} border-b ${borderColor} flex items-center justify-between`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold text-slate-500">
                                Conv #{r.conv_index + 1}
                              </span>
                              <span
                                className={`text-base font-black tabular-nums ${scoreColor}`}
                              >
                                {ov.toFixed(3)}
                                <span className="text-xs font-normal text-slate-400">
                                  /{activeSummary.max_possible}
                                </span>
                              </span>
                              {constraint && (
                                <span className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full border border-red-200">
                                  A1=0 · Hard constraint
                                </span>
                              )}
                            </div>
                            {/* Mini scores */}
                            <div className="flex items-center gap-3 text-[10px]">
                              {[
                                {
                                  label: "A",
                                  val: r.group_scores?.group_a,
                                  color: "text-indigo-600",
                                },
                                {
                                  label: "B",
                                  val: r.group_scores?.group_b,
                                  color: "text-orange-600",
                                },
                                {
                                  label: "C",
                                  val: r.group_scores?.group_c,
                                  color: "text-teal-600",
                                },
                                {
                                  label: "D",
                                  val: r.group_scores?.group_d,
                                  color: "text-sky-600",
                                },
                              ].map((g) => (
                                <span
                                  key={g.label}
                                  className={`font-semibold ${g.color}`}
                                >
                                  {g.label}:{g.val?.toFixed(1) ?? "—"}
                                </span>
                              ))}
                              <span className="text-slate-400">
                                {r.avg_latency_ms?.toFixed(0)}ms
                              </span>
                              <span className="text-slate-400">
                                {r.num_turns} turns
                              </span>
                            </div>
                          </div>

                          {/* Conversation turns */}
                          <div className="px-5 py-4">
                            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                              {(r.replay_turns ?? []).map((turn, ti) => (
                                <div key={ti} className="space-y-1.5">
                                  {/* User */}
                                  <div className="flex gap-2">
                                    <span className="shrink-0 text-[9px] font-bold text-blue-400 mt-1.5 w-5 text-right">
                                      HS
                                    </span>
                                    <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                      <p className="text-xs text-slate-700 leading-relaxed">
                                        {turn.user}
                                      </p>
                                    </div>
                                  </div>
                                  {/* Model */}
                                  <div className="flex gap-2 flex-row-reverse">
                                    <span className="shrink-0 text-[9px] font-bold text-purple-400 mt-1.5 w-5 text-left">
                                      GT
                                    </span>
                                    <div className="bg-purple-50 border border-purple-100 rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                      <p className="text-xs text-slate-700 leading-relaxed">
                                        {turn.model}
                                      </p>
                                      <p className="text-[9px] text-slate-400 mt-1 tabular-nums">
                                        {turn.latency_ms?.toFixed(0)}ms
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Judge reasons cho conv này */}
                            {Object.keys(r.criteria_reasons ?? {}).length >
                              0 && (
                              <div className="mt-4 pt-3 border-t border-slate-100">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                  Lý do judge
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                                  {Object.entries(r.criteria_reasons).map(
                                    ([key, reason]) => {
                                      const code = key
                                        .split("_")[0]
                                        .toUpperCase();
                                      const score = r.criteria_scores?.[code];
                                      const gKey =
                                        code[0] as keyof typeof GROUP_META;
                                      const gm =
                                        GROUP_META[gKey] ?? GROUP_META.A;
                                      if (!reason) return null;
                                      return (
                                        <div
                                          key={key}
                                          className="flex items-start gap-1.5 py-1"
                                        >
                                          <HoverTooltip
                                            text={
                                              CRITERIA_META[code]?.desc ?? key
                                            }
                                          >
                                            <span
                                              className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${gm.bg} ${gm.text} border ${gm.border} cursor-help`}
                                            >
                                              {code}
                                            </span>
                                          </HoverTooltip>
                                          <div className="flex-1 min-w-0">
                                            {score != null && (
                                              <span
                                                className={`text-[10px] font-bold mr-1 ${score >= 4 ? "text-emerald-600" : score >= 2.5 ? "text-amber-600" : "text-red-600"}`}
                                              >
                                                {score}/5
                                              </span>
                                            )}
                                            <span className="text-[10px] text-slate-500 leading-relaxed">
                                              {reason}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    },
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>

                {/* Note nếu chưa có replay data */}
                {(sampleTab === "fail" ? failSamples : passSamples).length ===
                  0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                    Không có dữ liệu hội thoại. Eval này chạy trước khi tính
                    năng lưu turns được bật — cần chạy eval mới để xem mẫu.
                  </div>
                )}
              </section>
            )}

            {/* ═══════════════════════════════════════════════════════
              ZONE 3 — Per-conversation breakdown
          ═══════════════════════════════════════════════════════ */}
            <section id="conversations">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-bold text-slate-700">
                  Kết quả từng conversation
                </h2>
                <span className="text-xs text-slate-400">
                  — {sorted.length} conversations · click để xem chi tiết tiêu
                  chí
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Mỗi hàng là 1 cuộc hội thoại được model replay lại. Điểm Overall
                tính theo công thức có trọng số. Badge đỏ <strong>A1=0</strong>{" "}
                nghĩa là conversation này vi phạm hard constraint.
              </p>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-200">
                      <tr>
                        <th
                          className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none"
                          onClick={() => handleSort("index")}
                        >
                          # <SortIcon k="index" />
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none text-center"
                          onClick={() => handleSort("overall")}
                        >
                          Overall <SortIcon k="overall" />
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:text-indigo-600 select-none text-center text-indigo-500"
                          onClick={() => handleSort("group_a")}
                        >
                          A · Socratic <SortIcon k="group_a" />
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:text-orange-600 select-none text-center text-orange-500"
                          onClick={() => handleSort("group_b")}
                        >
                          B · Accuracy <SortIcon k="group_b" />
                        </th>
                        <th className="px-4 py-3 text-center text-teal-500">
                          C · Pedagogy
                        </th>
                        <th className="px-4 py-3 text-center text-sky-500">
                          D · Hall+Spd
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:text-slate-700 select-none text-center"
                          onClick={() => handleSort("latency")}
                        >
                          Latency <SortIcon k="latency" />
                        </th>
                        <th className="px-4 py-3 text-center text-slate-400">
                          Turns
                        </th>
                        <th className="px-4 py-3 text-center text-slate-400">
                          Confidence
                        </th>
                        <th className="px-4 py-3 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((r) => {
                        const ov = r.group_scores?.overall ?? 0;
                        const ga = r.group_scores?.group_a ?? 0;
                        const gb = r.group_scores?.group_b ?? 0;
                        const gc = r.group_scores?.group_c ?? 0;
                        const gd = r.group_scores?.group_d ?? 0;
                        const constraint =
                          r.group_scores?.a1_hard_constraint_triggered;
                        const isExpanded = expandedRow === r.conv_index;

                        const scoreColor = (v: number) =>
                          v >= 4
                            ? "text-emerald-700 font-bold"
                            : v >= 2.5
                              ? "text-amber-700 font-semibold"
                              : "text-red-600 font-semibold";

                        return (
                          <React.Fragment key={r.conv_index}>
                            <tr
                              className={`border-b border-slate-100 cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/60"}`}
                              onClick={() =>
                                setExpandedRow(isExpanded ? null : r.conv_index)
                              }
                            >
                              <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">
                                {r.conv_index + 1}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <span
                                    className={`text-sm tabular-nums ${scoreColor(ov)}`}
                                  >
                                    {ov.toFixed(3)}
                                  </span>
                                  {constraint && (
                                    <HoverTooltip text="A1=0: model đã đưa đáp án trực tiếp — nhóm A bị giới hạn ở 1.0">
                                      <span className="text-[9px] bg-red-100 text-red-600 font-bold px-1 py-0.5 rounded cursor-help">
                                        A1=0
                                      </span>
                                    </HoverTooltip>
                                  )}
                                </div>
                              </td>
                              <td
                                className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(ga)}`}
                              >
                                {ga.toFixed(2)}
                              </td>
                              <td
                                className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gb)}`}
                              >
                                {gb.toFixed(2)}
                              </td>
                              <td
                                className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gc)}`}
                              >
                                {gc.toFixed(2)}
                              </td>
                              <td
                                className={`px-4 py-3 text-center text-xs tabular-nums ${scoreColor(gd)}`}
                              >
                                {gd.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-500">
                                {r.avg_latency_ms?.toFixed(0)}ms
                              </td>
                              <td className="px-4 py-3 text-center text-xs text-slate-400">
                                {r.num_turns}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {r.confidence != null ? (
                                  <HoverTooltip
                                    text={`Độ nhất quán của judge: A=${((r.confidence.by_group?.A ?? 0) * 100).toFixed(0)}% B=${((r.confidence.by_group?.B ?? 0) * 100).toFixed(0)}% C=${((r.confidence.by_group?.C ?? 0) * 100).toFixed(0)}% D=${((r.confidence.by_group?.D ?? 0) * 100).toFixed(0)}%`}
                                  >
                                    <span
                                      className={`text-xs font-semibold tabular-nums cursor-help ${
                                        r.confidence.overall >= 0.8
                                          ? "text-emerald-600"
                                          : r.confidence.overall >= 0.6
                                            ? "text-amber-600"
                                            : "text-red-500"
                                      }`}
                                    >
                                      {(r.confidence.overall * 100).toFixed(0)}%
                                      {r.confidence.is_low && (
                                        <span className="ml-1">⚠</span>
                                      )}
                                    </span>
                                  </HoverTooltip>
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <svg
                                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 9l-7 7-7-7"
                                  />
                                </svg>
                              </td>
                            </tr>

                            {/* Expanded: chi tiết 9 tiêu chí + reasons */}
                            {isExpanded && (
                              <tr className="bg-slate-50/80">
                                <td colSpan={9} className="px-6 py-4">
                                  {/* Nội dung hội thoại */}
                                  {r.replay_turns &&
                                    r.replay_turns.length > 0 && (
                                      <div className="mb-5">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                          Nội dung hội thoại (
                                          {r.replay_turns.length} turns)
                                        </div>
                                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1 border border-slate-200 rounded-xl p-3 bg-white">
                                          {r.replay_turns.map((turn, ti) => (
                                            <div
                                              key={ti}
                                              className="space-y-1.5"
                                            >
                                              <div className="flex gap-2">
                                                <span className="shrink-0 text-[9px] font-bold text-blue-400 mt-1.5 w-5 text-right">
                                                  HS
                                                </span>
                                                <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                                  <p className="text-xs text-slate-700 leading-relaxed">
                                                    {turn.user}
                                                  </p>
                                                </div>
                                              </div>
                                              <div className="flex gap-2 flex-row-reverse">
                                                <span className="shrink-0 text-[9px] font-bold text-purple-400 mt-1.5 w-5 text-left">
                                                  GT
                                                </span>
                                                <div className="bg-purple-50 border border-purple-100 rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                                  <p className="text-xs text-slate-700 leading-relaxed">
                                                    {turn.model}
                                                  </p>
                                                  <p className="text-[9px] text-slate-400 mt-1 tabular-nums">
                                                    {turn.latency_ms?.toFixed(
                                                      0,
                                                    )}
                                                    ms
                                                  </p>
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                                    {(["A", "B", "C", "D"] as const).map(
                                      (gKey) => {
                                        const gm = GROUP_META[gKey];
                                        const codes = Object.keys(
                                          CRITERIA_META,
                                        ).filter((k) => k.startsWith(gKey));
                                        return (
                                          <div key={gKey} className="mb-3">
                                            <div
                                              className={`text-[10px] font-bold uppercase tracking-wider ${gm.text} mb-1.5`}
                                            >
                                              {gm.label}
                                            </div>
                                            {codes.map((code) => {
                                              const score =
                                                r.criteria_scores?.[code] ?? 0;
                                              // reason key dạng "A1_answer_withholding"
                                              const reasonKey = Object.keys(
                                                r.criteria_reasons ?? {},
                                              ).find((k) => k.startsWith(code));
                                              const reason = reasonKey
                                                ? r.criteria_reasons[reasonKey]
                                                : "";
                                              return (
                                                <CriteriaRow
                                                  key={code}
                                                  code={code}
                                                  score={score}
                                                  reason={reason}
                                                />
                                              );
                                            })}
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                  {/* Human Review */}
                                  <div className="mt-4 pt-3 border-t border-slate-200">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                      Human Review
                                    </div>
                                    {r.human_review ? (
                                      <div className="flex items-center gap-3 flex-wrap">
                                        <span
                                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                                            r.human_review.verdict === "agree"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                              : r.human_review.verdict ===
                                                  "disagree"
                                                ? "bg-red-50 text-red-700 border-red-200"
                                                : "bg-slate-50 text-slate-500 border-slate-200"
                                          }`}
                                        >
                                          {r.human_review.verdict === "agree"
                                            ? "✓ Đồng ý với judge"
                                            : r.human_review.verdict ===
                                                "disagree"
                                              ? "✗ Không đồng ý"
                                              : "— Bỏ qua"}
                                        </span>
                                        {r.human_review.note && (
                                          <span className="text-xs text-slate-500 italic">
                                            "{r.human_review.note}"
                                          </span>
                                        )}
                                        <span className="text-[10px] text-slate-400">
                                          {r.human_review.reviewer} ·{" "}
                                          {new Date(
                                            r.human_review.reviewed_at,
                                          ).toLocaleString("vi-VN")}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReviewState((prev) => ({
                                              ...prev,
                                              [r.conv_index]: {
                                                verdict:
                                                  r.human_review!.verdict,
                                                note:
                                                  r.human_review!.note ?? "",
                                                saving: false,
                                              },
                                            }))
                                          }
                                          className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                                        >
                                          Sửa
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          {(
                                            [
                                              "agree",
                                              "disagree",
                                              "skip",
                                            ] as const
                                          ).map((v) => (
                                            <button
                                              key={v}
                                              type="button"
                                              disabled={
                                                reviewState[r.conv_index]
                                                  ?.saving
                                              }
                                              onClick={() => {
                                                const note =
                                                  reviewState[r.conv_index]
                                                    ?.note ?? "";
                                                submitReview(
                                                  r.conv_index,
                                                  v,
                                                  note,
                                                );
                                              }}
                                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition disabled:opacity-50 ${
                                                v === "agree"
                                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                                  : v === "disagree"
                                                    ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                                    : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                                              }`}
                                            >
                                              {reviewState[r.conv_index]?.saving
                                                ? "…"
                                                : v === "agree"
                                                  ? "✓ Đồng ý"
                                                  : v === "disagree"
                                                    ? "✗ Không đồng ý"
                                                    : "— Bỏ qua"}
                                            </button>
                                          ))}
                                        </div>
                                        <input
                                          type="text"
                                          placeholder="Ghi chú (tuỳ chọn)..."
                                          value={
                                            reviewState[r.conv_index]?.note ??
                                            ""
                                          }
                                          onChange={(e) =>
                                            setReviewState((prev) => ({
                                              ...prev,
                                              [r.conv_index]: {
                                                ...prev[r.conv_index],
                                                note: e.target.value,
                                                verdict:
                                                  prev[r.conv_index]?.verdict ??
                                                  "skip",
                                                saving: false,
                                              },
                                            }))
                                          }
                                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-400 transition"
                                        />
                                      </div>
                                    )}
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
                    <p className="text-xs text-slate-400">
                      Trang {safePage}/{totalPages} · {sorted.length}{" "}
                      conversations
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 19l-7-7 7-7"
                          />
                        </svg>
                      </button>
                      {Array.from(
                        { length: Math.min(totalPages, 5) },
                        (_, i) => {
                          const pg =
                            Math.max(
                              1,
                              Math.min(safePage - 2, totalPages - 4),
                            ) + i;
                          return (
                            <button
                              key={pg}
                              onClick={() => setTablePage(pg)}
                              className={`w-8 h-8 text-xs rounded-lg border transition ${pg === safePage ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                            >
                              {pg}
                            </button>
                          );
                        },
                      )}
                      <button
                        onClick={() =>
                          setTablePage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={safePage === totalPages}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : activeTab === "compare" ? (
        <CompareTab data={data} />
      ) : null}
    </div>
  );
};