import type { ReactNode } from 'react';
import { Columns, Loader2, Zap } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';

type ClusterGroup = {
  groupId: number;
  count: number;
  label: string;
};

type ClusterPanelProps = {
  table: ReactNode;
  clusterGroups: ClusterGroup[];
  clusterK: number;
  setClusterK: (value: number) => void;
  dbscanEps: number;
  setDbscanEps: (value: number) => void;
  dbscanMinSamples: number;
  setDbscanMinSamples: (value: number) => void;
  filterThreshold: number;
  setFilterThreshold: (value: number) => void;
  selectedClusterIds: number[];
  toggleClusterSelection: (groupId: number) => void;
  onCluster: () => void;
  onRemoveNoise: () => void;
  onDeduplicate: () => void;
  onResetFiltering: () => void;
  onOpenCompareOverlay: () => void;
  onBack: () => void;
  onNext: () => void;
  hasConversionResult: boolean;
  isClustering: boolean;
  isRemovingNoise: boolean;
  isDeduplicating: boolean;
  nextDisabled: boolean;
};

export function ClusterPanel({
  table,
  clusterGroups,
  clusterK,
  setClusterK,
  dbscanEps,
  setDbscanEps,
  dbscanMinSamples,
  setDbscanMinSamples,
  filterThreshold,
  setFilterThreshold,
  selectedClusterIds,
  toggleClusterSelection,
  onCluster,
  onRemoveNoise,
  onDeduplicate,
  onResetFiltering,
  onOpenCompareOverlay,
  onBack,
  onNext,
  hasConversionResult,
  isClustering,
  isRemovingNoise,
  isDeduplicating,
  nextDisabled,
}: ClusterPanelProps) {
  const hasClusters = clusterGroups.length > 0;
  const isFiltering = isRemovingNoise || isDeduplicating;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {table}
        </div>
        <div className="space-y-4 lg:col-span-1">
          <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2">Clustering Parameters</h4>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target K (Clusters)</label>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={clusterK}
                  onChange={(e) => setClusterK(Math.max(2, Math.min(50, parseInt(e.target.value, 10) || 8)))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">DBSCAN EPS</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.0"
                    value={dbscanEps}
                    onChange={(e) => setDbscanEps(parseFloat(e.target.value) || 0.15)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Min Samples</label>
                  <input
                    type="number"
                    min="1"
                    max={20}
                    value={dbscanMinSamples}
                    onChange={(e) => setDbscanMinSamples(parseInt(e.target.value, 10) || 6)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={onCluster}
              disabled={!hasConversionResult || isClustering}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold transition-colors"
            >
              {isClustering ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Clustering...</span></> : <><Zap className="w-4 h-4" /><span>Cluster</span></>}
            </button>
          </div>

          {hasClusters && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-700">Similarity Threshold (for Deduplicate)</label>
                <span className="text-sm font-mono bg-white px-2 py-0.5 rounded border border-gray-200">{filterThreshold.toFixed(2)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.01" value={filterThreshold} onChange={(e) => setFilterThreshold(parseFloat(e.target.value))} className="w-full" />
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={onRemoveNoise}
                    disabled={isFiltering}
                    className="flex-1 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold text-sm"
                  >
                    {isRemovingNoise ? 'Removing...' : 'Remove Noise'}
                  </button>
                  <button
                    onClick={onDeduplicate}
                    disabled={isFiltering}
                    className="flex-1 px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold text-sm"
                  >
                    {isDeduplicating ? 'Deduplicating...' : 'Deduplicate'}
                  </button>
                </div>
                <button
                  onClick={onResetFiltering}
                  disabled={isFiltering}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-semibold text-sm"
                >
                  Reset Filter
                </button>
              </div>
            </div>
          )}

          {hasClusters && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Cluster Statistics</h3>
                <button
                  type="button"
                  onClick={onOpenCompareOverlay}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Columns className="h-3.5 w-3.5" />
                  Compare Groups
                </button>
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Select</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Group</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clusterGroups.map((group) => (
                      <tr key={group.groupId} className="border-t border-gray-100">
                        <td className="px-4 py-2"><input type="checkbox" checked={selectedClusterIds.includes(group.groupId)} onChange={() => toggleClusterSelection(group.groupId)} /></td>
                        <td className="px-4 py-2 font-medium text-gray-800">Group {group.groupId}</td>
                        <td className="px-4 py-2 text-gray-700">{group.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
