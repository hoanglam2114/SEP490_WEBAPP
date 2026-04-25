import type { ReactNode } from 'react';

type CommunityCounts = {
  visible: number;
  total: number;
  rejected: number;
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Public This Version</p>
            <p className="text-xs text-slate-500">
              Share only this dataset version to Community Hub for collaborative labeling.
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleVersionVisibility}
            disabled={isTogglingVersionPublic}
            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${isCurrentVersionPublic
              ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
          >
            {isTogglingVersionPublic ? 'Saving...' : isCurrentVersionPublic ? 'Public: ON' : 'Public: OFF'}
          </button>
        </div>
      )}

      {labelingPanel}
    </div>
  );
}
