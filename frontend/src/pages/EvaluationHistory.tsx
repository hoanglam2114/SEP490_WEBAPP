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
  encouragement?: number;
  factuality?: number;
  overall: number;
  reason: string;
};

type EvaluationHistoryItem = {
  _id: string;
  fileId: string;
  projectName: string;
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

type EvaluationProjectGroup = {
  projectName: string;
  totalItems: number;
  latestCreatedAt: string;
  formats: EvalFormat[];
  avgOverall: number;
  items: EvaluationHistoryItem[];
};

type EvaluationHistoryResponse = {
  projects: EvaluationProjectGroup[];
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

function normalizeVietnamese(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    return ['socratic', 'encouragement', 'factuality'];
  }
  return ['accuracy', 'clarity', 'completeness'];
}

function metricLabels(format: EvalFormat): [string, string, string] {
  if (format === 'openai') {
    return ['socratic', 'encouragement', 'factuality'];
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
  const [selectedFormat, setSelectedFormat] = useState<'all formats' | EvalFormat>('all formats');
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [projectMinOverallMap, setProjectMinOverallMap] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const queryKey = ['evaluation-history', page, 20, selectedFormat];

  const historyQuery = useQuery<EvaluationHistoryResponse>({
    queryKey,
    queryFn: () =>
      apiService.getEvaluationHistory({
        page,
        limit: 20,
        format: selectedFormat === 'all formats' ? undefined : selectedFormat,
      }),
  });

  const projectsFromServer = historyQuery.data?.projects ?? [];
  const total = historyQuery.data?.total ?? 0;
  const totalPages = historyQuery.data?.totalPages ?? 1;

  const projects = useMemo(() => {
    const needle = normalizeVietnamese(projectSearch);
    if (!needle) {
      return projectsFromServer;
    }

    return projectsFromServer.filter((project) =>
      normalizeVietnamese(project.projectName).includes(needle)
    );
  }, [projectSearch, projectsFromServer]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectName) return null;
    return projectsFromServer.find((project) => project.projectName === selectedProjectName) || null;
  }, [projectsFromServer, selectedProjectName]);

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

  const getProjectVisibleItems = (project: EvaluationProjectGroup): EvaluationHistoryItem[] => {
    const minOverallRaw = projectMinOverallMap[project.projectName] ?? '';
    const parsedMin = Number(minOverallRaw);
    const minOverall = Number.isFinite(parsedMin) ? clampScore(parsedMin) : 0;

    const byFormat = selectedFormat === 'all formats'
      ? project.items
      : project.items.filter((item) => item.format === selectedFormat);

    return byFormat.filter((item) => item.results.overall >= minOverall);
  };

  const selectedProjectItems = selectedProject ? getProjectVisibleItems(selectedProject) : [];
  const detailMetricFormat: EvalFormat = useMemo(() => {
    if (selectedFormat !== 'all formats') {
      return selectedFormat;
    }
    return (selectedProjectItems[0]?.format ?? selectedProject?.items[0]?.format ?? 'alpaca') as EvalFormat;
  }, [selectedFormat, selectedProjectItems, selectedProject]);
  const [labelA, labelB, labelC] = metricLabels(detailMetricFormat);

  const handleDownloadProject = (project: EvaluationProjectGroup) => {
    const visibleItems = getProjectVisibleItems(project);
    if (visibleItems.length === 0) {
      toast.error('No visible data to download.');
      return;
    }

    const blob = new Blob([JSON.stringify(visibleItems, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${project.projectName.replace(/\s+/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="bg-slate-50 min-h-screen">
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
              <p className="text-xs text-slate-500">Project-based evaluation records.</p>
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
            {selectedProject ? 'Project Detail' : `${total} projects`}
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {!selectedProject && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 w-full">
            <select
              value={selectedFormat}
              onChange={(e) => {
                const next = e.target.value as 'all formats' | EvalFormat;
                setSelectedFormat(next);
                setPage(1);
                setEditingId(null);
                setDraft(null);
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="all formats">All formats</option>
              <option value="openai">OpenAI</option>
              <option value="alpaca">Alpaca</option>
            </select>

            <input
              type="text"
              value={projectSearch}
              onChange={(e) => {
                setProjectSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search project name (khong dau / co dau)"
              className="w-full max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />

            <button
              onClick={() => historyQuery.refetch()}
              className="px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg bg-white hover:bg-slate-50"
            >
              Refresh
            </button>

            <div className="ml-auto text-xs text-slate-500">
              {projects.length} matching project(s)
            </div>
          </div>
        )}

        {!selectedProject && (
          historyQuery.isLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-500">
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-500">
              No project found.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {projects.map((project) => (
                <section key={project.projectName} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <button
                    onClick={() => {
                      setSelectedProjectName(project.projectName);
                      setEditingId(null);
                      setDraft(null);
                    }}
                    className="w-full h-full min-h-[170px] p-4 flex flex-col items-start justify-between text-left hover:bg-slate-50"
                  >
                    <div className="space-y-2 w-full">
                      <p className="text-base font-semibold text-slate-900 leading-snug break-words">{project.projectName}</p>
                      <div className="space-y-1 text-xs text-slate-500">
                        <p>{project.totalItems} records</p>
                        <p>Avg overall: {project.avgOverall.toFixed(2)}</p>
                        <p>Updated: {toDateTime(project.latestCreatedAt)}</p>
                      </div>
                    </div>

                    <div className="w-full flex items-end justify-between gap-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1 flex-wrap">
                        {project.formats.map((fmt) => (
                          <span key={`${project.projectName}-${fmt}`} className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                            {fmt}
                          </span>
                        ))}
                      </div>
                      <span className="text-slate-500 text-sm">Open</span>
                    </div>
                  </button>
                </section>
              ))}
            </div>
          )
        )}

        {selectedProject && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectedProjectName(null);
                    setEditingId(null);
                    setDraft(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                >
                  Back To Projects
                </button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedProject.projectName}</p>
                  <p className="text-xs text-slate-500">{selectedProject.totalItems} records • Updated: {toDateTime(selectedProject.latestCreatedAt)}</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {selectedProject.formats.map((fmt) => (
                  <span key={`${selectedProject.projectName}-detail-${fmt}`} className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                    {fmt}
                  </span>
                ))}
              </div>
            </div>

            <div className="px-3 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={10}
                step="0.1"
                value={projectMinOverallMap[selectedProject.projectName] ?? ''}
                onChange={(e) =>
                  setProjectMinOverallMap((prev) => ({
                    ...prev,
                    [selectedProject.projectName]: e.target.value,
                  }))
                }
                placeholder="Min Overall Score"
                className="w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              />

              <button
                onClick={() => handleDownloadProject(selectedProject)}
                className="px-3 py-2 text-sm font-semibold text-emerald-700 border border-emerald-300 rounded-lg bg-emerald-50 hover:bg-emerald-100"
              >
                Download
              </button>

              <div className="ml-auto text-xs text-slate-500">
                Showing {selectedProjectItems.length} / {selectedProject.items.length} records
              </div>
            </div>

            <div className="w-full overflow-hidden">
              <table className="w-full text-sm table-auto">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Format</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Data</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelA}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelB}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">{labelC}</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Overall</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Evaluated By</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Updated</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProjectItems.map((item) => {
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
                        className={`border-t border-slate-100 align-top transition-colors duration-300 ${isEditing
                            ? 'bg-emerald-50/90 editing-row-glow ring-1 ring-inset ring-emerald-200'
                            : 'hover:bg-slate-50'
                          }`}
                        onDoubleClick={() => startEdit(item)}
                      >
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                            {item.format}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-800 align-top break-words">
                          {renderDataCell(item)}
                        </td>

                        <td className="px-3 py-3 text-slate-700 align-top whitespace-nowrap">
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
                        <td className="px-3 py-3 text-slate-700 align-top whitespace-nowrap">
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
                        <td className="px-3 py-3 text-slate-700 align-top whitespace-nowrap">
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

                        <td className="px-3 py-3 text-slate-800 font-semibold align-top whitespace-nowrap">{overall}</td>
                        <td className="px-3 py-3 text-slate-700 align-top break-words">
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
                        <td className="px-3 py-3 text-slate-700 align-top whitespace-nowrap">{isEditing ? 'manual' : item.evaluatedBy}</td>
                        <td className="px-3 py-3 text-slate-500 text-xs align-top whitespace-nowrap">{toDateTime(item.updatedAt || item.createdAt)}</td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
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
                  })}

                  {selectedProjectItems.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        No records match this filter in this project.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!selectedProject && (
          <div className="px-4 py-3 border border-slate-200 rounded-xl bg-white flex items-center justify-between">
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
        )}
      </main>
    </div>
  );
};
