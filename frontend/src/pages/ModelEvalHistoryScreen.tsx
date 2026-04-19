import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EvalSummary {
  overall: number | null;
  group_a: number | null;
  group_b: number | null;
  group_c: number | null;
  group_d: number | null;
  criteria?: Record<string, number>;
  avg_latency_ms?: number;
  non_scoring?: { bleu: number; rouge_l: number; question_detection_rate: number };
}

interface EvalRun {
  modelEvalId: string;
  jobId: string;
  status: string;
  totalConversations: number;
  judgeModel: string;
  summary: EvalSummary;
  startedAt: string;
  completedAt: string;
  isPinned: boolean;
  systemPromptVersion?: string;
  datasetVersionName?: string;
}

interface HistoryResponse {
  jobId: string;
  projectName: string;
  baseModel: string;
  pinnedEvalId: string | null;
  evals: EvalRun[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function judgeLabel(model: string) {
  if (!model) return '—';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  return model.split('-')[0];
}

function ScorePill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-slate-300 text-xs">—</span>;
  const color =
    value >= 4 ? 'bg-emerald-100 text-emerald-700' :
    value >= 3 ? 'bg-amber-100 text-amber-700' :
    'bg-red-100 text-red-600';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {value.toFixed(2)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ModelEvalHistoryScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Compare mode: chọn tối đa 2 run
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // Pin loading state
  const [pinning, setPinning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    fetch(`/api/model-eval/history/${jobId}`)
      .then(r => r.json())
      .then((json: HistoryResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Lỗi tải dữ liệu');
        setLoading(false);
      });
  }, [jobId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function handleDelete(evalId: string) {
    if (!data) return;
    if (!window.confirm('Xóa bản đánh giá này? Không thể hoàn tác.')) return;
    setDeleting(evalId);
    try {
      const res = await fetch(`/api/model-eval/${encodeURIComponent(evalId)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Xóa thất bại');
      const newPinned = (json as { newPinnedEvalId?: string | null }).newPinnedEvalId ?? data.pinnedEvalId;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pinnedEvalId: newPinned ?? null,
          evals: prev.evals
            .filter((e) => e.modelEvalId !== evalId)
            .map((e) => ({ ...e, isPinned: e.modelEvalId === newPinned })),
        };
      });
      setCompareIds((ids) => ids.filter((id) => id !== evalId));
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xóa');
    } finally {
      setDeleting(null);
    }
  }

  async function handlePin(evalId: string) {
    if (!data) return;
    setPinning(evalId);
    try {
      const res = await fetch(`/api/model-eval/pin/${evalId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Pin thất bại');
      // Cập nhật local state
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pinnedEvalId: evalId,
          evals: prev.evals.map(e => ({ ...e, isPinned: e.modelEvalId === evalId })),
        };
      });
    } catch (err: any) {
      alert(err.message || 'Lỗi khi pin');
    } finally {
      setPinning(null);
    }
  }

  function toggleCompare(evalId: string) {
    setCompareIds(prev => {
      if (prev.includes(evalId)) return prev.filter(id => id !== evalId);
      if (prev.length >= 2) return prev; // tối đa 2
      return [...prev, evalId];
    });
  }

  // ---------------------------------------------------------------------------
  // Loading / Error
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Đang tải lịch sử đánh giá…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-red-500 text-sm">{error || 'Không tìm thấy dữ liệu'}</div>
      </div>
    );
  }

  const { projectName, baseModel, evals } = data;
  const pinnedEval = evals.find(e => e.isPinned);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-400">
          <button onClick={() => navigate('/model-eval/leaderboard')} className="hover:text-slate-700 transition">
            Leaderboard
          </button>
          <span>/</span>
          <span className="text-slate-700 font-medium truncate max-w-[200px]">{projectName}</span>
          <span>/</span>
          <span className="text-slate-500">Lịch sử đánh giá</span>
        </nav>

        {/* Info card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-slate-800">{projectName}</h1>
              <div className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded inline-block">
                {baseModel}
              </div>
            </div>
            <div className="flex gap-4 text-center shrink-0">
              <div className="bg-slate-50 rounded-lg px-4 py-3">
                <div className="text-2xl font-bold text-slate-700">{evals.length}</div>
                <div className="text-xs text-slate-400 mt-0.5">Lần eval</div>
              </div>
              <div className="bg-slate-50 rounded-lg px-4 py-3">
                <div className="text-sm font-semibold text-slate-700 truncate max-w-[120px]">
                  {pinnedEval ? fmtDate(pinnedEval.completedAt).split(',')[0] : '—'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Eval official</div>
              </div>
            </div>
          </div>

          {pinnedEval && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 font-semibold px-2 py-1 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17a1 1 0 11-2 0V5.477L6.237 7.082l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z"/>
                </svg>
                Pinned
              </span>
              <span>
                {pinnedEval.modelEvalId} · {judgeLabel(pinnedEval.judgeModel)} · {pinnedEval.totalConversations} conversations
              </span>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Tất cả lần đánh giá</h2>
            {compareIds.length > 0 && (
              <span className="text-xs text-slate-400">
                Đã chọn {compareIds.length}/2 để so sánh
              </span>
            )}
          </div>

          {evals.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-400 text-sm">
              Chưa có lần đánh giá nào được hoàn thành.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 w-8">
                      {/* Compare checkbox col */}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Ngày</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Dataset/Prompt</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Judge</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Convs</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Overall</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Socratic</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Accuracy</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Pedagogy</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {evals.map((e, i) => {
                    const overall = e.summary?.overall ?? null;
                    const socratic = e.summary?.group_a ?? null;
                    const accuracy = e.summary?.group_b ?? null;
                    const pedagogy = e.summary?.group_c ?? null;
                    const isSelected = compareIds.includes(e.modelEvalId);
                    const canSelect = isSelected || compareIds.length < 2;

                    return (
                      <tr
                        key={e.modelEvalId}
                        className={`transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                      >
                        {/* Compare checkbox */}
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canSelect}
                            onChange={() => toggleCompare(e.modelEvalId)}
                            className="rounded border-slate-300 text-blue-500 cursor-pointer disabled:opacity-30"
                          />
                        </td>

                        {/* # */}
                        <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                          {evals.length - i}
                        </td>

                        {/* Ngày */}
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-700">{fmtDate(e.completedAt)}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono truncate max-w-[140px]">{e.modelEvalId}</div>
                        </td>

                        {/* Dataset/Prompt */}
                        <td className="px-4 py-3">
                          <div className="text-xs font-semibold text-slate-700">{e.datasetVersionName || '—'}</div>
                          <div className="text-[10px] text-indigo-600 mt-0.5 font-medium">{e.systemPromptVersion || '—'}</div>
                        </td>

                        {/* Judge */}
                        <td className="px-4 py-3">
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono">
                            {judgeLabel(e.judgeModel)}
                          </span>
                        </td>

                        {/* Samples */}
                        {/* Convs */}
                        <td className="px-4 py-3 text-center text-xs text-slate-600">{e.totalConversations}</td>

                        {/* Scores */}
                        <td className="px-4 py-3 text-center"><ScorePill value={overall} /></td>
                        <td className="px-4 py-3 text-center"><ScorePill value={socratic} /></td>
                        <td className="px-4 py-3 text-center"><ScorePill value={accuracy} /></td>
                        <td className="px-4 py-3 text-center"><ScorePill value={pedagogy} /></td>

                        {/* Pin badge */}
                        <td className="px-4 py-3 text-center">
                          {e.isPinned ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17a1 1 0 11-2 0V5.477L6.237 7.082l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z"/>
                              </svg>
                              Official
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => navigate(`/model-eval/${e.modelEvalId}`)}
                              className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 px-2.5 py-1 rounded-lg transition"
                            >
                              Xem
                            </button>
                            {!e.isPinned && (
                              <button
                                type="button"
                                onClick={() => handlePin(e.modelEvalId)}
                                disabled={pinning === e.modelEvalId}
                                className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                              >
                                {pinning === e.modelEvalId ? '…' : 'Pin'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(e.modelEvalId)}
                              disabled={deleting === e.modelEvalId}
                              className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                            >
                              {deleting === e.modelEvalId ? '…' : 'Xóa'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Sticky compare bar */}
      {compareIds.length === 2 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg px-6 py-4 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div className="text-sm text-slate-600">
              So sánh{' '}
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{compareIds[0].slice(-8)}</span>
              {' '}với{' '}
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{compareIds[1].slice(-8)}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCompareIds([])}
                className="text-sm text-slate-400 hover:text-slate-600 transition"
              >
                Hủy
              </button>
              <button
                onClick={() => navigate(`/model-eval/compare?a=${compareIds[0]}&b=${compareIds[1]}`)}
                className="text-sm font-semibold bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition"
              >
                So sánh →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
