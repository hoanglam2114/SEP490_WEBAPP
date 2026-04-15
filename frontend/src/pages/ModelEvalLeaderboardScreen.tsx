import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

interface ModelScores {
  overall: { base_avg: number; ft_avg: number; improvement_pct: number } | null;
  quality: { base_avg: number; ft_avg: number; weight: number } | null;
  hallucination: { base_avg: number; ft_avg: number; weight: number; sample_count: number } | null;
  speed: { base_avg_ms: number; ft_avg_ms: number; ft_score: number; weight: number } | null;
}

interface ModelItem {
  jobId: string;
  projectName: string;
  baseModel: string;
  completedAt: string;
  trainingDuration: number;
  /** Eval hiển thị trên leaderboard + mục tiêu của View (official nếu có pin) */
  modelEvalId: string | null;
  /** Tương thích API cũ trả `evalId` thay vì `modelEvalId` */
  evalId?: string | null;
  pinnedEvalId: string | null;
  judgeModel: string | null;
  totalSamples: number;
  scores: ModelScores;
}

function resolveEvalId(m: ModelItem): string | null {
  return m.modelEvalId ?? m.evalId ?? m.pinnedEvalId ?? null;
}

type SortField = 'date' | 'overall' | 'quality' | 'hallucination' | 'speed';
type SortDir = 'desc' | 'asc';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function ScorePill({ value, max = 5 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 70 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : pct >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${color}`}>
      {value.toFixed(2)}
    </span>
  );
}


const MEDAL: Record<number, string> = { 0: '1st', 1: '2nd', 2: '3rd' };

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'overall', label: 'Overall' },
  { field: 'quality', label: 'Quality' },
  { field: 'hallucination', label: 'Hallucination' },
  { field: 'speed', label: 'Speed' },
];

function getSortValue(m: ModelItem, field: SortField): number {
  switch (field) {
    case 'date': return new Date(m.completedAt).getTime();
    case 'overall': return m.scores.overall?.ft_avg ?? -Infinity;
    case 'quality': return m.scores.quality?.ft_avg ?? -Infinity;
    case 'hallucination': return m.scores.hallucination?.ft_avg ?? -Infinity;
    case 'speed': return m.scores.speed?.ft_score ?? -Infinity;
  }
}

export const ModelEvalLeaderboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterModel, setFilterModel] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const PAGE_SIZE = 10;
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [baseModelOptions, setBaseModelOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/model-eval/leaderboard')
      .then(r => r.json())
      .then((data: ModelItem[]) => {
        setModels(data);
        // ✅ Lấy unique base models từ data thực tế
        const unique = Array.from(new Set(data.map((m: ModelItem) => m.baseModel))).filter(Boolean);
        setBaseModelOptions(unique);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [filterModel, sortField, sortDir]);

  const filteredModels = models
    .filter(m => !filterModel || m.baseModel === filterModel)
    .sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      return sortDir === 'desc' ? vb - va : va - vb;
    });

  const totalPages = Math.ceil(filteredModels.length / PAGE_SIZE);
  const paginatedModels = filteredModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const chartData = filteredModels.map((m, i) => ({
    jobId: m.jobId,
    name: m.projectName.length > 14 ? m.projectName.slice(0, 13) + '…' : m.projectName,
    score: parseFloat(((m.scores.overall?.ft_avg ?? 0) / 5 * 100).toFixed(1)),
    rank: i,
  }));

  const handleBarClick = (entry: any) => {
    const jobId = entry?.activePayload?.[0]?.payload?.jobId;
    if (!jobId) return;
    const indexInFiltered = filteredModels.findIndex(m => m.jobId === jobId);
    if (indexInFiltered === -1) {
      const indexInAll = models.findIndex(m => m.jobId === jobId);
      if (indexInAll === -1) return;
      setFilterModel('');
      setPage(Math.floor(indexInAll / PAGE_SIZE) + 1);
    } else {
      setPage(Math.floor(indexInFiltered / PAGE_SIZE) + 1);
    }
    setHighlighted(jobId);
    setTimeout(() => {
      rowRefs.current[jobId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setHighlighted(null), 2200);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading models...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Đã đánh giá</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {models.length} model{models.length !== 1 ? 's' : ''} đã được đánh giá
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Nút đánh giá model mới */}
            <button
              onClick={() => navigate('/model-eval/run')}
              className="flex items-center gap-2 bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-slate-700 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Đánh giá model
            </button>

            <button
              onClick={() => navigate('/chat')}
              className="flex items-center gap-2 bg-emerald-100 text-emerald-800 border border-emerald-300 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-emerald-200 transition"
            >
             AI Chatbot
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {models.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <svg className="w-12 h-12 mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p className="font-medium">Chưa có model nào được đánh giá</p>
            <p className="text-sm mt-1">Bấm "Đánh giá model" để bắt đầu.</p>
            <button
              onClick={() => navigate('/model-eval/run')}
              className="mt-6 flex items-center gap-2 bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-slate-700 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Đánh giá model đầu tiên
            </button>
          </div>
        ) : (
          <>
            {/* Ranking Chart */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-slate-800">Model Ranking</h2>
                <p className="text-xs text-slate-400 mt-0.5">Overall FT score</p>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} onClick={handleBarClick}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} dy={8} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      cursor={{ fill: '#F8FAFC' }}
                      contentStyle={{ borderRadius: '10px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.07)' }}
                      formatter={(val: any) => [`${val}%`, 'Overall Score']}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={56} style={{ cursor: 'pointer' }}>
                      {chartData.map((entry, i) => (
                        <Cell key={entry.jobId} fill={i === 0 ? '#1e293b' : i === 1 ? '#475569' : i === 2 ? '#94a3b8' : '#cbd5e1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Model Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-800">
                  Tất cả model
                  {filterModel && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      — {filteredModels.length} kết quả
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={filterModel}
                    onChange={e => setFilterModel(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-600 focus:outline-none focus:border-slate-400 transition"
                  >
                    <option value="">Tất cả base model</option>
                    {baseModelOptions.map(m => (
                      <option key={m} value={m}>{m.split('/').pop()}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-0.5 bg-slate-50">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.field}
                        onClick={() => toggleSort(opt.field)}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition font-medium ${sortField === opt.field ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        {opt.label}
                        {sortField === opt.field && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {sortDir === 'desc'
                              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                            }
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <svg className="w-10 h-10 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <p className="font-medium text-sm">Không có kết quả</p>
                  <button onClick={() => setFilterModel('')} className="mt-4 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition">
                    Xóa bộ lọc
                  </button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3 w-10">#</th>
                          <th className="px-6 py-3">Project</th>
                          <th className="px-6 py-3">Base Model</th>
                          <th className={`px-6 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none ${sortField === 'overall' ? 'text-slate-800' : ''}`} onClick={() => toggleSort('overall')}>
                            <span className="inline-flex items-center gap-1 justify-center">Overall {sortField === 'overall' && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}</span>
                          </th>
                          <th className={`px-6 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none ${sortField === 'quality' ? 'text-slate-800' : ''}`} onClick={() => toggleSort('quality')}>
                            <span className="inline-flex items-center gap-1 justify-center">Quality {sortField === 'quality' && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}</span>
                          </th>
                          <th className={`px-6 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none ${sortField === 'hallucination' ? 'text-slate-800' : ''}`} onClick={() => toggleSort('hallucination')}>
                            <span className="inline-flex items-center gap-1 justify-center">Hallucination {sortField === 'hallucination' && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}</span>
                          </th>
                          <th className={`px-6 py-3 text-center cursor-pointer hover:text-slate-800 transition select-none ${sortField === 'speed' ? 'text-slate-800' : ''}`} onClick={() => toggleSort('speed')}>
                            <span className="inline-flex items-center gap-1 justify-center">Speed {sortField === 'speed' && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}</span>
                          </th>
                          <th className={`px-6 py-3 cursor-pointer hover:text-slate-800 transition select-none ${sortField === 'date' ? 'text-slate-800' : ''}`} onClick={() => toggleSort('date')}>
                            <span className="inline-flex items-center gap-1">Trained {sortField === 'date' && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}</span>
                          </th>
                          <th className="px-6 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedModels.map((m, i) => {
                          const isHighlighted = highlighted === m.jobId;
                          const globalIndex = (page - 1) * PAGE_SIZE + i;
                          const overall = m.scores.overall?.ft_avg ?? null;
                          const quality = m.scores.quality?.ft_avg ?? null;
                          const hall = m.scores.hallucination?.ft_avg ?? null;
                          const imp = m.scores.overall?.improvement_pct ?? null;

                          return (
                            <tr
                              key={m.jobId}
                              ref={el => { rowRefs.current[m.jobId] = el; }}
                              onClick={() => {
                                const id = resolveEvalId(m);
                                if (id) navigate(`/model-eval/${id}`);
                                else navigate(`/model-eval/history/${m.jobId}`);
                              }}
                              className={`cursor-pointer transition-colors duration-300 ${isHighlighted ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : 'hover:bg-slate-50'
                                }`}
                            >
                              <td className="px-6 py-4">
                                {globalIndex < 3
                                  ? <span className="text-xs font-bold text-slate-500">{MEDAL[globalIndex]}</span>
                                  : <span className="text-xs text-slate-400">{globalIndex + 1}</span>}
                              </td>
                              <td className="px-6 py-4">
                                <div className="font-medium text-slate-800 truncate max-w-[180px]">{m.projectName}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <div className="text-xs text-slate-400">{m.totalSamples} samples</div>
                                  {m.judgeModel && (
                                    <span className="text-[9px] font-mono text-slate-400">
                                      {m.judgeModel.includes('haiku') ? 'Haiku' : m.judgeModel.includes('sonnet') ? 'Sonnet' : m.judgeModel.includes('opus') ? 'Opus' : m.judgeModel.split('-')[0]}
                                    </span>
                                  )}
                                  <button
                                    onClick={e => { e.stopPropagation(); navigate(`/model-eval/history/${m.jobId}`); }}
                                    className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 hover:underline"
                                  >
                                    runs ▾
                                  </button>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded truncate block max-w-[160px]">
                                  {m.baseModel.split('/').pop()}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                {overall !== null ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <ScorePill value={overall} />
                                    {imp !== null && (
                                      <span className={`text-[10px] font-semibold ${imp >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {imp >= 0 ? '+' : ''}{imp.toFixed(1)}%
                                      </span>
                                    )}
                                  </div>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {quality !== null ? <ScorePill value={quality} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {hall !== null ? <ScorePill value={hall} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {m.scores.speed ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <ScorePill value={m.scores.speed.ft_score} />
                                    <span className="text-[10px] text-slate-400">{m.scores.speed.ft_avg_ms.toFixed(0)}ms</span>
                                  </div>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-xs text-slate-500">{new Date(m.completedAt).toLocaleDateString('vi-VN')}</div>
                                {m.trainingDuration > 0 && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">{formatDuration(m.trainingDuration)}</div>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    const id = resolveEvalId(m);
                                    if (id) navigate(`/model-eval/${id}`);
                                    else navigate(`/model-eval/history/${m.jobId}`);
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

                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredModels.length)} of {filteredModels.length} models
                      </p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition">Prev</button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                          <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 text-xs font-medium rounded-lg border transition ${p === page ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{p}</button>
                        ))}
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition">Next</button>
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
