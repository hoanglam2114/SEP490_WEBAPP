import type { ReactNode } from 'react';

type CommunityCounts = {
  visible: number;
  total: number;
  rejected: number;
};

type ShareUser = {
  id: string;
  name: string;
  email: string;
};

type LabelingWorkflowPanelProps = {
  labelingPanel: ReactNode;
  isCommunityRoute: boolean;
  communityCounts: CommunityCounts;
  showRejectedSamples: boolean;
  onToggleRejectedSamples: () => void;
  canManageVersionVisibility: boolean;
  hasCurrentDatasetVersion: boolean;
  isCurrentVersionPublic: boolean;
  isTogglingVersionPublic: boolean;
  onToggleVersionVisibility: () => void;
  shareUsers: ShareUser[];
  selectedSharedUserId: string;
  isUpdatingVersionSharing: boolean;
  onUpdateVersionSharing: (userId: string) => void;
};

export function LabelingWorkflowPanel({
  labelingPanel,
  isCommunityRoute,
  communityCounts,
  showRejectedSamples,
  onToggleRejectedSamples,
  canManageVersionVisibility,
  hasCurrentDatasetVersion,
  isCurrentVersionPublic,
  isTogglingVersionPublic,
  onToggleVersionVisibility,
  shareUsers,
  selectedSharedUserId,
  isUpdatingVersionSharing,
  onUpdateVersionSharing,
}: LabelingWorkflowPanelProps) {
  return (
    <div className="space-y-3">
      {isCommunityRoute && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            Showing {communityCounts.visible} / {communityCounts.total} samples
            {communityCounts.rejected > 0 ? ` (REJECT>=3: ${communityCounts.rejected})` : ''}
          </div>
          <button
            type="button"
            onClick={onToggleRejectedSamples}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${showRejectedSamples
              ? 'border-rose-300 bg-rose-100 text-rose-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
          >
            {showRejectedSamples ? 'Showing REJECTED (3+)' : 'Show REJECTED samples (3+ votes)'}
          </button>
        </div>
      )}

      {canManageVersionVisibility && hasCurrentDatasetVersion && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Public This Version</p>
            <p className="text-xs text-slate-500">
              Share this dataset version publicly or grant one specific account access for collaborative labeling.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <select
              value={selectedSharedUserId}
              onChange={(event) => onUpdateVersionSharing(event.target.value)}
              disabled={isUpdatingVersionSharing}
              className="h-9 min-w-[240px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
              title="Grant access to one account"
            >
              <option value="">No specific account</option>
              {shareUsers.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.email})
                </option>
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
      )}

      {labelingPanel}
    </div>
  );
}
