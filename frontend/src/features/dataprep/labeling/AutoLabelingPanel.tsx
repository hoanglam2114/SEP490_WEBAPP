import type { ReactNode } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import type { AutoLabelSuggestion, SubjectAutoLabel } from '../../../services/api';

const SUBJECT_LABELS: SubjectAutoLabel[] = ['MATH', 'PHYSICAL', 'CHEMISTRY', 'LITERATURE', 'BIOLOGY', 'OTHER'];

type ClusterGroup = {
  groupId: number;
  count: number;
  label: string;
};

type AutoLabelingPanelProps = {
  table: ReactNode;
  clusterGroups: ClusterGroup[];
  suggestions: AutoLabelSuggestion[];
  selectedGroupId: number | null;
  onSelectGroup: (groupId: number | null) => void;
  onChangeLabel: (clusterId: number, label: SubjectAutoLabel) => void;
  onLabelWithAI: () => void;
  onSave: () => void;
  onBack: () => void;
  onNext: () => void;
  isGenerating: boolean;
  isSaving: boolean;
  hasDatasetVersion: boolean;
  nextDisabled: boolean;
};

export function AutoLabelingPanel({
  table,
  clusterGroups,
  suggestions,
  selectedGroupId,
  onSelectGroup,
  onChangeLabel,
  onLabelWithAI,
  onSave,
  onBack,
  onNext,
  isGenerating,
  isSaving,
  hasDatasetVersion,
  nextDisabled,
}: AutoLabelingPanelProps) {
  const suggestionByCluster = new Map(suggestions.map((item) => [item.clusterId, item]));
  const hasClusters = clusterGroups.length > 0;
  const hasSuggestions = suggestions.length > 0;
  const allClustersLabeled = hasClusters && clusterGroups.every((group) => Boolean(suggestionByCluster.get(group.groupId)?.label));
  const canSave = hasDatasetVersion && hasSuggestions && allClustersLabeled && !isGenerating && !isSaving;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {table}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Cluster Statistics</h3>
            <button
              type="button"
              onClick={onLabelWithAI}
              disabled={!hasDatasetVersion || !hasClusters || isGenerating || isSaving}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Label with AI
            </button>
          </div>

          {!hasDatasetVersion && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
              Create a clustered dataset version before running Auto Labeling.
            </div>
          )}

          <div className="max-h-[620px] overflow-auto flex-1">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white z-10 shadow-sm">
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Filter</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Group</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Count</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Label</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100 bg-blue-50/30">
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="groupFilter"
                      checked={selectedGroupId === null}
                      onChange={() => onSelectGroup(null)}
                      className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                  <td colSpan={4} className="px-3 py-2 font-medium text-blue-700">Show All Groups</td>
                </tr>
                {clusterGroups.map((group) => {
                  const suggestion = suggestionByCluster.get(group.groupId);
                  return (
                    <tr key={group.groupId} className={`border-b border-gray-100 transition-colors ${selectedGroupId === group.groupId ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="groupFilter"
                          checked={selectedGroupId === group.groupId}
                          onChange={() => onSelectGroup(group.groupId)}
                          className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold text-gray-800">Group {group.groupId}</td>
                      <td className="px-3 py-2 text-gray-700">{group.count}</td>
                      <td className="px-3 py-2">
                        <select
                          value={suggestion?.label || ''}
                          onChange={(event) => onChangeLabel(group.groupId, event.target.value as SubjectAutoLabel)}
                          disabled={!hasSuggestions || isSaving}
                          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-800 disabled:bg-gray-100"
                        >
                          <option value="">Select</option>
                          {SUBJECT_LABELS.map((label) => (
                            <option key={label} value={label}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${suggestion?.label ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {suggestion?.label ? 'Pending' : 'No label'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!clusterGroups.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                      No clusters available. Run K-means clustering first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 bg-gray-50/50">
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
