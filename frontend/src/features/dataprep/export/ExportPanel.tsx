import { Download, Sparkles } from 'lucide-react';
import { HuggingFaceUpload } from '../../../components/HuggingFaceUpload';
import { StepNavigation } from '../../../components/StepNavigation';
import type { SafeSplitResult } from '../../../services/api';

type ExportPanelProps = {
  splitGuardResult: SafeSplitResult | null;
  exportSampleCount: number;
  handleDownloadTrainTestZip: () => void | Promise<void>;
  downloadScoreThreshold: number;
  setDownloadScoreThreshold: (value: number) => void;
  handleDownloadByScore: () => void | Promise<void>;
  huggingFaceUpload?: {
    fileName: string;
    content: string;
  } | null;
  onBack: () => void;
};

export function ExportPanel({
  splitGuardResult,
  exportSampleCount,
  handleDownloadTrainTestZip,
  downloadScoreThreshold,
  setDownloadScoreThreshold,
  handleDownloadByScore,
  huggingFaceUpload,
  onBack,
}: ExportPanelProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Download Locked Train/Test Split</p>
            <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-sm font-mono text-gray-700">
              {splitGuardResult
                ? `Train ${splitGuardResult.trainCount} / Test ${splitGuardResult.testCount}`
                : 'No split'}
            </span>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            Export uses the safe split generated in the previous step. Random splitting is disabled here.
          </div>
          <button
            onClick={handleDownloadTrainTestZip}
            disabled={!splitGuardResult?.resolved || exportSampleCount <= 0}
            className="flex w-full items-center justify-center space-x-2 rounded-lg bg-green-600 px-4 py-3 font-bold text-white hover:bg-green-700 disabled:bg-gray-300"
          >
            <Download className="h-4 w-4" />
            <span>Download train/test zip</span>
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Download Split Filter by Overall Score</p>
            <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-sm font-mono text-gray-700">
              {downloadScoreThreshold.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="0.1"
            value={downloadScoreThreshold}
            onChange={(e) => setDownloadScoreThreshold(parseFloat(e.target.value))}
            className="w-full"
          />
          <button
            onClick={handleDownloadByScore}
            disabled={!splitGuardResult?.resolved || exportSampleCount <= 0}
            className="flex w-full items-center justify-center space-x-2 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
          >
            <Download className="h-4 w-4" />
            <span>Download split overall &gt;= filter</span>
          </button>
        </div>
      </div>

      <div className="flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>Push the locked train/test split after validating the generated files.</p>
      </div>

      {(huggingFaceUpload || exportSampleCount > 0) && (
        <HuggingFaceUpload customUpload={huggingFaceUpload || null} />
      )}

      <StepNavigation showBack onBack={onBack} />
    </div>
  );
}
