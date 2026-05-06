import { AlertTriangle, Loader2, ShieldCheck, Shuffle } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import type { SafeSplitResult } from '../../../services/api';

type SplitGuardPanelProps = {
  totalSamples: number;
  testPercentage: number;
  setTestPercentage: (value: number) => void;
  threshold: number;
  setThreshold: (value: number) => void;
  maxAttempts: number;
  setMaxAttempts: (value: number) => void;
  result: SafeSplitResult | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
};

export function SplitGuardPanel({
  totalSamples,
  testPercentage,
  setTestPercentage,
  threshold,
  setThreshold,
  maxAttempts,
  setMaxAttempts,
  result,
  isGenerating,
  onGenerate,
  onBack,
  onNext,
  nextDisabled,
}: SplitGuardPanelProps) {
  const statusTone = !result
    ? 'border-slate-200 bg-slate-50 text-slate-700'
    : result.resolved
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-rose-200 bg-rose-50 text-rose-700';

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Split Guard</h2>
            <p className="mt-1 text-sm text-slate-500">
              Generate a train/test split with semantic conflict checking handled by the GPU service.
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={isGenerating || totalSamples === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
            <span>Generate safe split</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total samples</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{totalSamples}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Test percentage</div>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {testPercentage.toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={testPercentage}
              onChange={(e) => setTestPercentage(Number(e.target.value))}
              className="mt-3 w-full"
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Semantic threshold</div>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {threshold.toFixed(3)}
              </span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1"
              step="0.001"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-3 w-full"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Max attempts</div>
            <p className="mt-1 text-sm text-slate-500">The GPU service will reshuffle until the split is clean or this limit is reached.</p>
          </div>
          <input
            type="number"
            min="1"
            max="100"
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:w-28"
          />
        </div>
      </div>

      <div className={`rounded-xl border p-5 ${statusTone}`}>
        <div className="flex items-center gap-2">
          {result?.resolved ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          <h3 className="text-sm font-semibold">
            {!result ? 'No split generated yet' : result.resolved ? 'Resolved' : 'Conflicts remain'}
          </h3>
        </div>
        {!result ? (
          <p className="mt-2 text-sm">Generate a safe split before moving to export.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Train</div>
              <div className="mt-1 text-2xl font-bold">{result.trainCount}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Test</div>
              <div className="mt-1 text-2xl font-bold">{result.testCount}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Attempts</div>
              <div className="mt-1 text-2xl font-bold">{result.attempts}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Conflicts</div>
              <div className="mt-1 text-2xl font-bold">{result.conflictCount}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Max similarity</div>
              <div className="mt-1 text-2xl font-bold">{Number(result.maxCrossSplitSimilarity || 0).toFixed(2)}</div>
            </div>
          </div>
        )}
        {!!result?.conflictsPreview?.length && (
          <div className="mt-4 rounded-lg border border-current/15 bg-white/60 p-3 text-sm">
            <div className="font-semibold">Top conflicts</div>
            <div className="mt-2 space-y-1">
              {result.conflictsPreview.slice(0, 5).map((conflict, index) => (
                <div key={`${conflict.trainIndex}-${conflict.testIndex}-${index}`}>
                  Train #{conflict.trainIndex} vs Test #{conflict.testIndex} - similarity {Number(conflict.similarity).toFixed(2)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
