import type { ReactNode } from 'react';
import { StepNavigation } from '../../../components/StepNavigation';

type EvaluationAverage = {
  count: number;
  socratic?: string | number | null;
  encouragement?: string | number | null;
  factuality?: string | number | null;
  accuracy?: string | number | null;
  clarity?: string | number | null;
  completeness?: string | number | null;
  overall?: string | number | null;
};

type EvaluationPanelProps = {
  table: ReactNode;
  averagedEvaluation: EvaluationAverage | null;
  mode: 'openai' | 'alpaca';
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function EvaluationPanel({
  table,
  averagedEvaluation,
  mode,
  onBack,
  onNext,
  nextDisabled,
}: EvaluationPanelProps) {
  return (
    <div className="space-y-5">
      {table}

      {averagedEvaluation && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
          <p className="font-semibold">Average scores ({averagedEvaluation.count} rows)</p>
          <p className="mt-1">
            {mode === 'openai'
              ? `socratic: ${averagedEvaluation.socratic} | encouragement: ${averagedEvaluation.encouragement} | factuality: ${averagedEvaluation.factuality} | overall: ${averagedEvaluation.overall}`
              : `accuracy: ${averagedEvaluation.accuracy} | clarity: ${averagedEvaluation.clarity} | completeness: ${averagedEvaluation.completeness} | overall: ${averagedEvaluation.overall}`}
          </p>
        </div>
      )}

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
