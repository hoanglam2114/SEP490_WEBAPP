import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const FLAG_META: Record<
  string,
  { label: string; color: string; title: string }
> = {
  high_constraint_violation_rate: {
    label: "A1 vi phạm nhiều",
    color: "bg-red-100 text-red-700 border-red-200",
    title:
      "Hơn 30% conversations model đưa đáp án trực tiếp — vi phạm hard constraint Socratic",
  },
  high_score_variance: {
    label: "Điểm không ổn định",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    title:
      "Độ lệch chuẩn điểm overall > 1.2 — model hoạt động rất khác nhau giữa các conversations",
  },
  very_low_overall: {
    label: "Điểm tổng thấp",
    color: "bg-red-100 text-red-700 border-red-200",
    title:
      "Overall trung bình < 1.5/5 — cần review lại training data hoặc hyperparameter",
  },
  low_judge_confidence: {
    label: "Judge không nhất quán",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    title:
      "Confidence trung bình < 60% — điểm các tiêu chí trong cùng nhóm chênh lệch cao",
  },
  high_latency: {
    label: "Latency cao",
    color: "bg-slate-100 text-slate-600 border-slate-200",
    title:
      "Latency trung bình > 10s/turn — ảnh hưởng trải nghiệm người dùng thực tế",
  },
  socratic_underperforming: {
    label: "Socratic yếu",
    color: "bg-orange-100 text-orange-700 border-orange-200",
    title:
      "Nhóm A (Socratic) < 2.0 trong khi B/C > 3.5 — model biết nội dung nhưng không dạy đúng phương pháp",
  },
};

interface ModelScores {
  overall: number | null;
  group_a: number | null;
  group_b: number | null;
  group_c: number | null;
  group_d: number | null;
  criteria: Record<string, number> | null;
  avg_latency_ms: number | null;
  non_scoring: {
    bleu: number;
    rouge_l: number;
    question_detection_rate: number;
  } | null;
}

interface ModelItem {
  jobId: string;
  projectName: string;
  baseModel: string;
  completedAt: string;
  trainingDuration: number;
  modelEvalId: string | null;
  evalId?: string | null;
  pinnedEvalId: string | null;
  judgeModel: string | null;
  totalConversations: number;
  scores: ModelScores;
  flags?: string[];
}

function resolveEvalId(m: ModelItem): string | null {
  return m.modelEvalId ?? m.evalId ?? m.pinnedEvalId ?? null;
}

type SortField = "overall" | "quality" | "hallucination" | "speed";
type SortDir = "desc" | "asc";

function ScorePill({
  value,
  min,
  max,
}: {
  value: number | null;
  min: number;
  max: number;
}) {
  if (value == null || !isFinite(value))
    return <span className="text-slate-300 text-xs">—</span>;
  const range = max - min;
  const pct = range > 0 ? (value - min) / range : 0;
  const color =
    pct >= 0.7
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : pct >= 0.5
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-red-700 bg-red-50 border-red-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${color}`}
    >
      {value.toFixed(2)}
    </span>
  );
}

function judgeShort(m: string | null) {
  if (!m) return null;
  if (m.includes("haiku")) return "Haiku";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("opus")) return "Opus";
  return m.split("-")[0];
}

const MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

const SORT_OPTIONS = [
  { field: "overall" as SortField, label: "Overall" },
  { field: "quality" as SortField, label: "Socratic" },
  { field: "hallucination" as SortField, label: "Accuracy" },
  { field: "speed" as SortField, label: "Reliability" },
];

function getSortValue(m: ModelItem, field: SortField): number {
  switch (field) {
    case "overall":
      return m.scores.overall ?? -Infinity;
    case "quality":
      return m.scores.group_a ?? -Infinity;
    case "hallucination":
      return m.scores.group_b ?? -Infinity;
    case "speed":
      return m.scores.group_d ?? -Infinity;
  }
}

export const ModelEvalLeaderboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterModel, setFilterModel] = useState("");
  const [sortField, setSortField] = useState<SortField>("overall");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [baseModelOptions, setBaseModelOptions] = useState<string[]>([]);
  const PAGE_SIZE = 10;
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    fetch("/api/model-eval/leaderboard")
      .then((r) => r.json())
      .then((data: ModelItem[]) => {
        setModels(data);
        const unique = Array.from(new Set(data.map((m) => m.baseModel))).filter(
          Boolean,
        );
        setBaseModelOptions(unique);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterModel, sortField, sortDir]);

  const filteredModels = models
    .filter((m) => !filterModel || m.baseModel === filterModel)
    .sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      return sortDir === "desc" ? vb - va : va - vb;
    });

  const totalPages = Math.ceil(filteredModels.length / PAGE_SIZE);
  const paginatedModels = filteredModels.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const safe = (arr: number[]) => (arr.length ? arr : [0]);
  const overallScores = safe(
    filteredModels.map((m) => m.scores.overall ?? 0).filter((v) => v > 0),
  );
  const qualityScores = safe(
    filteredModels.map((m) => m.scores.group_a ?? 0).filter((v) => v > 0),
  );
  const accuracyScores = safe(
    filteredModels.map((m) => m.scores.group_b ?? 0).filter((v) => v > 0),
  );
  const pedagogyScores = safe(
    filteredModels.map((m) => m.scores.group_c ?? 0).filter((v) => v > 0),
  );
  const speedScores = safe(
    filteredModels.map((m) => m.scores.group_d ?? 0).filter((v) => v > 0),
  );

  const [overallMin, overallMax] = [
    Math.min(...overallScores),
    Math.max(...overallScores),
  ];
  const [qualityMin, qualityMax] = [
    Math.min(...qualityScores),
    Math.max(...qualityScores),
  ];
  const [accuracyMin, accuracyMax] = [
    Math.min(...accuracyScores),
    Math.max(...accuracyScores),
  ];
  const [pedagogyMin, pedagogyMax] = [
    Math.min(...pedagogyScores),
    Math.max(...pedagogyScores),
  ];
  const [speedMin, speedMax] = [
    Math.min(...speedScores),
    Math.max(...speedScores),
  ];

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Đang tải danh sách models…</p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <svg
                className="w-5 h-5"
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
              <h1 className="text-xl font-bold text-slate-800">
                Model Evaluation Leaderboard
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {models.length} model{models.length !== 1 ? "s" : ""} đã được
                đánh giá · Flipped Classroom Socratic Eval
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/model-eval/run")}
            className="flex items-center gap-2 bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-slate-700 transition"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Run Evaluation
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {models.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <svg
              className="w-12 h-12 mb-4 text-slate-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p className="font-medium">Chưa có model nào được đánh giá</p>
            <p className="text-sm mt-1">Bấm "Run Evaluation" để bắt đầu.</p>
            <button
              onClick={() => navigate("/model-eval/run")}
              className="mt-6 flex items-center gap-2 bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-slate-700 transition"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Run first evaluation
            </button>
          </div>
        ) : (
          <>
            {/* How it works */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h2 className="text-sm font-bold text-slate-800 mb-1">
                Cách thức hoạt động
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed mb-5 max-w-3xl">
                Mỗi model fine-tuned được đánh giá bằng cách{" "}
                <strong>replay lại các hội thoại</strong> trong tập test — model
                nhận từng tin nhắn của học sinh theo thứ tự và sinh câu trả lời
                thực tế. Sau đó <strong>Claude judge</strong> (Sonnet hoặc
                Haiku) đọc toàn bộ hội thoại và chấm 9 tiêu chí, mỗi tiêu chí
                0–5. Điểm Overall là trung bình có trọng số của 4 nhóm bên dưới.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                {[
                  {
                    label: "Socratic Compliance",
                    weight: "40%",
                    bg: "bg-indigo-50",
                    border: "border-indigo-200",
                    text: "text-indigo-700",
                    desc: "Model hướng dẫn bằng câu hỏi gợi mở, không đưa đáp án thẳng. Gồm: Answer Withholding (A1), Scaffolding Quality (A2), Adaptive Response (A3).",
                  },
                  {
                    label: "Content Accuracy",
                    weight: "25%",
                    bg: "bg-orange-50",
                    border: "border-orange-200",
                    text: "text-orange-700",
                    desc: "Kiến thức chính xác và phù hợp học sinh cấp 2-3. Gồm: Factual Accuracy (B1), Grade-level Appropriateness (B2).",
                  },
                  {
                    label: "Pedagogical Quality",
                    weight: "25%",
                    bg: "bg-teal-50",
                    border: "border-teal-200",
                    text: "text-teal-700",
                    desc: "Chất lượng sư phạm tổng thể. Gồm: Robustness (C1), Conversational Coherence (C2), Tone & Encouragement (C3).",
                  },
                  {
                    label: "Reliability",
                    weight: "10%",
                    bg: "bg-sky-50",
                    border: "border-sky-200",
                    text: "text-sky-700",
                    desc: "Không bịa thông tin và tốc độ phản hồi. Gồm: Hallucination Score (D1), Response Speed (D2).",
                  },
                ].map(({ label, weight, bg, border, text, desc }) => (
                  <div
                    key={label}
                    className={`rounded-xl border p-4 ${bg} ${border}`}
                  >
                    <div
                      className={`text-xs font-bold uppercase tracking-wide ${text} mb-0.5`}
                    >
                      {weight}
                    </div>
                    <div className={`text-sm font-semibold ${text} mb-2`}>
                      {label}
                    </div>
                    <p
                      className={`text-[11px] ${text} opacity-80 leading-relaxed`}
                    >
                      {desc}
                    </p>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800">
                  <strong>⚠ Hard constraint:</strong> Nếu A1 = 0 (model đưa đáp
                  án thẳng) → toàn bộ điểm nhóm Socratic Compliance bị giới hạn
                  ở 1.0, bất kể điểm A2 và A3.
                </p>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">
                    Model Rankings
                    {filterModel && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        — {filteredModels.length} results
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Điểm cao hơn = tốt hơn · Màu pill tương đối so với các model
                    trong danh sách hiện tại
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={filterModel}
                    onChange={(e) => setFilterModel(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-600 focus:outline-none focus:border-slate-400 transition"
                  >
                    <option value="">All base models</option>
                    {baseModelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m.split("/").pop()}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-0.5 bg-slate-50">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.field}
                        onClick={() => toggleSort(opt.field)}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition font-medium ${sortField === opt.field ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {opt.label}
                        {sortField === opt.field && (
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            {sortDir === "desc" ? (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M19 9l-7 7-7-7"
                              />
                            ) : (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M5 15l7-7 7 7"
                              />
                            )}
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <p className="font-medium text-sm">No results</p>
                  <button
                    onClick={() => setFilterModel("")}
                    className="mt-3 text-xs font-semibold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:border-slate-400 transition"
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 w-10">#</th>
                          <th className="px-4 py-3">Project</th>
                          <th className="px-4 py-3">Base Model</th>
                          <th
                            className="px-4 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none"
                            onClick={() => toggleSort("overall")}
                          >
                            Overall{" "}
                            {sortField === "overall" && (
                              <span className="opacity-50">
                                {sortDir === "desc" ? "↓" : "↑"}
                              </span>
                            )}
                          </th>
                          <th
                            className="px-4 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none"
                            onClick={() => toggleSort("quality")}
                          >
                            Socratic{" "}
                            {sortField === "quality" && (
                              <span className="opacity-50">
                                {sortDir === "desc" ? "↓" : "↑"}
                              </span>
                            )}
                          </th>
                          <th
                            className="px-4 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none"
                            onClick={() => toggleSort("hallucination")}
                          >
                            Accuracy{" "}
                            {sortField === "hallucination" && (
                              <span className="opacity-50">
                                {sortDir === "desc" ? "↓" : "↑"}
                              </span>
                            )}
                          </th>
                          <th className="px-4 py-3 text-center">Pedagogy</th>
                          <th
                            className="px-4 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none"
                            onClick={() => toggleSort("speed")}
                          >
                            Reliability{" "}
                            {sortField === "speed" && (
                              <span className="opacity-50">
                                {sortDir === "desc" ? "↓" : "↑"}
                              </span>
                            )}
                          </th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedModels.map((m, i) => {
                          const globalIndex = (page - 1) * PAGE_SIZE + i;
                          const overall = m.scores.overall ?? null;
                          const socratic = m.scores.group_a ?? null;
                          const accuracy = m.scores.group_b ?? null;
                          const pedagogy = m.scores.group_c ?? null;
                          const isFirst = globalIndex === 0;
                          return (
                            <tr
                              key={m.jobId}
                              ref={(el) => {
                                rowRefs.current[m.jobId] = el;
                              }}
                              onClick={() => {
                                const id = resolveEvalId(m);
                                if (id) navigate(`/model-eval/${id}`);
                                else navigate(`/model-eval/history/${m.jobId}`);
                              }}
                              className={`cursor-pointer transition-colors ${isFirst ? "bg-emerald-50/40 border-l-4 border-l-emerald-400" : "hover:bg-slate-50"}`}
                            >
                              <td className="px-4 py-4 text-center">
                                {globalIndex < 3 ? (
                                  <span className="text-base">
                                    {MEDAL[globalIndex]}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    {globalIndex + 1}
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-4">
                                <div className="font-semibold text-slate-800 truncate max-w-[200px]">
                                  {m.projectName}
                                </div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-xs text-slate-400">
                                    {m.totalConversations} convs
                                  </span>
                                  {judgeShort(m.judgeModel) && (
                                    <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                      {judgeShort(m.judgeModel)}
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(
                                        `/model-eval/history/${m.jobId}`,
                                      );
                                    }}
                                    className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 hover:underline"
                                  >
                                    all runs ▾
                                  </button>
                                </div>
                                {m.flags && m.flags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {m.flags.map((f) => {
                                      const meta = FLAG_META[f];
                                      if (!meta) return null;
                                      return (
                                        <span
                                          key={f}
                                          title={meta.title}
                                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border cursor-help ${meta.color}`}
                                        >
                                          ⚑ {meta.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded block truncate max-w-[150px]">
                                  {m.baseModel.split("/").pop()}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-center">
                                {overall !== null ? (
                                  <ScorePill
                                    value={overall}
                                    min={overallMin}
                                    max={overallMax}
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                {socratic !== null ? (
                                  <ScorePill
                                    value={socratic}
                                    min={qualityMin}
                                    max={qualityMax}
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                {accuracy !== null ? (
                                  <ScorePill
                                    value={accuracy}
                                    min={accuracyMin}
                                    max={accuracyMax}
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                {pedagogy !== null ? (
                                  <ScorePill
                                    value={pedagogy}
                                    min={pedagogyMin}
                                    max={pedagogyMax}
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                {m.scores.group_d !== null ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <ScorePill
                                      value={m.scores.group_d}
                                      min={speedMin}
                                      max={speedMax}
                                    />
                                    {m.scores.avg_latency_ms != null && (
                                      <span className="text-[10px] text-slate-400">
                                        {(
                                          m.scores.avg_latency_ms / 1000
                                        ).toFixed(1)}
                                        s
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-300 text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-right">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const id = resolveEvalId(m);
                                    if (id) navigate(`/model-eval/${id}`);
                                    else
                                      navigate(
                                        `/model-eval/history/${m.jobId}`,
                                      );
                                  }}
                                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Legend */}
                  <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/60">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
                      <span>
                        <strong className="text-slate-600">Socratic</strong> —
                        A1 Answer Withholding · A2 Scaffolding · A3 Adaptive
                        Response
                      </span>
                      <span>
                        <strong className="text-slate-600">Accuracy</strong> —
                        B1 Factual · B2 Grade-level
                      </span>
                      <span>
                        <strong className="text-slate-600">Pedagogy</strong> —
                        C1 Robustness · C2 Coherence · C3 Tone
                      </span>
                      <span>
                        <strong className="text-slate-600">Reliability</strong>{" "}
                        — D1 Hallucination · D2 Speed
                      </span>
                    </div>
                  </div>

                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        Showing {(page - 1) * PAGE_SIZE + 1}–
                        {Math.min(page * PAGE_SIZE, filteredModels.length)} of{" "}
                        {filteredModels.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          Prev
                        </button>
                        {Array.from(
                          { length: totalPages },
                          (_, i) => i + 1,
                        ).map((p) => (
                          <button
                            key={p}
                            onClick={() => setPage(p)}
                            className={`w-8 h-8 text-xs font-medium rounded-lg border transition ${p === page ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-600 hover:border-slate-400"}`}
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                          disabled={page === totalPages}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
