import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface EvaluationData {
  evalId: string;
  jobId: string;
  status: string;
  totalSamples: number;
  subjectBreakdown: Record<string, number>;
  skippedBySimilarity: number;
  results: any[];
  summary: {
    overall: { base_avg: number; ft_avg: number; delta?: number; improvement_pct: number };
    quality?: { base_avg: number; ft_avg: number; weight: number };
    hallucination?: { base_avg: number; ft_avg: number; weight: number; sample_count: number };
    speed?: { base_avg_ms: number; ft_avg_ms: number; base_score: number; ft_score: number; weight: number };
    by_subject: Record<string, { base_avg: number; ft_avg: number; improvement_pct: number }>;
    max_possible: number;
  };
  startedAt: string;
  completedAt: string;
}

export const EvaluationResultsScreen: React.FC = () => {
  const { evalId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/eval/${evalId}`);
        if (!res.ok) throw new Error('Evaluation not found');
        const _data = await res.json();
        setData(_data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (evalId) fetchData();
  }, [evalId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <svg className="w-8 h-8 animate-spin text-purple-500 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-slate-500">Loading evaluation results...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500 font-medium">Evaluation record not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700"> Back to History </button>
      </div>
    );
  }

  // Filter available subjects based on breakdown
  const availableSubjects = Object.entries(data.subjectBreakdown)
    .filter(([_, count]) => count > 0)
    .map(([subj]) => subj);

  // Derive charts
  let chartData: any[] = [];
  if (filter === 'all') {
    chartData = Object.entries(data.summary.by_subject || {}).map(([subj, stats]) => {
      const isPercent = data.summary.max_possible === 5;
      const fmt = (v: number) => isPercent ? (v / 5) * 100 : v;
      return {
        name: subj.toUpperCase(),
        Base: parseFloat(fmt(stats.base_avg).toFixed(1)),
        Finetuned: parseFloat(fmt(stats.ft_avg).toFixed(1)),
      };
    });
  } else if (filter === 'van') {
    // If Van, compute avg across criteria
    const vanResults = data.results.filter(r => r.subject === 'van' && r.criteria_detail && r.criteria_detail.length > 0);
    const criteriaSums: Record<string, { b: number; f: number; count: number }> = {};
    vanResults.forEach(r => {
      r.criteria_detail.forEach((c: any) => {
        if (!criteriaSums[c.name]) criteriaSums[c.name] = { b: 0, f: 0, count: 0 };
        criteriaSums[c.name].b += c.base_score;
        criteriaSums[c.name].f += c.ft_score;
        criteriaSums[c.name].count += 1;
      });
    });
    chartData = Object.entries(criteriaSums).map(([cName, sums]) => ({
      name: cName,
      Base: parseFloat(((sums.b / sums.count) / 5 * 100).toFixed(1)),
      Finetuned: parseFloat(((sums.f / sums.count) / 5 * 100).toFixed(1)),
    }));
  } else {
    // Other subjects dont have criteria breakdown so just show overall
    const subjStats = (data.summary.by_subject as any)[filter];
    if (subjStats) {
      chartData = [{
        name: filter.toUpperCase(),
        Base: parseFloat((subjStats.base_avg / 5 * 100).toFixed(1)),
        Finetuned: parseFloat((subjStats.ft_avg / 5 * 100).toFixed(1))
      }];
    }
  }

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const p_base = ((data.summary.overall.base_avg / data.summary.max_possible) * 100).toFixed(1);
  const p_ft = ((data.summary.overall.ft_avg / data.summary.max_possible) * 100).toFixed(1);
  const imp = data.summary.overall.improvement_pct;

  // Derive quality từ by_subject nếu không có summary.quality (data cũ)
  const qualityData = data.summary.quality ?? (() => {
    const keys = Object.keys(data.summary.by_subject || {}).filter(k => k !== 'hallucination');
    if (!keys.length) return null;
    const b = keys.reduce((s, k) => s + data.summary.by_subject[k].base_avg, 0) / keys.length;
    const f = keys.reduce((s, k) => s + data.summary.by_subject[k].ft_avg, 0) / keys.length;
    return { base_avg: b, ft_avg: f, weight: data.summary.quality ? 0.5 : 1.0 };
  })();
  const hallData = data.summary.hallucination ?? null;
  const speedData = data.summary.speed ?? null;

  const fmtPct = (v: number) => ((v / data.summary.max_possible) * 100).toFixed(1);
  const deltaInfo = (b: number, f: number) => {
    const d = ((f - b) / Math.max(0.01, b)) * 100;
    return { val: d, color: d >= 0 ? 'text-emerald-600' : 'text-red-500', sign: d >= 0 ? '+' : '', arrow: d >= 0 ? '\u2191' : '\u2193' };
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="text-2xl">📊</span> Evaluation Results
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Job: {data.jobId}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border text-center border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Base Avg</div>
            <div className="text-2xl font-bold text-slate-700">{p_base}%</div>
          </div>
          <div className="bg-white border text-center border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-purple-600 font-medium uppercase tracking-wider mb-1">FT Avg</div>
            <div className="text-2xl font-bold text-purple-700">{p_ft}%</div>
          </div>
          <div className="bg-white border text-center border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${imp >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>Improvement</div>
            <div className={`text-2xl font-bold ${imp >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {imp >= 0 ? '+' : ''}{imp.toFixed(1)}% {imp >= 0 ? '↑' : '↓'}
            </div>
          </div>
          <div className="bg-white border text-center border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Total Samples</div>
            <div className="text-2xl font-bold text-slate-700">{data.totalSamples}</div>
          </div>
        </div>

        {/* Score Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Score Breakdown</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Chất lượng */}
            {qualityData && (() => {
              const d = deltaInfo(qualityData.base_avg, qualityData.ft_avg);
              const isPartial = qualityData.weight === 1.0 && !data.summary.quality;
              return (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📚</span>
                      <span className="text-sm font-semibold text-slate-700">Chất lượng</span>
                    </div>
                    {!isPartial && <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{(qualityData.weight * 100).toFixed(0)}%</span>}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Base</span><span>FT</span></div>
                  <div className="flex justify-between font-bold text-base mb-2">
                    <span className="text-slate-600">{fmtPct(qualityData.base_avg)}%</span>
                    <span className="text-purple-700">{fmtPct(qualityData.ft_avg)}%</span>
                  </div>
                  <div className={`text-xs font-semibold text-center ${d.color}`}>{d.sign}{d.val.toFixed(1)}% {d.arrow}</div>
                </div>
              );
            })()}

            {/* Hallucination */}
            {hallData ? (() => {
              const d = deltaInfo(hallData.base_avg, hallData.ft_avg);
              return (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🧠</span>
                      <span className="text-sm font-semibold text-slate-700">Hallucination</span>
                    </div>
                    <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{(hallData.weight * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Base</span><span>FT</span></div>
                  <div className="flex justify-between font-bold text-base mb-2">
                    <span className="text-slate-600">{fmtPct(hallData.base_avg)}%</span>
                    <span className="text-purple-700">{fmtPct(hallData.ft_avg)}%</span>
                  </div>
                  <div className={`text-xs font-semibold text-center ${d.color}`}>{d.sign}{d.val.toFixed(1)}% {d.arrow}</div>
                  <div className="text-[10px] text-slate-400 text-center mt-1">{hallData.sample_count} câu test</div>
                </div>
              );
            })() : (
              <div className="bg-slate-50 rounded-xl p-4 border border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-center">
                <span className="text-2xl">🧠</span>
                <span className="text-sm font-semibold text-slate-400">Hallucination</span>
                <span className="text-xs text-slate-400">Chưa có dữ liệu<br />Thêm câu subject=hallucination</span>
              </div>
            )}

            {/* Tốc độ */}
            {speedData ? (() => {
              const faster = speedData.ft_avg_ms < speedData.base_avg_ms;
              const ratio = speedData.base_avg_ms > 0 ? ((speedData.ft_avg_ms / speedData.base_avg_ms - 1) * 100) : 0;
              return (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">⚡</span>
                      <span className="text-sm font-semibold text-slate-700">Tốc độ</span>
                    </div>
                    <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{(speedData.weight * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Base</span><span>FT</span></div>
                  <div className="flex justify-between font-bold text-base mb-2">
                    <span className="text-slate-600">{speedData.base_avg_ms.toFixed(0)}ms</span>
                    <span className={faster ? 'text-emerald-600' : 'text-red-500'}>{speedData.ft_avg_ms.toFixed(0)}ms</span>
                  </div>
                  <div className={`text-xs font-semibold text-center ${faster ? 'text-emerald-600' : 'text-red-500'}`}>
                    {ratio >= 0 ? '+' : ''}{ratio.toFixed(1)}% {faster ? '⚡ nhanh hơn' : '🐢 chậm hơn'}
                  </div>
                  <div className="text-[10px] text-slate-400 text-center mt-1">Score: {speedData.base_score.toFixed(1)} → {speedData.ft_score.toFixed(1)}/5</div>
                </div>
              );
            })() : (
              <div className="bg-slate-50 rounded-xl p-4 border border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-center">
                <span className="text-2xl">⚡</span>
                <span className="text-sm font-semibold text-slate-400">Tốc độ</span>
                <span className="text-xs text-slate-400">Chưa có dữ liệu<br />Chạy lại eval để đo</span>
              </div>
            )}

          </div>
        </div>

        {/* Chart Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-slate-800">Performance Chart</h2>
            <div className="flex bg-slate-100 p-1 rounded-lg gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${filter === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >All</button>
              {availableSubjects.map(subj => (
                <button
                  key={subj}
                  onClick={() => setFilter(subj)}
                  className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${filter === subj ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                >
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
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} domain={[0, 100]} tickFormatter={(val: any) => `${val}%`} />
                <Tooltip cursor={{ fill: '#F1F5F9' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Bar dataKey="Base" fill="#94A3B8" radius={[4, 4, 0, 0]} maxBarSize={60} />
                <Bar dataKey="Finetuned" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-800">Detailed Results</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Subject</th>
                  <th className="px-6 py-3">Question</th>
                  <th className="px-6 py-3">Base</th>
                  <th className="px-6 py-3">FT</th>
                  <th className="px-6 py-3">Δ</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.filter(r => filter === 'all' || r.subject === filter).map((r, i) => {
                  const expanded = !!expandedRows[i];
                  const deltaColor = r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-red-500" : "text-slate-400";
                  const deltaSign = r.delta > 0 ? "+" : "";

                  return (
                    <React.Fragment key={i}>
                      <tr className="hover:bg-slate-50 transition cursor-pointer" onClick={() => toggleRow(i)}>
                        <td className="px-6 py-4 text-slate-500">{i + 1}</td>
                        <td className="px-6 py-4 font-medium text-slate-800 uppercase">{r.subject}</td>
                        <td className="px-6 py-4 text-slate-600 truncate max-w-xs" title={r.instruction}>
                          {r.instruction.length > 50 ? r.instruction.substring(0, 50) + "..." : r.instruction}
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-500">{r.base_score}/{data.summary.max_possible}</td>
                        <td className="px-6 py-4 font-bold text-purple-700">{r.ft_score}/{data.summary.max_possible}</td>
                        <td className={`px-6 py-4 font-bold ${deltaColor}`}>{deltaSign}{r.delta}</td>
                        <td className="px-6 py-4 text-right">
                          <button className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                            {expanded ? "Close" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={7} className="px-6 py-4 border-b border-slate-200">
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                                  <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1">Base Answer</h4>
                                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{r.base_answer}</p>
                                </div>
                                <div className="bg-purple-50 p-3 border border-purple-100 rounded-lg shadow-sm">
                                  <h4 className="text-[10px] uppercase font-bold text-purple-500 mb-1">FT Answer</h4>
                                  <p className="text-xs text-slate-800 whitespace-pre-wrap">{r.ft_answer}</p>
                                </div>
                              </div>
                              <div className="bg-slate-100 p-3 rounded-lg border border-slate-200">
                                <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-1 leading-snug">Expected / Hints</h4>
                                <p className="text-xs text-slate-700 italic">{r.expected}</p>
                                <p className="text-[10px] text-slate-400 mt-2">Method: {r.eval_method}</p>
                              </div>

                              {r.criteria_detail && r.criteria_detail.length > 0 && (
                                <div className="mt-4">
                                  <h4 className="text-xs font-semibold text-slate-700 mb-2 border-b pb-1">Criteria Breakdown</h4>
                                  <div className="space-y-3">
                                    {r.criteria_detail.map((c: any, cidx: number) => (
                                      <div key={cidx} className="bg-white p-3 rounded-lg border border-slate-200 text-xs">
                                        <div className="flex items-center justify-between font-semibold text-slate-800 mb-1">
                                          <span>{c.name}</span>
                                          <span className="text-purple-600 border px-2 py-0.5 rounded-md bg-purple-50">Base {c.base_score} | FT {c.ft_score}</span>
                                        </div>
                                        {c.base_reason && <p className="text-slate-500 mt-1"><span className="font-semibold">Base Note:</span> {c.base_reason}</p>}
                                        {c.ft_reason && <p className="text-slate-500 mt-1"><span className="font-semibold">FT Note:</span> {c.ft_reason}</p>}
                                      </div>
                                    ))}
                                  </div>
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
        </div>
      </div>
    </div>
  );
};
