import { Loader2, Sparkles, Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StepNavigation } from '../../../components/StepNavigation';

export type VisualizationResult = {
  elbow: Array<{ k: number; wcss: number }>;
  silhouette: Array<{ k: number; silhouette: number }>;
  kDistance: Array<{ rank: number; distance: number }>;
  pointCount: number;
  noiseCount?: number;
  recommendedK?: number | null;
  recommendationReason?: string;
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
  const chartData = visualizationResult
    ? visualizationResult.elbow.map((item) => ({
      ...item,
      silhouette: visualizationResult.silhouette.find((entry) => entry.k === item.k)?.silhouette ?? null,
      isRecommended: visualizationResult.recommendedK === item.k,
    }))
    : [];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Find K</h3>
            <p className="text-sm text-gray-600">Compute Elbow, Silhouette Score, and K-Distance curves through GPU Service before K-means clustering.</p>
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
            <div className="space-y-1">
              <div>
                <strong>{visualizationResult.pointCount}</strong> points analyzed
                {typeof visualizationResult.noiseCount === 'number' && (
                  <>, <strong>{visualizationResult.noiseCount}</strong> noise points filtered by DBSCAN</>
                )}
              </div>
              {typeof visualizationResult.recommendedK === 'number' && (
                <div className="text-blue-900">
                  Recommended K: <strong>{visualizationResult.recommendedK}</strong>
                  {visualizationResult.recommendationReason ? ` (${visualizationResult.recommendationReason})` : ''}
                </div>
              )}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-gray-800">Elbow Method vs. Silhouette Score</h4>
                <p className="text-sm text-gray-500">Use the blue curve to spot the elbow and the green curve to confirm the strongest silhouette.</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-gray-600">
                <div className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                  <span>Elbow (WCSS)</span>
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-600" />
                  <span>Silhouette</span>
                </div>
                {typeof visualizationResult.recommendedK === 'number' && (
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span>Recommended K = {visualizationResult.recommendedK}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="h-[520px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 16, right: 36, left: 16, bottom: 16 }}
              >
                <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" vertical={false} />
                <XAxis
                  dataKey="k"
                  ticks={visualizationResult.elbow.map((item) => item.k)}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tick={{ fontSize: 12, fill: '#475569' }}
                />
                <YAxis
                  yAxisId="wcss"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: '#2563eb' }}
                  label={{ value: 'WCSS', angle: -90, position: 'insideLeft', offset: -4, style: { fill: '#2563eb', fontSize: 12 } }}
                />
                <YAxis
                  yAxisId="silhouette"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: '#16a34a' }}
                  label={{ value: 'Silhouette', angle: 90, position: 'insideRight', offset: 4, style: { fill: '#16a34a', fontSize: 12 } }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #cbd5e1', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' }}
                  formatter={(value, name) => {
                    const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                    return [
                      name === 'Elbow (WCSS)' ? numericValue.toFixed(2) : numericValue.toFixed(4),
                      String(name),
                    ];
                  }}
                  labelFormatter={(label) => `K = ${label}`}
                />
                {typeof visualizationResult.recommendedK === 'number' && (
                  <ReferenceLine
                    x={visualizationResult.recommendedK}
                    stroke="#f59e0b"
                    strokeDasharray="6 6"
                    label={{ value: `Recommended K = ${visualizationResult.recommendedK}`, position: 'insideTopRight', fill: '#b45309', fontSize: 12 }}
                  />
                )}
                <Line
                  yAxisId="wcss"
                  type="monotone"
                  dataKey="wcss"
                  name="Elbow (WCSS)"
                  stroke="#2563eb"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#ffffff', stroke: '#2563eb', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                />
                <Line
                  yAxisId="silhouette"
                  type="monotone"
                  dataKey="silhouette"
                  name="Silhouette"
                  stroke="#16a34a"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#ffffff', stroke: '#16a34a', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#16a34a', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
