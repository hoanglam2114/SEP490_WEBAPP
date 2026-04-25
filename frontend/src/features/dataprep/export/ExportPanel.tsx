import { Download, Sparkles } from 'lucide-react';
import { HuggingFaceUpload } from '../../../components/HuggingFaceUpload';
import { StepNavigation } from '../../../components/StepNavigation';
import type { ConversionResult } from '../../../types';

type ExportPanelProps = {
  conversionResult: ConversionResult | null;
  downloadTestPercentage: number;
  setDownloadTestPercentage: (value: number) => void;
  handleDownloadTrainTestZip: () => void | Promise<void>;
  downloadScoreThreshold: number;
  setDownloadScoreThreshold: (value: number) => void;
  handleDownloadByScore: () => void | Promise<void>;
  setCurrentStep: (step: 9) => void;
};

export function ExportPanel({
  conversionResult,
  downloadTestPercentage,
  setDownloadTestPercentage,
  handleDownloadTrainTestZip,
  downloadScoreThreshold,
  setDownloadScoreThreshold,
  handleDownloadByScore,
  setCurrentStep,
}: ExportPanelProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Download Train/Test Split</p>
            <span className="text-sm font-mono bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-gray-700">
              Test {downloadTestPercentage.toFixed(0)}% / Train {(100 - downloadTestPercentage).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={downloadTestPercentage}
            onChange={(e) => setDownloadTestPercentage(parseFloat(e.target.value))}
            className="w-full"
          />
          <button
            onClick={handleDownloadTrainTestZip}
            disabled={!conversionResult || !conversionResult.data?.length}
            className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 px-4 rounded-lg"
          >
            <Download className="w-4 h-4" />
            <span>Download train/test zip</span>
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Download Filter by Overall Score</p>
            <span className="text-sm font-mono bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-gray-700">
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
            disabled={!conversionResult}
            className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-lg"
          >
            <Download className="w-4 h-4" />
            <span>Download overall &gt;= filter</span>
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 flex gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>Upload final dataset to Hugging Face after validating the split files.</p>
      </div>

      {conversionResult && <HuggingFaceUpload conversionResult={conversionResult} />}

      <StepNavigation showBack onBack={() => setCurrentStep(9)} />
    </div>
  );
}
