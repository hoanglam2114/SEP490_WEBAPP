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
  progressCount: number;
  totalCount: number;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function EvaluationPanel({
  table,
  averagedEvaluation,
  mode,
  progressCount,
  totalCount,
  onBack,
  onNext,
  nextDisabled,
}: EvaluationPanelProps) {
  const safeTotal = Math.max(0, totalCount);
  const safeProgress = Math.max(0, Math.min(progressCount, safeTotal));
  const progressPercent = safeTotal > 0 ? Math.round((safeProgress / safeTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      {table}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Evaluation progress</p>
          <p>{safeProgress}/{safeTotal} rows</p>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-emerald-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-emerald-800">{progressPercent}% of current evaluation dataset has scores.</p>
      </div>

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
