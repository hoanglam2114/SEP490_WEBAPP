import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Save, Wand2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { dataprepApi } from '../api/dataprepApi';
import type { AssignmentSampleComparisonResponse } from '../../../services/api';

type AssignmentConflictComparisonModalProps = {
  isOpen: boolean;
  versionId: string;
  sampleId: string | null;
  onClose: () => void;
  onResolved: () => void;
};

export function AssignmentConflictComparisonModal({
  isOpen,
  versionId,
  sampleId,
  onClose,
  onResolved,
}: AssignmentConflictComparisonModalProps) {
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const comparisonQuery = useQuery<AssignmentSampleComparisonResponse>({
    queryKey: ['assignment-sample-comparison', versionId, sampleId],
    queryFn: () => dataprepApi.getDatasetVersionAssignmentSampleComparison(versionId, sampleId || ''),
    enabled: isOpen && Boolean(versionId && sampleId),
  });

  const currentTarget = useMemo(
    () => comparisonQuery.data?.targets.find((target) => target.targetKey === selectedTargetKey) || comparisonQuery.data?.targets[0] || null,
    [comparisonQuery.data?.targets, selectedTargetKey]
  );

  const moveToNextPendingTarget = (targets: AssignmentSampleComparisonResponse['targets'], currentKey: string) => {
    if (!targets.length) {
      return;
    }

    const currentIndex = Math.max(targets.findIndex((target) => target.targetKey === currentKey), 0);
    const orderedTargets = [
      ...targets.slice(currentIndex + 1),
      ...targets.slice(0, currentIndex + 1),
    ];
    const nextPendingTarget = orderedTargets.find((target) => {
      if (!target.hasConflict) {
        return false;
      }
      return !target.adjudication || target.adjudication.status === 'pending';
    });

    const fallbackTarget = targets.find((target) => target.targetKey === currentKey) || targets[0];
    const nextTarget = nextPendingTarget || fallbackTarget;
    setSelectedTargetKey(nextTarget.targetKey);
    setSelectedLabels(nextTarget.adjudication?.finalLabels?.length ? nextTarget.adjudication.finalLabels : nextTarget.majorityLabels);
    setNote(nextTarget.adjudication?.note || '');
  };

  useEffect(() => {
    if (!comparisonQuery.data?.targets?.length) {
      return;
    }
    const nextTarget = comparisonQuery.data.targets.find((target) => target.targetKey === selectedTargetKey)
      || comparisonQuery.data.targets[0];
    setSelectedTargetKey(nextTarget.targetKey);
    setSelectedLabels(nextTarget.adjudication?.finalLabels?.length ? nextTarget.adjudication.finalLabels : nextTarget.majorityLabels);
    setNote(nextTarget.adjudication?.note || '');
  }, [comparisonQuery.data?.targets, sampleId, selectedTargetKey]);

  const resolveMutation = useMutation({
    mutationFn: () => {
      if (!sampleId || !currentTarget) {
        throw new Error('Missing target selection.');
      }
      return dataprepApi.resolveDatasetVersionAssignmentAdjudication(versionId, sampleId, {
        targetScope: currentTarget.targetScope,
        messageIndex: currentTarget.messageIndex,
        messageRole: currentTarget.messageRole,
        finalLabels: selectedLabels,
        note,
      });
    },
    onSuccess: async (payload) => {
      toast.success(payload.message || 'Adjudication saved.');
      const refreshed = await comparisonQuery.refetch();
      moveToNextPendingTarget(refreshed.data?.targets || [], currentTarget?.targetKey || '');
      onResolved();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Save adjudication failed.');
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      if (!sampleId || !currentTarget) {
        throw new Error('Missing target selection.');
      }
      return dataprepApi.publishDatasetVersionAssignmentAdjudication(versionId, sampleId, {
        targetScope: currentTarget.targetScope,
        messageIndex: currentTarget.messageIndex,
        messageRole: currentTarget.messageRole,
      });
    },
    onSuccess: (payload) => {
      toast.success(payload.message || 'Final labels published.');
      comparisonQuery.refetch();
      onResolved();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Publish final labels failed.');
    },
  });

  const autoPublishMutation = useMutation({
    mutationFn: () => {
      if (!sampleId) {
        throw new Error('Missing sample selection.');
      }
      return dataprepApi.autoPublishDatasetVersionAssignmentAdjudications(versionId, sampleId);
    },
    onSuccess: async (payload) => {
      toast.success(
        `${payload.message || 'Auto publish completed.'} Published ${payload.publishedTargets}/${payload.processedTargets}, kept ${payload.skippedZeroIaaTargets} target(s) with IAA = 0.`
      );
      const refreshed = await comparisonQuery.refetch();
      moveToNextPendingTarget(refreshed.data?.targets || [], currentTarget?.targetKey || '');
      onResolved();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Auto publish failed.');
    },
  });

  if (!isOpen || !sampleId) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Conflict Resolution</h3>
            <p className="mt-1 text-xs text-slate-500">
              {comparisonQuery.data?.sample.sampleKey || sampleId}
              {' '}· IAA {typeof comparisonQuery.data?.agreementScore === 'number' ? comparisonQuery.data.agreementScore.toFixed(2) : 'N/A'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_320px] overflow-hidden">
          <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-slate-50/80 p-3">
            <p className="mb-3 text-sm font-semibold text-slate-900">Targets</p>
            <div
              className="max-h-full space-y-2 overflow-y-auto pr-1"
              style={{ height: 'calc(88vh - 150px)', scrollbarGutter: 'stable' }}
            >
              {(comparisonQuery.data?.targets || []).map((target) => (
                <button
                  key={target.targetKey}
                  type="button"
                  onClick={() => {
                    setSelectedTargetKey(target.targetKey);
                    setSelectedLabels(target.adjudication?.finalLabels?.length ? target.adjudication.finalLabels : target.majorityLabels);
                    setNote(target.adjudication?.note || '');
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${
                    target.targetKey === currentTarget?.targetKey
                      ? target.adjudication?.status === 'published'
                        ? 'border-emerald-300 bg-emerald-50'
                        : 'border-blue-300 bg-blue-50'
                      : target.adjudication?.status === 'published'
                        ? 'border-emerald-200 bg-emerald-50'
                      : target.hasConflict
                        ? 'border-rose-200 bg-rose-50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-900">
                    {target.targetScope === 'sample'
                      ? 'Conversation'
                      : `${target.messageRole} #${(target.messageIndex || 0) + 1}`}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    IAA {typeof target.agreementScore === 'number' ? target.agreementScore.toFixed(2) : 'N/A'}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-4">
            {comparisonQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading comparison...
              </div>
            )}

            {!comparisonQuery.isLoading && currentTarget && (
              <div className="space-y-4">
                <div className={`rounded-xl border px-4 py-3 ${currentTarget.hasConflict ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center gap-2">
                    {currentTarget.hasConflict && <AlertTriangle className="h-4 w-4 text-rose-600" />}
                    <p className="text-sm font-semibold text-slate-900">
                      {currentTarget.targetScope === 'sample'
                        ? 'Conversation target'
                        : `${currentTarget.messageRole} message #${(currentTarget.messageIndex || 0) + 1}`}
                    </p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{currentTarget.targetTextSnapshot || '-'}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {currentTarget.annotators.map((item) => (
                    <div
                      key={item.annotator.id}
                      className={`rounded-xl border bg-white p-3 ${
                        item.isOwner ? 'border-blue-300 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900">{item.annotator.name || item.annotator.email}</p>
                        {item.isOwner && (
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            Owner
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{item.annotator.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.labels.length > 0 ? item.labels.map((label) => (
                          <span key={`${item.annotator.id}-${label}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                            {label}
                          </span>
                        )) : (
                          <span className="text-xs text-slate-400">No labels</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="min-h-0 border-l border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">Final Decision</p>
              <button
                type="button"
                onClick={() => autoPublishMutation.mutate()}
                disabled={autoPublishMutation.isPending || comparisonQuery.isLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {autoPublishMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Auto Publish IAA &gt; 0
              </button>
            </div>
            {currentTarget && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentTarget.labelCounts.map((item) => {
                    const selected = selectedLabels.includes(item.name);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => setSelectedLabels((prev) => (
                          prev.includes(item.name)
                            ? prev.filter((label) => label !== item.name)
                            : [...prev, item.name]
                        ))}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          selected
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                      >
                        {item.name} ({item.count})
                      </button>
                    );
                  })}
                </div>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Majority labels</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentTarget.majorityLabels.length > 0 ? currentTarget.majorityLabels.map((label) => (
                    <span key={label} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      {label}
                    </span>
                  )) : (
                    <span className="text-xs text-slate-400">No majority label</span>
                  )}
                </div>

                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Resolution note"
                  className="mt-4 h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                  Status:{' '}
                  {currentTarget.adjudication?.status === 'published'
                    ? 'Published'
                    : currentTarget.adjudication?.status === 'resolved_unpublished'
                      ? 'Decision saved'
                      : 'Pending review'}
                </div>

                <button
                  type="button"
                  onClick={() => resolveMutation.mutate()}
                  disabled={resolveMutation.isPending}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {resolveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Decision
                </button>
                <button
                  type="button"
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || currentTarget.adjudication?.status !== 'resolved_unpublished'}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Publish Final Labels
                </button>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
