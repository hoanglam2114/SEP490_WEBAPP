import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Scissors } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import { apiService } from '../../../services/api';
import type { ClassifiedSamplesResult, ClassificationGroup } from '../../../services/api';

type ClassifiedItem = ClassifiedSamplesResult['items'][number];

type BalanceDatasetPanelProps = {
  versionId: string;
  alreadyApplied: boolean;
  onApply: (items: ClassifiedItem[], removedCount: number) => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

const SUBJECT_GROUPS: ClassificationGroup[] = ['MATH', 'PHYSICAL', 'CHEMISTRY', 'LITERATURE', 'BIOLOGY'];

const GROUP_LABELS: Record<ClassificationGroup, string> = {
  MATH: 'Math',
  PHYSICAL: 'Physical',
  CHEMISTRY: 'Chemistry',
  LITERATURE: 'Literature',
  BIOLOGY: 'Biology',
  REJECT: 'Reject',
  REWRITE: 'Rewrite',
  OUT_OF_SCOPE: 'Out of scope',
};

function stableShuffle<T extends { _id: string; sampleId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = `${a.sampleId}:${a._id}`;
    const right = `${b.sampleId}:${b._id}`;
    return left.localeCompare(right);
  });
}

export function BalanceDatasetPanel({
  versionId,
  alreadyApplied,
  onApply,
  onBack,
  onNext,
  nextDisabled,
}: BalanceDatasetPanelProps) {
  const [result, setResult] = useState<ClassifiedSamplesResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadClassification = async () => {
    if (!versionId) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiService.getClassifiedSamples(versionId);
      setResult(response);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadClassification();
  }, [versionId]);

  const plan = useMemo(() => {
    const items = result?.items || [];
    const byGroup = new Map<ClassificationGroup, ClassifiedItem[]>();
    items.forEach((item) => {
      const list = byGroup.get(item.group) || [];
      list.push(item);
      byGroup.set(item.group, list);
    });

    const subjectCounts = SUBJECT_GROUPS
      .map((group) => byGroup.get(group)?.length || 0)
      .filter((count) => count > 0);
    const target = subjectCounts.length ? Math.min(...subjectCounts) : 0;

    const keepIds = new Set<string>();
    const rows = SUBJECT_GROUPS.map((group) => {
      const groupItems = byGroup.get(group) || [];
      const keepCount = target > 0 ? Math.min(groupItems.length, target) : groupItems.length;
      stableShuffle(groupItems).slice(0, keepCount).forEach((item) => keepIds.add(item._id));
      return {
        group,
        current: groupItems.length,
        keep: keepCount,
        remove: Math.max(groupItems.length - keepCount, 0),
      };
    });

    const rejectItems = items.filter((item) => item.group === 'REJECT');
    const nonSubjectItems = items.filter((item) => !SUBJECT_GROUPS.includes(item.group) && item.group !== 'REJECT');
    nonSubjectItems.forEach((item) => keepIds.add(item._id));

    const keptItems = items.filter((item) => keepIds.has(item._id));
    const removeCount = items.length - keptItems.length;

    return {
      target,
      rows,
      keptItems,
      removeCount,
      originalCount: items.length,
      finalCount: keptItems.length,
      otherCount: nonSubjectItems.length,
      rejectCount: rejectItems.length,
    };
  }, [result]);

  const canApply = Boolean(result && plan.removeCount > 0 && !alreadyApplied);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <Scissors className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Balance Dataset</h3>
              <p className="text-xs text-gray-500">Trim oversized subject groups before evaluation and export.</p>
            </div>
          </div>

          <button
            onClick={loadClassification}
            disabled={isLoading || !versionId || alreadyApplied}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading balance preview...
          </div>
        ) : alreadyApplied && !result ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center text-sm font-semibold text-emerald-800">
            Balanced dataset has already been applied to the current working data.
          </div>
        ) : !result ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
            Run Classification first to preview the balance plan.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Original</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{plan.originalCount}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Subject target</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{plan.target}</p>
              </div>
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600">Will remove</p>
                <p className="mt-1 text-xl font-bold text-rose-700">{plan.removeCount}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">After apply</p>
                <p className="mt-1 text-xl font-bold text-emerald-700">{plan.finalCount}</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Subject</th>
                    <th className="px-4 py-3 text-right">Current</th>
                    <th className="px-4 py-3 text-right">Keep</th>
                    <th className="px-4 py-3 text-right">Trim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {plan.rows.map((row) => (
                    <tr key={row.group}>
                      <td className="px-4 py-3 font-semibold text-gray-800">{GROUP_LABELS[row.group]}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{row.current}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700">{row.keep}</td>
                      <td className="px-4 py-3 text-right font-mono text-rose-700">{row.remove}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p>
                This preview trims oversized subject groups and removes hard rejected samples. Other buckets are kept unchanged: {plan.otherCount} samples. Reject removed: {plan.rejectCount}.
              </p>
              <button
                onClick={() => onApply(plan.keptItems, plan.removeCount)}
                disabled={!canApply}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:bg-gray-300"
              >
                <CheckCircle2 className="h-4 w-4" />
                {alreadyApplied ? 'Applied' : 'Accept & apply'}
              </button>
            </div>
          </div>
        )}
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled || isLoading || (!result && !alreadyApplied)} />
    </div>
  );
}
