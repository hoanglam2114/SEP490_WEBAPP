import { Loader2, Sparkles, Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StepNavigation } from '../../../components/StepNavigation';

export type VisualizationResult = {
  elbow: Array<{ k: number; wcss: number }>;
  kDistance: Array<{ rank: number; distance: number }>;
  pointCount: number;
  noiseCount?: number;
};

type VisualizationPanelProps = {
  visualizationResult: VisualizationResult | null;
  maxK: number;
  setMaxK: (value: number) => void;
  dbscanEps: number;
  setDbscanEps: (value: number) => void;
  dbscanMinSamples: number;
  setDbscanMinSamples: (value: number) => void;
  isVisualizing: boolean;
  hasData: boolean;
  onVisualize: () => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function VisualizationPanel({
  visualizationResult,
  maxK,
  setMaxK,
  dbscanEps,
  setDbscanEps,
  dbscanMinSamples,
  setDbscanMinSamples,
  isVisualizing,
  hasData,
  onVisualize,
  onBack,
  onNext,
  nextDisabled,
}: VisualizationPanelProps) {
  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Find K</h3>
            <p className="text-sm text-gray-600">Compute Elbow &amp; K-Distance curves through GPU Service before K-means clustering.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Max K:</label>
              <input
                type="number"
                min={2}
                max={50}
                value={maxK}
                onChange={(e) => setMaxK(Math.max(2, Math.min(50, parseInt(e.target.value, 10) || 20)))}
                className="w-16 px-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">EPS:</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1.0"
                value={dbscanEps}
                onChange={(e) => setDbscanEps(parseFloat(e.target.value) || 0.1)}
                className="w-20 px-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Min Samples:</label>
              <input
                type="number"
                min="1"
                max="30"
                value={dbscanMinSamples}
                onChange={(e) => setDbscanMinSamples(parseInt(e.target.value, 10) || 3)}
                className="w-16 px-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <button
              onClick={onVisualize}
              disabled={isVisualizing || !hasData}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-xl text-sm font-bold shadow-lg transition-colors"
            >
              {isVisualizing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Computing...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Visualize (GPU)
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {visualizationResult && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm text-blue-800">
            <Sparkles className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <span>
              <strong>{visualizationResult.pointCount}</strong> points analyzed
              {typeof visualizationResult.noiseCount === 'number' && (
                <>, <strong>{visualizationResult.noiseCount}</strong> noise points filtered by DBSCAN</>
              )}
            </span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6 h-[600px]">
            <h4 className="text-base font-bold text-gray-800 mb-4 text-center">Phương pháp Khuỷu tay (Elbow Method) để tìm K tối ưu</h4>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={visualizationResult.elbow} margin={{ top: 20, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="5 5" stroke="#ccc" />
                <XAxis
                  dataKey="k"
                  label={{ value: 'Số lượng cụm (K)', position: 'insideBottom', offset: -15 }}
                  ticks={Array.from({ length: maxK }, (_, i) => i + 1)}
                />
                <YAxis
                  label={{ value: 'WCSS (Inertia)', angle: -90, position: 'insideLeft', offset: 0 }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #ccc' }}
                />
                <Line
                  type="linear"
                  dataKey="wcss"
                  stroke="blue"
                  strokeWidth={2}
                  dot={{ r: 5, fill: 'blue', stroke: 'blue' }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
