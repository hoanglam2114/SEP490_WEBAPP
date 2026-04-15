import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import { Eye, Trash2 } from 'lucide-react';
import { ScoreHistoryModal, type ScoreHistoryEntry } from '../components/ScoreHistoryModal';
import { apiService } from '../services/api';

type EvaluatedBy = 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';

type EvalResults = {
  accuracy?: number | null;
  clarity?: number | null;
  completeness?: number | null;
  socratic?: number | null;
  encouragement?: number | null;
  factuality?: number | null;
  overall: number | null;
  reason: string;
};

type ProjectVersionSummary = {
  _id: string;
  versionName: string;
  similarityThreshold: number;
  totalSamples: number;
  createdAt: string;
  evaluatedCount: number;
  avgOverall: number | null;
};

type ProjectSummary = {
  projectName: string;
  versionCount: number;
  totalSamples: number;
  latestCreatedAt: string;
  versions: ProjectVersionSummary[];
};

type EvaluationHistoryResponse = {
  projects: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type VersionDetailItem = {
  _id: string;
  sampleId: string;
  sampleKey: string;
  data: Record<string, any>;
  evaluatedBy: EvaluatedBy;
  results: EvalResults;
  evaluations?: Array<{
    evaluatedBy: EvaluatedBy;
    scores: EvalResults;
    reason?: string;
    timestamp?: string;
  }>;
  createdAt: string;
  updatedAt?: string;
};

type VersionDetailResponse = {
  datasetVersion: {
    _id: string;
    projectName: string;
    versionName: string;
    similarityThreshold: number;
    totalSamples: number;
    createdAt: string;
  };
  items: VersionDetailItem[];
};

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

function isOpenAIData(data: Record<string, any>): boolean {
  return Array.isArray(data?.messages);
}

function renderDataCell(item: VersionDetailItem): React.ReactNode {
  if (isOpenAIData(item.data)) {
    const messages = Array.isArray(item.data.messages) ? item.data.messages : [];
    return (
      <div className="space-y-1.5">
        {messages.length > 0 ? messages.map((msg, idx) => (
          <div key={`${item._id}-msg-${idx}`} className="whitespace-pre-wrap break-words">
            <span className="font-semibold text-slate-700">{String(msg?.role || 'unknown')}:</span>{' '}
            <span className="text-slate-800">{String(msg?.content || '-')}</span>
          </div>
        )) : (
          <div className="whitespace-pre-wrap break-words text-slate-700">-</div>
        )}
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

function formatScoreDisplay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (Number.isFinite(n) && n === -1) return '';
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function normalizeNullableScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function getEntryTimestamp(entry?: { timestamp?: string }): number {
  const ts = new Date(entry?.timestamp || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeItemEvaluations(item: VersionDetailItem): Array<{
  evaluatedBy: EvaluatedBy;
  scores: EvalResults;
  reason?: string;
  timestamp?: string;
}> {
  if (item.evaluations && item.evaluations.length > 0) {
    return [...item.evaluations];
  }

  return [
    {
      evaluatedBy: item.evaluatedBy,
      scores: item.results,
      reason: item.results.reason,
      timestamp: item.updatedAt || item.createdAt,
    },
  ];
}

function getLatestEvaluationEntry(item: VersionDetailItem) {
  const entries = normalizeItemEvaluations(item);
  if (!entries.length) {
    return null;
  }
  return [...entries].sort((a, b) => getEntryTimestamp(a) - getEntryTimestamp(b))[entries.length - 1] || null;
}

function getAverageEvaluationScores(item: VersionDetailItem): EvalResults {
  const entries = normalizeItemEvaluations(item);
  if (!entries.length) {
    return { overall: null, reason: '' };
  }

  const count = entries.length;
  const sum = entries.reduce(
    (acc, entry) => ({
      accuracy: acc.accuracy + (Number(entry.scores?.accuracy) || 0),
      clarity: acc.clarity + (Number(entry.scores?.clarity) || 0),
      completeness: acc.completeness + (Number(entry.scores?.completeness) || 0),
      socratic: acc.socratic + (Number(entry.scores?.socratic) || 0),
      encouragement: acc.encouragement + (Number(entry.scores?.encouragement) || 0),
      factuality: acc.factuality + (Number(entry.scores?.factuality) || 0),
      overall: acc.overall + (Number(entry.scores?.overall) || 0),
    }),
    {
      accuracy: 0,
      clarity: 0,
      completeness: 0,
      socratic: 0,
      encouragement: 0,
      factuality: 0,
      overall: 0,
    }
  );

  return {
    accuracy: sum.accuracy / count,
    clarity: sum.clarity / count,
    completeness: sum.completeness / count,
    socratic: sum.socratic / count,
    encouragement: sum.encouragement / count,
    factuality: sum.factuality / count,
    overall: sum.overall / count,
    reason: String(getLatestEvaluationEntry(item)?.reason || getLatestEvaluationEntry(item)?.scores?.reason || ''),
  };
}

function getEvaluatedBySummary(item: VersionDetailItem): string {
  const providers = normalizeItemEvaluations(item)
    .map((entry) => String(entry.evaluatedBy || '').trim())
    .filter((provider) => provider && provider !== 'none');

  if (!providers.length) {
    return 'none';
  }

  return Array.from(new Set(providers)).join(', ');
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(objectUrl);
}

export const EvaluationHistory: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [projectMinOverallMap, setProjectMinOverallMap] = useState<Record<string, string>>({});
  const [showUnaudited, setShowUnaudited] = useState(false);
  const [deletedSampleIds, setDeletedSampleIds] = useState<Set<string>>(new Set());

  const [scoreHistoryModalOpen, setScoreHistoryModalOpen] = useState(false);
  const [scoreHistoryModalTitle, setScoreHistoryModalTitle] = useState('Score History');
  const [scoreHistoryItems, setScoreHistoryItems] = useState<ScoreHistoryEntry[]>([]);

  const historyQuery = useQuery<EvaluationHistoryResponse>({
    queryKey: ['evaluation-history', page, projectSearch],
    queryFn: () => apiService.getEvaluationHistory({ page, limit: 20, projectSearch }),
  });

  const projects = historyQuery.data?.projects ?? [];
  const total = historyQuery.data?.total ?? 0;
  const totalPages = historyQuery.data?.totalPages ?? 1;

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectName === selectedProjectName) || null,
    [projects, selectedProjectName]
  );

  const selectedVersion = useMemo(
    () => selectedProject?.versions.find((version) => version._id === selectedVersionId) || null,
    [selectedProject, selectedVersionId]
  );

  const versionQuery = useQuery<VersionDetailResponse>({
    queryKey: ['dataset-version-detail', selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: () => apiService.getDatasetVersionDetail(selectedVersionId as string),
  });

  useEffect(() => {
    setDeletedSampleIds(new Set());
  }, [selectedVersionId]);

  const deleteMutation = useMutation({
    mutationFn: (sampleId: string) => apiService.deleteDatasetVersionItem(sampleId),
    onSuccess: async (_data, sampleId) => {
      setDeletedSampleIds((prev) => {
        const next = new Set(prev);
        next.add(sampleId);
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['dataset-version-detail', selectedVersionId] });
      await queryClient.invalidateQueries({ queryKey: ['evaluation-history'] });
      toast.success('Đã xóa mẫu dữ liệu thành công.');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error.message || 'Xóa mẫu thất bại.');
    },
  });

  const detailItems = versionQuery.data?.items ?? [];

  const filteredProjects = useMemo(() => {
    const needle = normalizeVietnamese(projectSearch);
    if (!needle) return projects;
    return projects.filter((project) => normalizeVietnamese(project.projectName).includes(needle));
  }, [projectSearch, projects]);

  const visibleItems = useMemo(() => {
    const baseItems = detailItems.filter((item) => !deletedSampleIds.has(item.sampleId));
    if (!baseItems.length) return [];

    const minOverallRaw = projectMinOverallMap[selectedProjectName || ''] ?? '';
    const parsedMin = Number(minOverallRaw);
    const minOverall = Number.isFinite(parsedMin) ? Math.min(10, Math.max(0, parsedMin)) : 0;

    return baseItems.filter((item) => {
      const average = getAverageEvaluationScores(item);
      const overall = average.overall;
      const isUnaudited = !Number.isFinite(Number(overall)) || Number(overall) < 0;
      if (isUnaudited) {
        return showUnaudited;
      }
      return Number(overall) >= minOverall;
    });
  }, [deletedSampleIds, detailItems, projectMinOverallMap, selectedProjectName, showUnaudited]);

  const handleContinueEvaluation = () => {
    if (!versionQuery.data?.datasetVersion || !visibleItems.length) {
      toast.error('Không có version detail để tiếp tục đánh giá.');
      return;
    }

    const format = visibleItems[0] && isOpenAIData(visibleItems[0].data) ? 'openai' : 'alpaca';
    const evaluationMap = Object.fromEntries(
      visibleItems.map((item) => {
        const evaluations = normalizeItemEvaluations(item).map((entry) => ({
          evaluatedBy: entry.evaluatedBy,
          scores: {
            accuracy: normalizeNullableScore(entry.scores?.accuracy),
            clarity: normalizeNullableScore(entry.scores?.clarity),
            completeness: normalizeNullableScore(entry.scores?.completeness),
            socratic: normalizeNullableScore(entry.scores?.socratic),
            encouragement: normalizeNullableScore(entry.scores?.encouragement),
            factuality: normalizeNullableScore(entry.scores?.factuality),
            overall: normalizeNullableScore(entry.scores?.overall),
          },
          reason: String(entry.reason || entry.scores?.reason || ''),
          timestamp: entry.timestamp || item.updatedAt || item.createdAt,
        }));

        return [item.sampleKey, { evaluations }];
      })
    );

    navigate('/chatbotconverter', {
      state: {
        loadProject: {
          projectName: versionQuery.data.datasetVersion.projectName,
          format,
          data: format === 'openai'
            ? visibleItems.map((item) => ({ conversation_id: item.sampleKey, messages: item.data.messages || [] }))
            : visibleItems.map((item) => ({ id: item.sampleKey, ...item.data })),
          evaluationMap,
          datasetVersionId: versionQuery.data.datasetVersion._id,
          sampleIdMap: Object.fromEntries(visibleItems.map((item) => [item.sampleKey, item.sampleId])),
        },
      },
    });
  };

  const handleDownloadVersion = () => {
    if (!versionQuery.data?.datasetVersion) {
      return;
    }

    downloadJsonFile(
      `${versionQuery.data.datasetVersion.projectName.replace(/\s+/g, '_')}_${versionQuery.data.datasetVersion.versionName.replace(/\s+/g, '_')}.json`,
      visibleItems
    );
  };

  const handleOpenScoreHistory = (item: VersionDetailItem) => {
    const rows = normalizeItemEvaluations(item).map((entry) => ({
      evaluatedBy: entry.evaluatedBy,
      scores: {
        accuracy: entry.scores?.accuracy ?? null,
        clarity: entry.scores?.clarity ?? null,
        completeness: entry.scores?.completeness ?? null,
        socratic: entry.scores?.socratic ?? null,
        encouragement: entry.scores?.encouragement ?? null,
        factuality: entry.scores?.factuality ?? null,
        overall: entry.scores?.overall ?? null,
      },
      reason: entry.reason || entry.scores?.reason || '',
      timestamp: entry.timestamp,
    }));

    setScoreHistoryItems(rows);
    setScoreHistoryModalTitle(`Xem diem - ${item.sampleKey}`);
    setScoreHistoryModalOpen(true);
  };

  const handleDeleteItem = (item: VersionDetailItem) => {
    const ok = window.confirm('Xóa vĩnh viễn mẫu này?');
    if (!ok) {
      return;
    }
    deleteMutation.mutate(item.sampleId);
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
              <p className="text-xs text-slate-500">Project {'->'} Dataset Version {'->'} Item detail.</p>
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
            {selectedVersion ? selectedVersion.versionName : `${total} projects`}
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {!selectedProject && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 w-full">
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => {
                setProjectSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search project name"
              className="w-full max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />

            <button
              onClick={() => historyQuery.refetch()}
              className="px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg bg-white hover:bg-slate-50"
            >
              Refresh
            </button>

            <div className="ml-auto text-xs text-slate-500">{filteredProjects.length} matching project(s)</div>
          </div>
        )}

        {!selectedProject && (
          historyQuery.isLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-500">Loading projects...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-500">No project found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {filteredProjects.map((project) => (
                <section key={project.projectName} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <button
                    onClick={() => {
                      setSelectedProjectName(project.projectName);
                      setSelectedVersionId(null);
                    }}
                    className="w-full h-full min-h-[170px] p-4 flex flex-col items-start justify-between text-left hover:bg-slate-50"
                  >
                    <div className="space-y-2 w-full">
                      <p className="text-base font-semibold text-slate-900 leading-snug break-words">{project.projectName}</p>
                      <div className="space-y-1 text-xs text-slate-500">
                        <p>{project.versionCount} versions</p>
                        <p>{project.totalSamples} samples</p>
                        <p>Updated: {toDateTime(project.latestCreatedAt)}</p>
                      </div>
                    </div>
                    <span className="text-slate-500 text-sm">Open</span>
                  </button>
                </section>
              ))}
            </div>
          )
        )}

        {selectedProject && !selectedVersion && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectedProjectName(null);
                    setSelectedVersionId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                >
                  Back To Projects
                </button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedProject.projectName}</p>
                  <p className="text-xs text-slate-500">{selectedProject.versionCount} versions • {selectedProject.totalSamples} samples</p>
                </div>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {selectedProject.versions.map((version) => (
                <button
                  key={version._id}
                  onClick={() => {
                    setSelectedVersionId(version._id);
                  }}
                  className="text-left rounded-xl border border-slate-200 bg-slate-50 p-4 hover:bg-white hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{version.versionName}</p>
                      <p className="text-xs text-slate-500 mt-1">Threshold: {version.similarityThreshold.toFixed(2)}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">Open</span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    <p>{version.totalSamples} samples</p>
                    <p>{version.evaluatedCount} evaluated</p>
                    <p>Avg overall: {version.avgOverall === null ? '-' : version.avgOverall.toFixed(2)}</p>
                    <p>Updated: {toDateTime(version.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedProject && selectedVersion && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectedVersionId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                >
                  Back To Versions
                </button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedProject.projectName}</p>
                  <p className="text-xs text-slate-500">{selectedVersion.versionName} • Threshold {selectedVersion.similarityThreshold.toFixed(2)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadVersion}
                  className="px-3 py-2 text-sm font-semibold text-emerald-700 border border-emerald-300 rounded-lg bg-emerald-50 hover:bg-emerald-100"
                >
                  Download
                </button>
                <button
                  onClick={handleContinueEvaluation}
                  className="px-3 py-2 text-sm font-semibold text-indigo-700 border border-indigo-300 rounded-lg bg-indigo-50 hover:bg-indigo-100"
                >
                  Continue Evaluation
                </button>
              </div>
            </div>

            <div className="px-3 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={10}
                step="0.1"
                value={projectMinOverallMap[selectedProject.projectName] ?? '0'}
                onChange={(e) =>
                  setProjectMinOverallMap((prev) => ({
                    ...prev,
                    [selectedProject.projectName]: e.target.value,
                  }))
                }
                placeholder="Min Overall Score"
                className="w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              />

              <label className="inline-flex items-center gap-2 px-2 py-1 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showUnaudited}
                  onChange={(e) => setShowUnaudited(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Hiển thị câu chưa chấm</span>
              </label>

              <div className="ml-auto text-xs text-slate-500">
                Showing {visibleItems.length} / {detailItems.length} records
              </div>
            </div>

            {versionQuery.isLoading ? (
              <div className="px-4 py-10 text-center text-slate-500">Loading dataset version...</div>
            ) : (
              <div className="w-full overflow-hidden">
                <table className="w-full text-sm table-auto">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Data</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Overall</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Reason</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Evaluated By</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Updated</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const averageScores = getAverageEvaluationScores(item);
                      const latest = getLatestEvaluationEntry(item);
                      const evaluatedBySummary = getEvaluatedBySummary(item);

                      return (
                      <tr key={item.sampleId} className="border-t border-slate-100 align-top hover:bg-slate-50">
                        <td className="px-3 py-3 text-slate-800 align-top break-words">{renderDataCell(item)}</td>
                        <td className="px-3 py-3 text-slate-800 font-semibold align-top whitespace-nowrap">{formatScoreDisplay(averageScores.overall)}</td>
                        <td className="px-3 py-3 text-slate-700 align-top break-words">{latest?.reason || latest?.scores?.reason || ''}</td>
                        <td className="px-3 py-3 text-slate-700 align-top whitespace-nowrap">{evaluatedBySummary || latest?.evaluatedBy || 'none'}</td>
                        <td className="px-3 py-3 text-slate-500 text-xs align-top whitespace-nowrap">{toDateTime(latest?.timestamp || item.updatedAt || item.createdAt)}</td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOpenScoreHistory(item)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Xem diem</span>
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item)}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center justify-center p-1.5 rounded border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-60"
                              title="Xoa mau"
                              aria-label="Xoa mau"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}

                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No records match this filter in this version.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
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
            <div className="text-xs text-slate-600">Page {page} / {totalPages}</div>
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

      <ScoreHistoryModal
        isOpen={scoreHistoryModalOpen}
        title={scoreHistoryModalTitle}
        evaluations={scoreHistoryItems}
        onClose={() => setScoreHistoryModalOpen(false)}
      />
    </div>
  );
};
