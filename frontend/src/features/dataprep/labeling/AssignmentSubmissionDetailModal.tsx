import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2, MessageSquare, Tags, User, X } from 'lucide-react';
import { dataprepApi } from '../api/dataprepApi';
import type { DatasetAssignmentDetailResponse, ShareUser } from '../../../services/api';

type AssignmentSubmissionDetailModalProps = {
  isOpen: boolean;
  versionId: string;
  assignee: ShareUser | null;
  onClose: () => void;
};

function getErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.message || fallback;
}

export function AssignmentSubmissionDetailModal({
  isOpen,
  versionId,
  assignee,
  onClose,
}: AssignmentSubmissionDetailModalProps) {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);

  const detailQuery = useQuery<DatasetAssignmentDetailResponse>({
    queryKey: ['dataset-version-assignment-detail', versionId, assignee?.id],
    queryFn: () => dataprepApi.getDatasetVersionUserAssignmentDetail(versionId, assignee?.id || ''),
    enabled: isOpen && Boolean(versionId && assignee?.id),
  });

  const samples = detailQuery.data?.samples || [];
  const currentSample = samples[selectedSampleIndex] || null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedSampleIndex(0);
    setSelectedMessageIndex(null);
  }, [isOpen, assignee?.id]);

  useEffect(() => {
    if (selectedSampleIndex <= samples.length - 1) {
      return;
    }
    setSelectedSampleIndex(0);
  }, [samples.length, selectedSampleIndex]);

  const labelsQuery = useQuery({
    queryKey: ['dataset-version-assignment-detail-labels', currentSample?.sampleId, assignee?.id],
    queryFn: () => dataprepApi.getSampleLabels(currentSample?.sampleId || '', {
      scope: 'all',
      contributedBy: assignee?.id,
      visibilityMode: 'review',
    }),
    enabled: isOpen && Boolean(currentSample?.sampleId && assignee?.id),
  });

  const allLabels = useMemo(
    () => (Array.isArray(labelsQuery.data?.labels) ? labelsQuery.data?.labels : []),
    [labelsQuery.data?.labels]
  );

  const visibleLabels = useMemo(() => {
    if (selectedMessageIndex === null) {
      return allLabels.filter((label) => label.targetScope !== 'message');
    }
    return allLabels.filter(
      (label) => label.targetScope === 'message' && Number(label.messageIndex) === selectedMessageIndex
    );
  }, [allLabels, selectedMessageIndex]);

  const messageLabelCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    allLabels.forEach((label) => {
      if (label.targetScope === 'message' && Number.isInteger(label.messageIndex)) {
        const key = Number(label.messageIndex);
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    return counts;
  }, [allLabels]);

  if (!isOpen || !assignee) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-600" />
              <h3 className="truncate text-base font-semibold text-slate-900">Assignment Label Review</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {assignee.name} ({assignee.email})
              </span>
              {detailQuery.data?.submission && (
                <span>
                  {detailQuery.data.submission.status} · {detailQuery.data.submission.progress.completedMessages}/{detailQuery.data.submission.progress.requiredMessages}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_320px] overflow-hidden">
          <aside className="min-h-0 border-r border-slate-200 bg-slate-50/70">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Assigned Samples</p>
              <p className="mt-1 text-xs text-slate-500">{samples.length} sample(s)</p>
            </div>
            <div className="h-[calc(88vh-140px)] overflow-y-scroll p-3">
              {detailQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : samples.length === 0 ? (
                <p className="text-sm text-slate-500">No assigned samples found.</p>
              ) : (
                <div className="space-y-2">
                  {samples.map((sample, index) => (
                    <button
                      key={sample.sampleId}
                      type="button"
                      onClick={() => {
                        setSelectedSampleIndex(index);
                        setSelectedMessageIndex(null);
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        index === selectedSampleIndex
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-700">#{sample.sampleIndex}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-900">{sample.sampleKey}</p>
                      <p className="mt-1 line-clamp-3 text-[11px] text-slate-500">{sample.preview || '-'}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="min-h-0 flex flex-col overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-600" />
                <h4 className="text-sm font-semibold text-slate-900">Conversation</h4>
              </div>
              {currentSample && (
                <p className="mt-1 text-xs text-slate-500">
                  Sample #{currentSample.sampleIndex} · {currentSample.sampleKey}
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-scroll p-4">
              {detailQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading sample detail...
                </div>
              ) : !currentSample ? (
                <p className="text-sm text-slate-500">Select a sample to review.</p>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setSelectedMessageIndex(null)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      selectedMessageIndex === null
                        ? 'border-violet-300 bg-violet-50 text-violet-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Conversation labels
                  </button>
                  {currentSample.messages.map((message) => {
                    const isSelected = selectedMessageIndex === message.messageIndex;
                    const count = messageLabelCounts[message.messageIndex] || 0;
                    return (
                      <button
                        key={`${currentSample.sampleId}-${message.messageIndex}`}
                        type="button"
                        onClick={() => setSelectedMessageIndex(message.messageIndex)}
                        className={`block w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition-all ${
                          isSelected
                            ? 'border-amber-300 bg-amber-50'
                            : message.role === 'user'
                              ? 'border-blue-100 bg-blue-50/70 hover:bg-blue-50'
                              : 'border-slate-200 bg-slate-50 hover:bg-white'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${message.role === 'user' ? 'text-blue-700' : 'text-slate-500'}`}>
                            {message.role} · #{message.messageIndex + 1}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {count} label(s)
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{message.content || '-'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 border-l border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Tags className="h-4 w-4 text-violet-600" />
                <h4 className="text-sm font-semibold text-slate-900">Labels By Assignee</h4>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {selectedMessageIndex === null ? 'Conversation scope' : `Message #${selectedMessageIndex + 1}`}
              </p>
            </div>
            <div className="h-[calc(88vh-140px)] overflow-y-scroll p-3">
              {labelsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading labels...
                </div>
              ) : labelsQuery.isError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                  {getErrorMessage(labelsQuery.error, 'Failed to load labels.')}
                </div>
              ) : visibleLabels.length === 0 ? (
                <p className="text-sm text-slate-500">No labels in this scope.</p>
              ) : (
                <div className="space-y-2">
                  {visibleLabels.map((label: any) => (
                    <div key={label._id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">{label.name}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {label.type} · {label.assignedUserCount || 0} user(s)
                          </p>
                        </div>
                        <div className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          Contributed
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
