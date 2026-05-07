import type { ReactNode } from 'react';
import { StepNavigation } from '../../../components/StepNavigation';

type RefinementPanelProps = {
  table: ReactNode;
  progressCount: number;
  totalCount: number;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function RefinementPanel({ table, progressCount, totalCount, onBack, onNext, nextDisabled }: RefinementPanelProps) {
  const safeTotal = Math.max(0, totalCount);
  const safeProgress = Math.max(0, Math.min(progressCount, safeTotal));
  const progressPercent = safeTotal > 0 ? Math.round((safeProgress / safeTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      {table}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Refine progress</p>
          <p>{safeProgress}/{safeTotal} rows</p>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-emerald-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-emerald-800">{progressPercent}% of current refinement dataset has been updated.</p>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        Rows refined successfully are highlighted with a light-blue background. Their previous scores are preserved until you re-evaluate visible rows on the current page.
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
