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
  showRejectedSamples: _showRejectedSamples,
  onToggleRejectedSamples: _onToggleRejectedSamples,
}: LabelingWorkflowPanelProps) {
  return (
    <div className="space-y-3">
      {isCommunityRoute && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex items-center gap-3">
          <div className="text-xs text-slate-600">
            Showing {communityCounts.visible} / {communityCounts.total} samples
            {communityCounts.rejected > 0 ? ` (REJECT>=3: ${communityCounts.rejected})` : ''}
          </div>
        </div>
      )}

      {labelingPanel}
    </div>
  );
}
