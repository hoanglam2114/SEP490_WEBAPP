import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import { apiService } from '../services/api';

type EvalFormat = 'openai' | 'alpaca';
type EvaluatedBy = 'manual' | 'gemini';

type EvalResults = {
  accuracy?: number;
  clarity?: number;
  completeness?: number;
  socratic?: number;
  alignment?: number;
  factuality?: number;
  overall: number;
  reason: string;
};

type EvaluationHistoryItem = {
  _id: string;
  fileId: string;
  format: EvalFormat;
  data: {
    messages?: Array<{
      role: string;
      content: string;
    }>;
    userText?: string;
    assistantText?: string;
    instruction?: string;
    input?: string;
    output?: string;
    [key: string]: any;
  };
  evaluatedBy: EvaluatedBy;
  results: EvalResults;
  createdAt: string;
  updatedAt?: string;
};

type EvaluationHistoryResponse = {
  items: EvaluationHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type EditDraft = {
  metricA: string;
  metricB: string;
  metricC: string;
  reason: string;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10, Math.max(0, value));
}

function normalizeScoreInput(value: string): number {
  const n = Number(value);
  return clampScore(n);
}

function toDateTime(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('vi-VN');
}

function renderDataCell(item: EvaluationHistoryItem): React.ReactNode {
  if (item.format === 'openai') {
    const messages = Array.isArray(item.data.messages) ? item.data.messages : [];

    if (messages.length > 0) {
      return (
        <div className="space-y-1.5">
          {messages.map((msg, idx) => (
            <div key={`${item._id}-msg-${idx}`} className="whitespace-pre-wrap break-words">
              <span className="font-semibold text-slate-700">{msg.role || 'unknown'}:</span>{' '}
              <span className="text-slate-800">{msg.content || '-'}</span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <div className="whitespace-pre-wrap break-words">
          <span className="font-semibold text-slate-700">user:</span>{' '}
          <span className="text-slate-800">{item.data.userText || item.data.instruction || '-'}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">
          <span className="font-semibold text-slate-700">assistant:</span>{' '}
          <span className="text-slate-800">{item.data.assistantText || item.data.output || '-'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="whitespace-pre-wrap break-words">
        <span className="font-semibold text-slate-700">instruction:</span>{' '}
        <span className="text-slate-800">{item.data.instruction || '-'}</span>
      </div>
      <div className="whitespace-pre-wrap break-words">
        <span className="font-semibold text-slate-700">input:</span>{' '}
        <span className="text-slate-800">{item.data.input || '-'}</span>
      </div>
      <div className="whitespace-pre-wrap break-words">
        <span className="font-semibold text-slate-700">output:</span>{' '}
        <span className="text-slate-800">{item.data.output || item.data.assistantText || '-'}</span>
      </div>
    </div>
  );
}

function metricKeys(format: EvalFormat): [keyof EvalResults, keyof EvalResults, keyof EvalResults] {
  if (format === 'openai') {
    return ['socratic', 'alignment', 'factuality'];
  }
  return ['accuracy', 'clarity', 'completeness'];
}

function metricLabels(format: EvalFormat): [string, string, string] {
  if (format === 'openai') {
    return ['socratic', 'alignment', 'factuality'];
  }
  return ['accuracy', 'clarity', 'completeness'];
}

function buildDraft(item: EvaluationHistoryItem): EditDraft {
  const [k1, k2, k3] = metricKeys(item.format);
  return {
    metricA: String(item.results[k1] ?? ''),
    metricB: String(item.results[k2] ?? ''),
    metricC: String(item.results[k3] ?? ''),
    reason: item.results.reason ?? '',
  };
}

function computeOverall(draft: EditDraft): number {
  const a = normalizeScoreInput(draft.metricA || '0');
  const b = normalizeScoreInput(draft.metricB || '0');
  const c = normalizeScoreInput(draft.metricC || '0');
  return Math.round(((a + b + c) / 3) * 10) / 10;
}

export const EvaluationHistory: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [formatFilter, setFormatFilter] = useState<'all' | EvalFormat>('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const queryKey = ['evaluation-history', page, limit, formatFilter];

  const historyQuery = useQuery<EvaluationHistoryResponse>({
    queryKey,
    queryFn: () =>
      apiService.getEvaluationHistory({
        page,
        limit,
        format: formatFilter === 'all' ? undefined : formatFilter,
      }),
  });

  const items = historyQuery.data?.items ?? [];
  const total = historyQuery.data?.total ?? 0;
  const totalPages = historyQuery.data?.totalPages ?? 1;

  const activeFormat: EvalFormat = useMemo(() => {
    if (formatFilter !== 'all') {
      return formatFilter;
    }
    return (items[0]?.format ?? 'openai') as EvalFormat;
  }, [formatFilter, items]);

  const [labelA, labelB, labelC] = metricLabels(activeFormat);

  const saveMutation = useMutation({
    mutationFn: async (item: EvaluationHistoryItem) => {
      if (!draft) {
        throw new Error('No edit draft found.');
      }

      const [k1, k2, k3] = metricKeys(item.format);
      const results: EvalResults = {
        ...item.results,
        [k1]: normalizeScoreInput(draft.metricA || '0'),
        [k2]: normalizeScoreInput(draft.metricB || '0'),
        [k3]: normalizeScoreInput(draft.metricC || '0'),
        overall: computeOverall(draft),
        reason: draft.reason,
      };

      await apiService.updateEvaluationHistory(item._id, {
        evaluatedBy: 'manual',
        results,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['evaluation-history'] });
      setEditingId(null);
      setDraft(null);
      toast.success('Updated evaluation successfully.');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error.message || 'Failed to update evaluation.');
    },
  });

  const startEdit = (item: EvaluationHistoryItem) => {
    setEditingId(item._id);
    setDraft(buildDraft(item));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const onChangeMetric = (field: 'metricA' | 'metricB' | 'metricC', value: string) => {
    if (!draft) return;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setDraft({ ...draft, [field]: value });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-right" />

      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              title="Back to Home"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Evaluation History</h1>
              <p className="text-xs text-slate-500">View and manually re-evaluate past records.</p>
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
            {total} records
          </div>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[1500px] space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 w-full">
              <select
                value={formatFilter}
                onChange={(e) => {
                  const next = e.target.value as 'all' | EvalFormat;
                  setFormatFilter(next);
                  setPage(1);
                  setEditingId(null);
                  setDraft(null);
                }}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="all">All formats</option>
                <option value="openai">OpenAI</option>
                <option value="alpaca">Alpaca</option>
              </select>

              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>

              <button
                onClick={() => historyQuery.refetch()}
                className="px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg bg-white hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full">
              <div className="overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Format</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelA}</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelB}</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelC}</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">overall</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">reason</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">evaluatedBy</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Updated</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                      Loading evaluation history...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                      No evaluation history found.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const isEditing = editingId === item._id;
                    const [k1, k2, k3] = metricKeys(item.format);

                    const scoreA = isEditing && draft ? draft.metricA : String(item.results[k1] ?? '');
                    const scoreB = isEditing && draft ? draft.metricB : String(item.results[k2] ?? '');
                    const scoreC = isEditing && draft ? draft.metricC : String(item.results[k3] ?? '');
                    const overall = isEditing && draft ? computeOverall(draft) : item.results.overall;
                    const reason = isEditing && draft ? draft.reason : item.results.reason;

                    return (
                      <tr
                        key={item._id}
                        className={`border-t border-slate-100 align-top transition-colors duration-300 ${
                          isEditing
                            ? 'bg-emerald-50/90 editing-row-glow ring-1 ring-inset ring-emerald-200'
                            : 'hover:bg-slate-50'
                        }`}
                        onDoubleClick={() => startEdit(item)}
                      >
                        <td className="px-3 py-3">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                            {item.format}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-800 min-w-[420px]">
                          {renderDataCell(item)}
                        </td>

                        <td className="px-3 py-3 text-slate-700">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step="any"
                              value={scoreA}
                              onChange={(e) => onChangeMetric('metricA', e.target.value)}
                              className="w-20 px-2 py-1 border border-slate-300 rounded"
                            />
                          ) : (
                            scoreA
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step="any"
                              value={scoreB}
                              onChange={(e) => onChangeMetric('metricB', e.target.value)}
                              className="w-20 px-2 py-1 border border-slate-300 rounded"
                            />
                          ) : (
                            scoreB
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step="any"
                              value={scoreC}
                              onChange={(e) => onChangeMetric('metricC', e.target.value)}
                              className="w-20 px-2 py-1 border border-slate-300 rounded"
                            />
                          ) : (
                            scoreC
                          )}
                        </td>

                        <td className="px-3 py-3 text-slate-800 font-semibold">{overall}</td>
                        <td className="px-3 py-3 text-slate-700 min-w-[220px]">
                          {isEditing ? (
                            <input
                              type="text"
                              value={reason}
                              onChange={(e) => setDraft((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
                              className="w-full px-2 py-1 border border-slate-300 rounded"
                            />
                          ) : (
                            reason || '-'
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">{isEditing ? 'manual' : item.evaluatedBy}</td>
                        <td className="px-3 py-3 text-slate-500 text-xs">{toDateTime(item.updatedAt || item.createdAt)}</td>
                        <td className="px-3 py-3">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveMutation.mutate(item)}
                                disabled={saveMutation.isPending}
                                className="px-2.5 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saveMutation.isPending}
                                className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(item)}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Previous
                </button>
                <div className="text-xs text-slate-600">
                  Page {page} / {totalPages}
                </div>
                <button
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
