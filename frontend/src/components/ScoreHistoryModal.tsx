import { Loader2, X } from 'lucide-react';

type ScoreMap = {
  accuracy?: number | null;
  clarity?: number | null;
  completeness?: number | null;
  socratic?: number | null;
  encouragement?: number | null;
  factuality?: number | null;
  overall?: number | null;
};

export type ScoreHistoryEntry = {
  evaluatedBy: string;
  scores: ScoreMap;
  reason?: string;
  timestamp?: string;
};

type ScoreHistoryModalProps = {
  isOpen: boolean;
  title?: string;
  evaluations: ScoreHistoryEntry[];
  onClose: () => void;
  isLoading?: boolean;
};

function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return Number(value).toFixed(2);
}

function metricLabels(scores: ScoreMap): string[] {
  const labels: string[] = [];
  if (scores.accuracy !== undefined && scores.accuracy !== null) labels.push('accuracy');
  if (scores.clarity !== undefined && scores.clarity !== null) labels.push('clarity');
  if (scores.completeness !== undefined && scores.completeness !== null) labels.push('completeness');
  if (scores.socratic !== undefined && scores.socratic !== null) labels.push('socratic');
  if (scores.encouragement !== undefined && scores.encouragement !== null) labels.push('encouragement');
  if (scores.factuality !== undefined && scores.factuality !== null) labels.push('factuality');
  return labels;
}

function renderScoreSummary(scores: ScoreMap): string {
  const labels = metricLabels(scores);
  const parts = labels.map((label) => {
    const value = scores[label as keyof ScoreMap] as number | null | undefined;
    return `${label}: ${formatValue(value)}`;
  });
  parts.push(`overall: ${formatValue(scores.overall)}`);
  return parts.join(' | ');
}

function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return '-';
  }
  return new Date(timestamp).toLocaleString('vi-VN');
}

export function ScoreHistoryModal({
  isOpen,
  title,
  evaluations,
  onClose,
  isLoading = false,
}: ScoreHistoryModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl rounded-xl border border-gray-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h4 className="text-base font-semibold text-gray-900">{title || 'Score History'}</h4>
            <p className="mt-1 text-xs text-gray-500">{evaluations.length} evaluation(s)</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span>Loading score history...</span>
            </div>
          ) : evaluations.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              No evaluations found.
            </div>
          ) : (
            <table className="min-w-full text-sm table-auto">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Evaluated By</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Scores</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Reason</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Date</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((evaluation, index) => (
                  <tr key={`${evaluation.timestamp || 'none'}-${evaluation.evaluatedBy}-${index}`} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{evaluation.evaluatedBy || '-'}</td>
                    <td className="px-3 py-2 text-gray-700 break-words">{renderScoreSummary(evaluation.scores || {})}</td>
                    <td className="px-3 py-2 text-gray-700 break-words whitespace-pre-wrap">{evaluation.reason || '-'}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDate(evaluation.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
