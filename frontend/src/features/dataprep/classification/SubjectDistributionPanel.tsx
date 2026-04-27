import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, PieChart, RefreshCw } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import { apiService } from '../../../services/api';
import type { ClassificationGroup, ClassificationSummaryGroup, QualityClassificationResult } from '../../../services/api';

type SubjectDistributionPanelProps = {
  versionId: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

const SUBJECT_GROUPS: ClassificationGroup[] = ['MATH', 'PHYSICAL', 'CHEMISTRY', 'LITERATURE', 'BIOLOGY'];

const GROUP_META: Record<ClassificationGroup, { label: string; color: string; text: string }> = {
  MATH: { label: 'Math', color: '#2563eb', text: 'text-blue-700' },
  PHYSICAL: { label: 'Physical', color: '#ea580c', text: 'text-orange-700' },
  CHEMISTRY: { label: 'Chemistry', color: '#16a34a', text: 'text-green-700' },
  LITERATURE: { label: 'Literature', color: '#9333ea', text: 'text-purple-700' },
  BIOLOGY: { label: 'Biology', color: '#0d9488', text: 'text-teal-700' },
  REJECT: { label: 'Reject', color: '#e11d48', text: 'text-rose-700' },
  REWRITE: { label: 'Rewrite', color: '#d97706', text: 'text-amber-700' },
  OUT_OF_SCOPE: { label: 'Out of scope', color: '#64748b', text: 'text-slate-700' },
};

function buildConicGradient(items: ClassificationSummaryGroup[], total: number): string {
  if (!items.length || total <= 0) {
    return '#e5e7eb';
  }

  let cursor = 0;
  const segments = items.map((item) => {
    const next = cursor + (item.count / total) * 100;
    const color = GROUP_META[item.group]?.color || '#64748b';
    const segment = `${color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`;
    cursor = next;
    return segment;
  });

  return `conic-gradient(${segments.join(', ')})`;
}

export function SubjectDistributionPanel({
  versionId,
  onBack,
  onNext,
  nextDisabled,
}: SubjectDistributionPanelProps) {
  const [summary, setSummary] = useState<ClassificationSummaryGroup[]>([]);
  const [qualityResult, setQualityResult] = useState<QualityClassificationResult | null>(null);
  const [totalSamples, setTotalSamples] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'subject' | 'quality'>('subject');

  const loadSummary = async () => {
    if (!versionId) {
      return;
    }

    setIsLoading(true);
    try {
      const [res, qualityRes] = await Promise.all([
        apiService.getClassifiedSamples(versionId),
        apiService.getQualityClassifiedSamples(versionId),
      ]);
      setSummary(res.groups || []);
      setTotalSamples(res.totalSamples || 0);
      setQualityResult(qualityRes);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [versionId]);

  const subjectRows = useMemo(() => {
    const lookup = new Map(summary.map((item) => [item.group, item]));
    return SUBJECT_GROUPS.map((group) => ({
      group,
      count: lookup.get(group)?.count || 0,
      percentage: lookup.get(group)?.percentage || 0,
    }));
  }, [summary]);

  const subjectTotal = subjectRows.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...subjectRows.map((item) => item.count), 1);
  const nonSubjectRows = summary.filter((item) => !SUBJECT_GROUPS.includes(item.group));
  const chartBackground = buildConicGradient(summary, totalSamples);
  const qualityGroups = qualityResult?.groups || [];
  const wrongPairs = qualityResult?.wrongPairs || qualityResult?.summary?.wrongPairs || [];
  const maxWrongPairCount = Math.max(...wrongPairs.map((item) => item.count), 1);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Distribution</h3>
              <p className="text-xs text-gray-500">Subject distribution and quality error patterns.</p>
            </div>
          </div>

          <button
            onClick={loadSummary}
            disabled={isLoading || !versionId}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('subject')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === 'subject' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Subject Distribution
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quality')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === 'quality' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Quality Distribution
          </button>
        </div>

        {isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading distribution...
          </div>
        ) : activeTab === 'subject' && totalSamples <= 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
            Run Classification first to generate subject distribution data.
          </div>
        ) : activeTab === 'subject' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="space-y-4">
                {subjectRows.map((item) => {
                  const meta = GROUP_META[item.group];
                  const width = `${Math.max((item.count / maxCount) * 100, item.count > 0 ? 3 : 0)}%`;
                  const totalPercentage = totalSamples > 0 ? ((item.count / totalSamples) * 100).toFixed(2) : '0.00';

                  return (
                    <div key={item.group} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                          <span className={`font-bold ${meta.text}`}>{meta.label}</span>
                        </div>
                        <div className="flex items-center gap-3 font-semibold text-gray-700">
                          <span className="text-gray-400">{totalPercentage}%</span>
                          <span className="min-w-[44px] text-right">{item.count}</span>
                        </div>
                      </div>
                      <div className="h-4 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full" style={{ width, backgroundColor: meta.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-5">
                <div className="relative h-44 w-44 rounded-full" style={{ background: chartBackground }}>
                  <div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
                    <PieChart className="mb-1 h-5 w-5 text-gray-400" />
                    <span className="text-xl font-bold text-gray-900">{subjectTotal}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">subject samples</span>
                  </div>
                </div>
                <div className="mt-4 grid w-full grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white p-3 text-center">
                    <p className="font-bold text-gray-900">{totalSamples}</p>
                    <p className="text-gray-500">Total</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 text-center">
                    <p className="font-bold text-gray-900">{nonSubjectRows.reduce((sum, item) => sum + item.count, 0)}</p>
                    <p className="text-gray-500">Other</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : !qualityResult || qualityResult.totalSamples <= 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
            Run Quality Classification first to generate quality distribution data.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 gap-3">
                {qualityGroups.map((item) => {
                  const tone = item.group === 'Gold'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : item.group === 'Rewrite'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700';
                  return (
                    <div key={item.group} className={`rounded-xl border p-4 ${tone}`}>
                      <p className="text-xs font-bold uppercase">{item.group}</p>
                      <p className="mt-1 text-3xl font-black text-gray-900">{item.count}</p>
                      <p className="text-xs font-semibold text-gray-500">{item.percentage}% classified samples</p>
                    </div>
                  );
                })}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="font-bold text-gray-900">{qualityResult.totalSamples}</p>
                    <p className="text-gray-500">Total</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="font-bold text-gray-900">{qualityResult.classifiedSamples}</p>
                    <p className="text-gray-500">Classified</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="font-bold text-gray-900">{qualityResult.skippedSamples}</p>
                    <p className="text-gray-500">Skipped</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  <div>
                    <p className="text-sm font-bold text-rose-900">Most Frequent Wrong Intent-Action Pairs</p>
                    <p className="text-xs text-rose-700">Pairs where Assistant action does not match Student intent.</p>
                  </div>
                </div>

                {wrongPairs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-rose-200 bg-white p-6 text-center text-sm text-gray-500">
                    No wrong Intent-Action pairs found in classified quality samples.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {wrongPairs.slice(0, 12).map((item) => {
                      const width = `${Math.max((item.count / maxWrongPairCount) * 100, 4)}%`;
                      return (
                        <div key={`${item.intent}:${item.action}`} className="rounded-lg bg-white p-3">
                          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <span className="font-black text-gray-900">{item.intent}</span>
                              <span className="mx-2 text-gray-400">→</span>
                              <span className="font-black text-rose-700">{item.action}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {item.criticalFailures > 0 && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                                  critical {item.criticalFailures}
                                </span>
                              )}
                              <span className="min-w-[36px] text-right font-bold text-gray-900">{item.count}</span>
                            </div>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-rose-100">
                            <div className="h-full rounded-full bg-rose-500" style={{ width }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subject' && nonSubjectRows.length > 0 && totalSamples > 0 && (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Other Classification Buckets</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {nonSubjectRows.map((item) => {
                const meta = GROUP_META[item.group] || GROUP_META.OUT_OF_SCOPE;
                return (
                  <div key={item.group} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
                    <span className={`font-bold ${meta.text}`}>{meta.label}</span>
                    <span className="font-semibold text-gray-700">{item.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
