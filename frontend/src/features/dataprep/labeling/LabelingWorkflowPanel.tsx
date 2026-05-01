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
};

export function LabelingWorkflowPanel({
  labelingPanel,
  isCommunityRoute,
  communityCounts,
  showRejectedSamples,
  onToggleRejectedSamples,
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

      {labelingPanel}
    </div>
  );
}
