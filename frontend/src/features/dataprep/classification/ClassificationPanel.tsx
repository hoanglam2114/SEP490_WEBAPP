import React, { useMemo, useState, useEffect } from 'react';
import { Loader2, RefreshCw, Filter, CheckCircle2 } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import { apiService, ClassificationSummaryGroup, ClassifiedSamplesResult, ClassificationGroup } from '../../../services/api';
import { toast } from 'react-hot-toast';

type ClassificationPanelProps = {
  versionId: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  table: React.ReactNode;
  onGroupFilterChange: (group: ClassificationGroup | null) => void;
  activeGroup: ClassificationGroup | null;
};

const GROUP_COLORS: Record<ClassificationGroup, { bg: string; text: string; border: string }> = {
  MATH: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  PHYSICAL: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  CHEMISTRY: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  LITERATURE: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  BIOLOGY: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  REJECT: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  REWRITE: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  OUT_OF_SCOPE: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
};

export function ClassificationPanel({
  versionId,
  onBack,
  onNext,
  nextDisabled,
  table,
  onGroupFilterChange,
  activeGroup,
}: ClassificationPanelProps) {
  const [isClassifying, setIsClassifying] = useState(false);
  const [summary, setSummary] = useState<ClassificationSummaryGroup[]>([]);
  const [totalSamples, setTotalSamples] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadSummary = async () => {
    try {
      const res = await apiService.getClassifiedSamples(versionId);
      setSummary(res.groups);
      setTotalSamples(res.totalSamples);
      setIsLoaded(true);
    } catch (error: any) {
      console.error('Failed to load classification summary:', error);
    }
  };

  useEffect(() => {
    if (versionId) {
      loadSummary();
    }
  }, [versionId]);

  const handleRunClassification = async () => {
    setIsClassifying(true);
    try {
      const res = await apiService.classifyVersion(versionId);
      setSummary(res.groups);
      setTotalSamples(res.totalSamples);
      toast.success('Classification completed successfully.');
      onGroupFilterChange(null); // Reset filter to show all
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error.message || 'Classification failed.');
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {table}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">Classification Summary</h3>
              <button
                onClick={handleRunClassification}
                disabled={isClassifying || !versionId}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"
              >
                {isClassifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Run Classification
              </button>
            </div>

            {!isLoaded && !isClassifying ? (
              <div className="py-8 text-center text-sm text-gray-500">
                Classification has not been run for this version.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-medium text-gray-500 pb-2 border-b border-gray-100">
                  <span>Total Samples</span>
                  <span className="text-gray-900 font-bold">{totalSamples}</span>
                </div>

                <div className="space-y-2">
                  <div 
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${!activeGroup ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' : 'bg-white border-transparent hover:bg-gray-50'}`}
                    onClick={() => onGroupFilterChange(null)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      <span className="text-xs font-semibold text-gray-700">All Samples</span>
                    </div>
                    {!activeGroup && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />}
                  </div>

                  {summary.map((item) => {
                    const colors = GROUP_COLORS[item.group] || GROUP_COLORS.OUT_OF_SCOPE;
                    const isActive = activeGroup === item.group;

                    return (
                      <div
                        key={item.group}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${isActive ? `${colors.bg} ${colors.border} ring-1 ${colors.border.replace('border-', 'ring-')}` : 'bg-white border-transparent hover:bg-gray-50'}`}
                        onClick={() => onGroupFilterChange(item.group)}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${colors.text.replace('text-', 'bg-')}`} />
                          <span className={`text-xs font-bold ${colors.text}`}>{item.group}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-gray-400 font-medium">{item.percentage}%</span>
                          <span className="text-xs font-bold text-gray-900 min-w-[24px] text-right">{item.count}</span>
                          {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex gap-3">
              <Filter className="h-4 w-4 text-blue-600 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-blue-900">Priority Rules</p>
                <ul className="mt-1 space-y-1 text-[10px] text-blue-700 list-disc list-inside leading-relaxed">
                  <li><strong>REJECT</strong> takes highest priority (3+ upvotes).</li>
                  <li><strong>REWRITE</strong> applies for error/spam labels.</li>
                  <li><strong>Subjects</strong> applied after quality checks.</li>
                  <li><strong>OUT_OF_SCOPE</strong> for any other cases.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
