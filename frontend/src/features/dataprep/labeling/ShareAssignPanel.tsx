import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, Gauge, Loader2, RefreshCw, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { dataprepApi } from '../api/dataprepApi';
import type { AssignmentDashboardResponse, DatasetAssignmentsResponse, ShareUser } from '../../../services/api';
import { AssignmentSubmissionDetailModal } from './AssignmentSubmissionDetailModal';
import { AssignmentConflictComparisonModal } from './AssignmentConflictComparisonModal';

type ShareAssignPanelProps = {
  versionId: string;
  canManage: boolean;
  disableBack?: boolean;
  isCurrentVersionPublic: boolean;
  isTogglingVersionPublic: boolean;
  onToggleVersionVisibility: () => void;
  shareUsers: ShareUser[];
  onBack: () => void;
  onNext: () => void;
};

export function ShareAssignPanel({
  versionId,
  canManage,
  disableBack = false,
  isCurrentVersionPublic,
  isTogglingVersionPublic,
  onToggleVersionVisibility,
  shareUsers,
  onBack,
  onNext,
}: ShareAssignPanelProps) {
  const queryClient = useQueryClient();
  const [assigneeId, setAssigneeId] = useState('');
  const [startIndex, setStartIndex] = useState('1');
  const [count, setCount] = useState('20');
  const [clearStartIndex, setClearStartIndex] = useState('1');
  const [clearCount, setClearCount] = useState('20');
  const [conflictMessage, setConflictMessage] = useState('');
  const [reviewAssignee, setReviewAssignee] = useState<ShareUser | null>(null);
  const [comparisonSampleId, setComparisonSampleId] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<null | { type: 'range'; startIndex: number; count: number } | { type: 'user'; user: ShareUser }>(null);

  const assignmentsQuery = useQuery<DatasetAssignmentsResponse>({
    queryKey: ['dataset-version-assignments', versionId],
    queryFn: () => dataprepApi.getDatasetVersionAssignments(versionId),
    enabled: Boolean(versionId && canManage),
    refetchInterval: 10000,
  });

  const dashboardQuery = useQuery<AssignmentDashboardResponse>({
    queryKey: ['dataset-version-assignment-dashboard', versionId],
    queryFn: () => dataprepApi.getDatasetVersionAssignmentDashboard(versionId),
    enabled: Boolean(versionId && canManage),
    refetchInterval: 10000,
  });

  const invalidateAssignments = () => {
    queryClient.invalidateQueries({ queryKey: ['dataset-version-assignments', versionId] });
    queryClient.invalidateQueries({ queryKey: ['dataset-version-assignment-dashboard', versionId] });
  };

  const assignMutation = useMutation({
    mutationFn: () => dataprepApi.assignDatasetVersionRange(versionId, {
      assigneeId,
      startIndex: Number(startIndex),
      count: Number(count),
    }),
    onSuccess: (payload) => {
      setConflictMessage('');
      toast.success(payload.message || 'Assigned samples.');
      invalidateAssignments();
    },
    onError: (error: any) => {
      const conflicts = error?.response?.data?.conflicts || [];
      const detail = conflicts.length
        ? conflicts.slice(0, 5).map((item: any) => `#${item.sampleIndex} ${item.assignee?.name || ''}`.trim()).join(', ')
        : '';
      const message = error?.response?.data?.error || error?.message || 'Assign range failed.';
      setConflictMessage(detail ? `${message} (${detail})` : message);
      toast.error(message);
    },
  });

  const clearRangeMutation = useMutation({
    mutationFn: () => dataprepApi.clearDatasetVersionAssignmentRange(versionId, {
      startIndex: Number(clearStartIndex),
      count: Number(clearCount),
    }),
    onSuccess: (payload) => {
      toast.success(payload.message || 'Cleared assignments.');
      invalidateAssignments();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Clear range failed.');
    },
  });

  const clearUserMutation = useMutation({
    mutationFn: (userId: string) => dataprepApi.clearDatasetVersionUserAssignments(versionId, userId),
    onSuccess: (payload) => {
      toast.success(payload.message || 'Cleared user assignments.');
      invalidateAssignments();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Clear user assignments failed.');
    },
  });

  const samples = assignmentsQuery.data?.samples || [];
  const totals = assignmentsQuery.data?.totals || { totalSamples: 0, assigned: 0, unassigned: 0, pendingConflicts: 0 };
  const summary = assignmentsQuery.data?.summary || [];
  const isRefreshingAssignments = assignmentsQuery.isFetching && !assignmentsQuery.isLoading;
  const dashboard = dashboardQuery.data;
  const conflicts = dashboard?.conflicts || [];

  const selectedRangeLabel = useMemo(() => {
    const start = Number(startIndex);
    const size = Number(count);
    if (!Number.isInteger(start) || !Number.isInteger(size) || start < 1 || size < 1) {
      return '';
    }
    return `Samples ${start}-${start + size - 1}`;
  }, [count, startIndex]);

  const canAssign = Boolean(
    assigneeId &&
    Number.isInteger(Number(startIndex)) &&
    Number(startIndex) >= 1 &&
    Number.isInteger(Number(count)) &&
    Number(count) >= 1
  );
  const canResetRange = Number.isInteger(Number(clearStartIndex))
    && Number(clearStartIndex) >= 1
    && Number.isInteger(Number(clearCount))
    && Number(clearCount) >= 1;

  if (!canManage) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Share & Assign is available only to the project owner.</p>
        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={disableBack ? undefined : onBack}
            disabled={disableBack}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              disableBack
                ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <button type="button" onClick={onNext} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Public Access</p>
            <p className="text-xs text-slate-500">Publish this version publicly while managing assignee ranges below.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => assignmentsQuery.refetch()}
              disabled={assignmentsQuery.isLoading || isRefreshingAssignments}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingAssignments ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onToggleVersionVisibility}
              disabled={isTogglingVersionPublic}
              className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${isCurrentVersionPublic
                ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
            >
              {isTogglingVersionPublic ? 'Saving...' : isCurrentVersionPublic ? 'Public: ON' : 'Public: OFF'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{dashboard?.overview.totalAssignedSamples ?? totals.assigned}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assignees</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{dashboard?.overview.totalAssignees ?? summary.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In Progress</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{dashboard?.overview.inProgressAssignees ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</p>
          <p className="mt-2 text-2xl font-bold text-blue-700">{dashboard?.overview.submittedAssignees ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Decisions</p>
          <p className="mt-2 text-2xl font-bold text-violet-700">{dashboard?.overview.savedDecisionCount ?? 0}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Needs Review</p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{dashboard?.overview.pendingConflicts ?? totals.pendingConflicts ?? 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Published</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{dashboard?.overview.publishedDecisionCount ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Assign Range</h3>
            </div>
            <div className="mt-4 space-y-3">
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Select user</option>
                {shareUsers.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} ({account.email})</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input value={startIndex} onChange={(event) => setStartIndex(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Start" />
                <input value={count} onChange={(event) => setCount(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Count" />
              </div>
              {selectedRangeLabel && <p className="text-xs font-medium text-slate-500">{selectedRangeLabel}</p>}
              {conflictMessage && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{conflictMessage}</p>}
              <button
                type="button"
                onClick={() => assignMutation.mutate()}
                disabled={!canAssign || assignMutation.isPending}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {assignMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Assign
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Reset Assignment Range</h3>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input value={clearStartIndex} onChange={(event) => setClearStartIndex(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Start" />
              <input value={clearCount} onChange={(event) => setClearCount(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Count" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Reset sẽ xóa assignment, submission, labels, activity và conflict/final labels liên quan trong phạm vi này.
            </p>
            <button
              type="button"
              onClick={() => {
                if (!canResetRange) {
                  toast.error('Start và Count phải là số nguyên dương.');
                  return;
                }
                setResetConfirm({
                  type: 'range',
                  startIndex: Number(clearStartIndex),
                  count: Number(clearCount),
                });
              }}
              disabled={clearRangeMutation.isPending}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {clearRangeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset Assignment
            </button>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-bold text-slate-900">{totals.totalSamples}</p>
                <p className="text-[11px] text-slate-500">Total</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                <p className="text-lg font-bold text-emerald-700">{totals.assigned}</p>
                <p className="text-[11px] text-emerald-700">Assigned</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                <p className="text-lg font-bold text-amber-700">{totals.unassigned}</p>
                <p className="text-[11px] text-amber-700">Open</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {summary.map((item) => (
                <div key={item.user.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{item.user.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{item.user.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetConfirm({ type: 'user', user: item.user })}
                      disabled={clearUserMutation.isPending}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                      title="Reset this user's assignments"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-600">{item.count} samples: {item.ranges.join(', ') || '-'}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.submission?.status === 'submitted'
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      {item.submission?.status || 'draft'} · {item.submission?.progress?.completedMessages || 0}/{item.submission?.progress?.requiredMessages || 0}
                    </span>
                    <div className="flex items-center gap-2">
                      {!item.reviewAvailable && (
                        <span className="text-[10px] font-medium text-slate-400">
                          Review available after submit
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (!item.reviewAvailable) {
                            toast.error('Owner chỉ có thể review sau khi assignee submit kết quả.');
                            return;
                          }
                          setReviewAssignee(item.user);
                        }}
                        disabled={!item.reviewAvailable}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                        title={item.reviewAvailable ? 'View assignment labeling detail' : 'Review available after submit'}
                      >
                        <Eye className="h-3 w-3" />
                        View
                      </button>
                    </div>
                  </div>
                  {item.submission?.submittedAt && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Submitted: {new Date(item.submission.submittedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
              {!summary.length && <p className="text-xs text-slate-500">No assignments yet.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Realtime Productivity</h3>
            </div>
            <div className="mt-3 space-y-2">
              {(dashboard?.users || []).map((item) => (
                <div key={item.user.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{item.user.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{item.user.email}</p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {item.labelsPerHour} label/h
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-600">
                    {item.completedTargets}/{item.totalTargets} targets · {item.completionPercent}% · {item.assignedSamples} samples
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Latest: {item.latestActivityAt ? new Date(item.latestActivityAt).toLocaleString() : 'No activity yet'}
                  </p>
                </div>
              ))}
              {!dashboard?.users?.length && <p className="text-xs text-slate-500">No productivity data yet.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              <h3 className="text-sm font-semibold text-slate-900">Conflict Review Queue</h3>
            </div>
            <div className="mt-3 space-y-2">
              {conflicts.map((item) => (
                <button
                  key={item.sampleId}
                  type="button"
                  onClick={() => setComparisonSampleId(item.sampleId)}
                  className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left hover:bg-rose-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-rose-900">#{item.sampleIndex} · {item.sampleKey}</p>
                    <span className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-semibold ${
                      item.status === 'resolved_unpublished'
                        ? 'border-violet-200 text-violet-700'
                        : 'border-rose-200 text-rose-700'
                    }`}>
                      {item.status === 'resolved_unpublished' ? 'decision saved' : `${item.pendingAdjudicationCount} pending`}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-rose-700">
                    IAA {typeof item.agreementScore === 'number' ? item.agreementScore.toFixed(2) : 'N/A'} · {item.assigneeCount} annotators
                  </p>
                </button>
              ))}
              {!conflicts.length && <p className="text-xs text-slate-500">No conflicts detected.</p>}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Samples</h3>
          </div>
          <div className="max-h-[620px] overflow-auto">
            {assignmentsQuery.isLoading && (
              <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading assignments...
              </div>
            )}
            {!assignmentsQuery.isLoading && samples.map((sample) => (
              <div key={sample.sampleId} className={`grid grid-cols-[70px_1fr_220px] gap-3 border-b px-4 py-3 text-sm ${sample.hasConflict ? 'border-rose-100 bg-rose-50/40' : 'border-slate-100'}`}>
                <span className="font-semibold text-slate-600">#{sample.sampleIndex}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-slate-800">{sample.sampleKey}</p>
                    {sample.hasConflict && (
                      <button
                        type="button"
                        onClick={() => setComparisonSampleId(sample.sampleId)}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Conflict
                      </button>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{sample.preview || '-'}</p>
                  {sample.hasConflict && (
                    <p className="mt-1 text-[10px] text-rose-600">
                      IAA {typeof sample.lowestAgreementScore === 'number' ? sample.lowestAgreementScore.toFixed(2) : 'N/A'} · {sample.pendingAdjudicationCount || 0} pending adjudication
                    </p>
                  )}
                </div>
                <div className="min-w-0 text-right">
                  {sample.assignees && sample.assignees.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {sample.assignees.map((u) => (
                        <div key={u.id} className="border-b border-slate-50 pb-1 last:border-0 last:pb-0">
                          <p className="truncate text-xs font-semibold text-blue-700">{u.name}</p>
                          <p className="truncate text-[11px] text-slate-500">{u.email}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500">Unassigned</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={disableBack ? undefined : onBack}
          disabled={disableBack}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
            disableBack
              ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button type="button" onClick={onNext} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <AssignmentSubmissionDetailModal
        isOpen={Boolean(reviewAssignee)}
        versionId={versionId}
        assignee={reviewAssignee}
        onClose={() => setReviewAssignee(null)}
      />
      <AssignmentConflictComparisonModal
        isOpen={Boolean(comparisonSampleId)}
        versionId={versionId}
        sampleId={comparisonSampleId}
        onClose={() => setComparisonSampleId(null)}
        onResolved={() => {
          invalidateAssignments();
          dashboardQuery.refetch();
        }}
      />
      {resetConfirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Confirm Reset Assignment</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {resetConfirm.type === 'range'
                ? `Reset assignment range #${resetConfirm.startIndex}-${resetConfirm.startIndex + resetConfirm.count - 1}.`
                : `Reset all assignments of ${resetConfirm.user.name || resetConfirm.user.email}.`}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-rose-600">
              Thao tác này sẽ xóa assignment, submission, labels, activity, conflict labels và cả previously published final labels của các sample bị ảnh hưởng. Nếu assign lại sau đó, assignee sẽ phải gán nhãn từ đầu.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetConfirm(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (resetConfirm.type === 'range') {
                    clearRangeMutation.mutate(undefined, {
                      onSettled: () => setResetConfirm(null),
                    });
                    return;
                  }
                  clearUserMutation.mutate(resetConfirm.user.id, {
                    onSettled: () => setResetConfirm(null),
                  });
                }}
                disabled={clearRangeMutation.isPending || clearUserMutation.isPending}
                className="rounded-lg border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {clearRangeMutation.isPending || clearUserMutation.isPending ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
