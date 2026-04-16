import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ─── Types (khớp API GET /api/model-eval/compare) ────────────────────────────

interface RunMeta {
  modelEvalId: string;
  jobId: string;
  projectName: string;
  judgeModel: string;
  completedAt: string;
  totalConversations: number;
}

type Winner = 'a' | 'b' | 'tie';

interface ScoreCell {
  a: number | null;
  b: number | null;
  winner: Winner;
}

interface CompareResponse {
  runA: RunMeta;
  runB: RunMeta;
  scoreSummary: {
    overall: ScoreCell;
    group_a: ScoreCell;
    group_b: ScoreCell;
    group_c: ScoreCell;
    group_d: ScoreCell;
    bleu: ScoreCell;
    rouge_l: ScoreCell;
  };
  matchedSamples: {
    conv_index: number;
    num_turns_a: number;
    num_turns_b: number;
    overall_a: number;
    overall_b: number;
    delta_overall: number;
  }[];
  matchedCount: number;
  differentTestSetsNote: boolean;
}

type DiffFilter = 'all' | 'improved' | 'worse' | 'same';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtScore(v: number | null) {
  if (v == null) return '—';
  return v.toFixed(3);
}

function judgeShort(m: string) {
  if (!m) return '—';
  if (m.includes('haiku')) return 'Haiku';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('opus')) return 'Opus';
  return m.split('-')[0];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ModelEvalCompareScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const a = searchParams.get('a') || '';
  const b = searchParams.get('b') || '';

  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [panelRow, setPanelRow] = useState<CompareResponse['matchedSamples'][0] | null>(null);

  useEffect(() => {
    if (!a || !b) {
      setError('Thiếu tham số a hoặc b trên URL.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/model-eval/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Không tải được dữ liệu so sánh');
        return json as CompareResponse;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [a, b]);

  const radarData = useMemo(() => {
    if (!data) return [];
    const s = data.scoreSummary;
    return [
      { axis: 'Overall', runA: s.overall.a ?? 0, runB: s.overall.b ?? 0 },
      { axis: 'Socratic Compliance', runA: s.group_a.a ?? 0, runB: s.group_a.b ?? 0 },
      { axis: 'Độ chính xác nội dung', runA: s.group_b.a ?? 0, runB: s.group_b.b ?? 0 },
      { axis: 'Chất lượng sư phạm', runA: s.group_c.a ?? 0, runB: s.group_c.b ?? 0 },
      { axis: 'Hallucination + Tốc độ', runA: s.group_d.a ?? 0, runB: s.group_d.b ?? 0 },
    ];
  }, [data]);

  const filteredSamples = useMemo(() => {
    if (!data) return [];
    const rows = data.matchedSamples;
    if (diffFilter === 'all') return rows;
    if (diffFilter === 'improved') return rows.filter((r) => r.delta_overall > 0);
    if (diffFilter === 'worse') return rows.filter((r) => r.delta_overall < 0);
    return rows.filter((r) => r.delta_overall === 0);
  }, [data, diffFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Đang tải so sánh…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-red-500 text-sm text-center">{error || 'Không có dữ liệu'}</div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Quay lại
        </button>
      </div>
    );
  }

  const { runA, runB, scoreSummary, differentTestSetsNote, matchedCount } = data;
  const labelA = runA.modelEvalId.slice(-8);
  const labelB = runB.modelEvalId.slice(-8);

  const rows: { key: string; label: string; cell: ScoreCell }[] = [
    { key: 'overall', label: 'Overall', cell: scoreSummary.overall },
    { key: 'group_a', label: 'Socratic Compliance', cell: scoreSummary.group_a },
    { key: 'group_b', label: 'Độ chính xác nội dung', cell: scoreSummary.group_b },
    { key: 'group_c', label: 'Chất lượng sư phạm', cell: scoreSummary.group_c },
    { key: 'group_d', label: 'Hallucination + Tốc độ', cell: scoreSummary.group_d },
    { key: 'bleu', label: 'BLEU', cell: scoreSummary.bleu },
    { key: 'rouge', label: 'ROUGE-L', cell: scoreSummary.rouge_l },
  ];

  function cellClass(side: 'a' | 'b', w: Winner) {
    if (w === 'tie') return 'text-slate-700';
    if (w === side) return 'font-bold text-emerald-700 bg-emerald-50';
    return 'text-slate-600';
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <nav className="flex items-center gap-2 text-sm text-slate-400">
          <button type="button" onClick={() => navigate(-1)} className="hover:text-slate-700 transition">
            ← Quay lại
          </button>
          <span>/</span>
          <span className="text-slate-700 font-medium">So sánh eval</span>
        </nav>

        {differentTestSetsNote && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Ghi chú:</strong> Hai lần eval có bộ test khác nhau (số mẫu hoặc nội dung). Bảng dưới chỉ hiển thị các
            câu <strong>trùng instruction</strong> (inner join). Đã khớp <strong>{matchedCount}</strong> mẫu.
          </div>
        )}

        {/* Zone A — Metadata 2 cột */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Run A</div>
            <div className="font-mono text-xs text-slate-500">{runA.modelEvalId}</div>
            <div className="text-sm">
              <span className="text-slate-500">Dự án:</span>{' '}
              <span className="font-medium text-slate-800">{runA.projectName || '—'}</span>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Judge:</span>{' '}
              <span className="font-medium">{judgeShort(runA.judgeModel)}</span>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Ngày:</span> {fmtDate(runA.completedAt)}
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Conversations:</span> {runA.totalConversations}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Run B</div>
            <div className="font-mono text-xs text-slate-500">{runB.modelEvalId}</div>
            <div className="text-sm">
              <span className="text-slate-500">Dự án:</span>{' '}
              <span className="font-medium text-slate-800">{runB.projectName || '—'}</span>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Judge:</span>{' '}
              <span className="font-medium">{judgeShort(runB.judgeModel)}</span>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Ngày:</span> {fmtDate(runB.completedAt)}
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Conversations:</span> {runB.totalConversations}
            </div>
          </div>
        </div>

        {/* Zone B — Score table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
            So sánh điểm (FT)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Metric</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">
                    A <span className="font-mono text-[10px] text-slate-400">({labelA})</span>
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">
                    B <span className="font-mono text-[10px] text-slate-400">({labelB})</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-2.5 text-slate-600">{row.label}</td>
                    <td
                      className={`px-4 py-2.5 text-center tabular-nums ${cellClass('a', row.cell.winner)}`}
                    >
                      {fmtScore(row.cell.a)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-center tabular-nums ${cellClass('b', row.cell.winner)}`}
                    >
                      {fmtScore(row.cell.b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zone C — Radar */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Radar — 4 trục (điểm FT)</h3>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#64748b' }} />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10 }} />
                <Radar name={`A (${labelA})`} dataKey="runA" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                <Radar name={`B (${labelB})`} dataKey="runB" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Zone D — Per-sample diff */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">Theo từng mẫu (Δ = điểm B − điểm A)</h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'Tất cả'],
                  ['improved', 'Cải thiện (Δ>0)'],
                  ['worse', 'Giảm (Δ<0)'],
                  ['same', 'Không đổi'],
                ] as const
              ).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDiffFilter(k)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                    diffFilter === k
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          {filteredSamples.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-400 text-sm">Không có mẫu trong bộ lọc này.</div>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Conv Index</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Turns A</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Turns B</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Overall A</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Overall B</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredSamples.map((row, idx) => (
                    <tr
                      key={`${row.conv_index}-${idx}`}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => setPanelRow(row)}
                    >
                      <td className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">{row.conv_index}</td>
                      <td className="px-4 py-2 text-center tabular-nums text-xs">{row.num_turns_a}</td>
                      <td className="px-4 py-2 text-center tabular-nums text-xs">{row.num_turns_b}</td>
                      <td className="px-4 py-2 text-center tabular-nums text-xs">{row.overall_a.toFixed(2)}</td>
                      <td className="px-4 py-2 text-center tabular-nums text-xs">{row.overall_b.toFixed(2)}</td>
                      <td
                        className={`px-4 py-2 text-center text-xs font-semibold tabular-nums ${
                          row.delta_overall > 0
                            ? 'text-emerald-600'
                            : row.delta_overall < 0
                              ? 'text-red-600'
                              : 'text-slate-500'
                        }`}
                      >
                        {row.delta_overall > 0 ? '+' : ''}
                        {row.delta_overall.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Slide panel — side by side answers */}
      {panelRow && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/30 z-[60]"
            aria-label="Đóng"
            onClick={() => setPanelRow(null)}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-3xl bg-white shadow-2xl z-[70] flex flex-col border-l border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h4 className="text-sm font-semibold text-slate-800">Chi tiết cuộc trò chuyện (Conversation #{panelRow.conv_index})</h4>
              <button
                type="button"
                onClick={() => setPanelRow(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">Conversation Index</div>
                <p className="text-sm text-slate-800">Conversation #{panelRow.conv_index}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                  <div className="text-xs font-semibold text-indigo-700 mb-2">Run A — {labelA}</div>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="font-medium">Turns:</span> {panelRow.num_turns_a}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Overall Score:</span> {panelRow.overall_a.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
                  <div className="text-xs font-semibold text-emerald-700 mb-2">Run B — {labelB}</div>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="font-medium">Turns:</span> {panelRow.num_turns_b}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Overall Score:</span> {panelRow.overall_b.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
