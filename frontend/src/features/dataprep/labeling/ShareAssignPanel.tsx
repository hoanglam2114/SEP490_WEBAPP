import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { dataprepApi } from '../api/dataprepApi';
import type { DatasetAssignmentsResponse, ShareUser } from '../../../services/api';

type ShareAssignPanelProps = {
  versionId: string;
  canManage: boolean;
  isCurrentVersionPublic: boolean;
  isTogglingVersionPublic: boolean;
  onToggleVersionVisibility: () => void;
  shareUsers: ShareUser[];
  selectedSharedUserId: string;
  isUpdatingVersionSharing: boolean;
  onUpdateVersionSharing: (userId: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function ShareAssignPanel({
  versionId,
  canManage,
  isCurrentVersionPublic,
  isTogglingVersionPublic,
  onToggleVersionVisibility,
  shareUsers,
  selectedSharedUserId,
  isUpdatingVersionSharing,
  onUpdateVersionSharing,
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

  const assignmentsQuery = useQuery<DatasetAssignmentsResponse>({
    queryKey: ['dataset-version-assignments', versionId],
    queryFn: () => dataprepApi.getDatasetVersionAssignments(versionId),
    enabled: Boolean(versionId && canManage),
  });

  const invalidateAssignments = () => {
    queryClient.invalidateQueries({ queryKey: ['dataset-version-assignments', versionId] });
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
  const totals = assignmentsQuery.data?.totals || { totalSamples: 0, assigned: 0, unassigned: 0 };
  const summary = assignmentsQuery.data?.summary || [];

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

  if (!canManage) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Share & Assign is available only to the project owner.</p>
        <div className="mt-4 flex justify-between">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
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
            <p className="text-sm font-semibold text-slate-900">Public & Share</p>
            <p className="text-xs text-slate-500">Publish this version or grant direct access to one collaborator.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <select
              value={selectedSharedUserId}
              onChange={(event) => onUpdateVersionSharing(event.target.value)}
              disabled={isUpdatingVersionSharing}
              className="h-9 min-w-[260px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 outline-none hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
            >
              <option value="">No specific account</option>
              {shareUsers.map((account) => (
                <option key={account.id} value={account.id}>{account.name} ({account.email})</option>
              ))}
            </select>
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
            <h3 className="text-sm font-semibold text-slate-900">Clear Range</h3>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input value={clearStartIndex} onChange={(event) => setClearStartIndex(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Start" />
              <input value={clearCount} onChange={(event) => setClearCount(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Count" />
            </div>
            <button
              type="button"
              onClick={() => clearRangeMutation.mutate()}
              disabled={clearRangeMutation.isPending}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {clearRangeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Clear
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
                      onClick={() => clearUserMutation.mutate(item.user.id)}
                      disabled={clearUserMutation.isPending}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                      title="Clear this user's assignments"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-600">{item.count} samples: {item.ranges.join(', ') || '-'}</p>
                </div>
              ))}
              {!summary.length && <p className="text-xs text-slate-500">No assignments yet.</p>}
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
              <div key={sample.sampleId} className="grid grid-cols-[70px_1fr_220px] gap-3 border-b border-slate-100 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-600">#{sample.sampleIndex}</span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">{sample.sampleKey}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{sample.preview || '-'}</p>
                </div>
                <div className="min-w-0 text-right">
                  {sample.assignee ? (
                    <>
                      <p className="truncate text-xs font-semibold text-blue-700">{sample.assignee.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{sample.assignee.email}</p>
                    </>
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
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
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
