import type { ReactNode } from 'react';
import { StepNavigation } from '../../../components/StepNavigation';

type RefinementPanelProps = {
  table: ReactNode;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function RefinementPanel({ table, onBack, onNext, nextDisabled }: RefinementPanelProps) {
  return (
    <div className="space-y-5">
      {table}

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        Rows refined successfully are highlighted with a light-blue background. Their previous scores are preserved until you re-evaluate visible rows on the current page.
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
