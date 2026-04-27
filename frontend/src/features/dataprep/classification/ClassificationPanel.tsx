import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Filter, CheckCircle2, Sparkles } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';
import { apiService, ClassificationSummaryGroup, ClassificationGroup, QualityBucket, QualitySummaryGroup } from '../../../services/api';
import { toast } from 'react-hot-toast';

type ClassificationPanelProps = {
  versionId: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  table: React.ReactNode;
  onGroupFilterChange: (group: ClassificationGroup | null) => void;
  activeGroup: ClassificationGroup | null;
  onQualityBucketFilterChange: (bucket: QualityBucket | null) => void;
  activeQualityBucket: QualityBucket | null;
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

const QUALITY_COLORS: Record<QualityBucket, { bg: string; text: string; border: string }> = {
  Gold: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  Rewrite: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  Reject: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
};
const QUALITY_BUCKETS: QualityBucket[] = ['Gold', 'Rewrite', 'Reject'];

export function ClassificationPanel({
  versionId,
  onBack,
  onNext,
  nextDisabled,
  table,
  onGroupFilterChange,
  activeGroup,
  onQualityBucketFilterChange,
  activeQualityBucket,
}: ClassificationPanelProps) {
  const [isClassifying, setIsClassifying] = useState(false);
  const [isQualityClassifying, setIsQualityClassifying] = useState(false);
  const [summary, setSummary] = useState<ClassificationSummaryGroup[]>([]);
  const [qualitySummary, setQualitySummary] = useState<QualitySummaryGroup[]>([]);
  const [totalSamples, setTotalSamples] = useState(0);
  const [qualityTotalSamples, setQualityTotalSamples] = useState(0);
  const [qualityClassifiedSamples, setQualityClassifiedSamples] = useState(0);
  const [qualitySkippedSamples, setQualitySkippedSamples] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isQualityLoaded, setIsQualityLoaded] = useState(false);

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

  const loadQualitySummary = async () => {
    try {
      const res = await apiService.getQualityClassifiedSamples(versionId);
      setQualitySummary(res.groups || []);
      setQualityTotalSamples(res.totalSamples || 0);
      setQualityClassifiedSamples(res.classifiedSamples || 0);
      setQualitySkippedSamples(res.skippedSamples || 0);
      setIsQualityLoaded(true);
    } catch (error: any) {
      console.error('Failed to load quality classification summary:', error);
    }
  };

  useEffect(() => {
    if (versionId) {
      loadSummary();
      loadQualitySummary();
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

  const handleRunQualityClassification = async () => {
    setIsQualityClassifying(true);
    try {
      const res = await apiService.classifyQuality(versionId);
      setQualitySummary(res.groups || []);
      setQualityTotalSamples(res.totalSamples || 0);
      setQualityClassifiedSamples(res.classifiedSamples || 0);
      setQualitySkippedSamples(res.skippedSamples || 0);
      setIsQualityLoaded(true);
      toast.success(`Quality classification completed. Tagged ${res.rejectTaggedCount || 0} rejected samples.`);
      onQualityBucketFilterChange(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error.message || 'Quality classification failed.');
    } finally {
      setIsQualityClassifying(false);
    }
  };

  const qualityGroupByBucket = new Map(qualitySummary.map((item) => [item.group, item]));

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

          <div className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Quality Classification</h3>
                <p className="text-[11px] text-gray-500">Gold / Rewrite / Reject from message labels.</p>
              </div>
              <button
                onClick={handleRunQualityClassification}
                disabled={isQualityClassifying || !versionId}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300 transition-colors"
              >
                {isQualityClassifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Run Quality Classification
              </button>
            </div>

            {!isQualityLoaded && !isQualityClassifying ? (
              <div className="py-6 text-center text-sm text-gray-500">
                Run quality classification after message-level labels are ready.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {QUALITY_BUCKETS.map((bucket) => {
                    const item = qualityGroupByBucket.get(bucket) || { group: bucket, count: 0, percentage: 0 };
                    const colors = QUALITY_COLORS[bucket];
                    const isActive = activeQualityBucket === bucket;
                    return (
                      <button
                        key={bucket}
                        type="button"
                        onClick={() => onQualityBucketFilterChange(bucket)}
                        className={`rounded-lg border p-3 text-left transition-all ${isActive ? `${colors.bg} ${colors.border} ring-1 ${colors.border.replace('border-', 'ring-')}` : `${colors.bg} ${colors.border} hover:shadow-sm`}`}
                      >
                        <p className={`text-[10px] font-bold uppercase ${colors.text}`}>{bucket}</p>
                        <p className="mt-1 text-2xl font-black text-gray-900">{item.count}</p>
                        <p className="text-[11px] font-medium text-gray-500">{item.percentage}% classified</p>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2 border border-gray-100">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">Total</p>
                    <p className="text-sm font-bold text-gray-900">{qualityTotalSamples}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2 border border-gray-100">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">Classified</p>
                    <p className="text-sm font-bold text-gray-900">{qualityClassifiedSamples}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2 border border-gray-100">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">Skipped</p>
                    <p className="text-sm font-bold text-gray-900">{qualitySkippedSamples}</p>
                  </div>
                </div>

                <div
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${!activeQualityBucket ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200' : 'bg-white border-transparent hover:bg-gray-50'}`}
                  onClick={() => onQualityBucketFilterChange(null)}
                >
                  <span className="text-xs font-semibold text-gray-700">All Quality Samples</span>
                  {!activeQualityBucket && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                </div>

                {qualitySummary.map((item) => {
                  const colors = QUALITY_COLORS[item.group];
                  const isActive = activeQualityBucket === item.group;
                  return (
                    <div
                      key={item.group}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${isActive ? `${colors.bg} ${colors.border} ring-1 ${colors.border.replace('border-', 'ring-')}` : 'bg-white border-transparent hover:bg-gray-50'}`}
                      onClick={() => onQualityBucketFilterChange(item.group)}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${colors.text.replace('text-', 'bg-')}`} />
                        <span className={`text-xs font-bold ${colors.text}`}>{item.group}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-gray-400 font-medium">{item.percentage}%</span>
                        <span className="text-xs font-bold text-gray-900 min-w-[24px] text-right">{item.count}</span>
                        {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
