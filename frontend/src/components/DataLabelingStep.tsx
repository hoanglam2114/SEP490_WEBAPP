import { useEffect, useMemo, useState } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  Tag,
  Plus,
  Loader2,
  MessageSquare,
  AlertCircle,
  Tags,
} from 'lucide-react';

type VoteType = 'up' | 'down';

type LabelItem = {
  _id: string;
  name: string;
  type: 'hard' | 'soft';
  upvotes?: string[];
  downvotes?: string[];
  score: number;
  upvoteCount: number;
  downvoteCount: number;
  hasVoted: boolean;
  userVoteType: VoteType | null;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type LabelingSample = {
  key: string;
  title: string;
  sampleId: string | null;
  messages: ChatMessage[];
};

type DataLabelingStepProps = {
  samples: LabelingSample[];
  onBack?: () => void;
  onNext?: () => void;
  showBackButton?: boolean;
  showNextButton?: boolean;
  nextDisabled?: boolean;
  fromCommunityHub?: boolean;
  lockInteractions?: boolean;
  lockReason?: string;
};

const HARD_LABELS = ['REJECT', 'ERROR_FORMULAR', 'USER_SPAM', 'ERROR_RESPONSE', 'ERROR_FORMAT'] as const;

const HARD_LABEL_COLORS: Record<string, string> = {
  REJECT: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
  ERROR_FORMULAR: 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500',
  USER_SPAM: 'bg-yellow-500 hover:bg-yellow-600 text-white border-yellow-500',
  ERROR_RESPONSE: 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600',
  ERROR_FORMAT: 'bg-pink-600 hover:bg-pink-700 text-white border-pink-600',
};

function getAuthHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function getCurrentUserId(): string {
  try {
    const rawUser = localStorage.getItem('user');
    if (!rawUser) {
      return '';
    }
    const parsed = JSON.parse(rawUser);
    return String(parsed?.id || parsed?._id || parsed?.userId || '');
  } catch {
    return '';
  }
}

function normalizeLabel(label: any): LabelItem {
  const upvotes = Array.isArray(label?.upvotes) ? label.upvotes.map(String) : [];
  const downvotes = Array.isArray(label?.downvotes) ? label.downvotes.map(String) : [];
  const upvoteCount = Number(label?.upvoteCount ?? upvotes.length ?? 0);
  const downvoteCount = Number(label?.downvoteCount ?? downvotes.length ?? 0);
  const userVoteType = (label?.userVoteType || null) as VoteType | null;

  return {
    _id: String(label?._id || ''),
    name: String(label?.name || ''),
    type: label?.type === 'hard' ? 'hard' : 'soft',
    upvotes,
    downvotes,
    score: Number(label?.score ?? upvoteCount - downvoteCount),
    upvoteCount,
    downvoteCount,
    hasVoted: Boolean(label?.hasVoted ?? userVoteType),
    userVoteType,
  };
}

function applyOptimisticVote(label: LabelItem, voteAction: VoteType, currentUserId: string): LabelItem {
  if (!currentUserId) {
    return label;
  }

  const upvotes = [...(label.upvotes || [])];
  const downvotes = [...(label.downvotes || [])];
  const hasUp = upvotes.includes(currentUserId);
  const hasDown = downvotes.includes(currentUserId);

  let nextUpvotes = upvotes;
  let nextDownvotes = downvotes;

  if (voteAction === 'up') {
    if (hasUp) {
      nextUpvotes = upvotes.filter((id) => id !== currentUserId);
    } else {
      nextUpvotes = [...upvotes, currentUserId];
      nextDownvotes = downvotes.filter((id) => id !== currentUserId);
    }
  } else if (label.type === 'soft') {
    if (hasDown) {
      nextDownvotes = downvotes.filter((id) => id !== currentUserId);
    } else {
      nextDownvotes = [...downvotes, currentUserId];
      nextUpvotes = upvotes.filter((id) => id !== currentUserId);
    }
  }

  const upvoteCount = nextUpvotes.length;
  const downvoteCount = nextDownvotes.length;
  const userVoteType: VoteType | null = nextUpvotes.includes(currentUserId)
    ? 'up'
    : nextDownvotes.includes(currentUserId)
      ? 'down'
      : null;

  return {
    ...label,
    upvotes: nextUpvotes,
    downvotes: nextDownvotes,
    upvoteCount,
    downvoteCount,
    score: upvoteCount - downvoteCount,
    hasVoted: Boolean(userVoteType),
    userVoteType,
  };
}

export function DataLabelingStep({
  samples,
  onBack,
  onNext,
  showBackButton = true,
  showNextButton = true,
  nextDisabled = false,
  fromCommunityHub = false,
  lockInteractions = false,
  lockReason,
}: DataLabelingStepProps) {
  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [softLabelInput, setSoftLabelInput] = useState('');
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [error, setError] = useState('');

  const currentSample = samples[currentIndex] || null;

  const canGoPrevSample = currentIndex > 0;
  const canGoNextSample = currentIndex < samples.length - 1;

  const scoreColorClass = (score: number): string => {
    if (score > 0) return 'text-emerald-700 font-semibold';
    if (score < 0) return 'text-red-600 font-semibold';
    return 'text-gray-500';
  };

  const fetchLabels = async (sampleId: string) => {
    setIsLoadingLabels(true);
    setError('');

    try {
      const response = await fetch(`/api/labels/${encodeURIComponent(sampleId)}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Failed to fetch labels (${response.status})`);
      }

      const payload = await response.json();
      setLabels(Array.isArray(payload?.labels) ? payload.labels.map(normalizeLabel) : []);
    } catch (err: any) {
      setLabels([]);
      setError(err?.message || 'Failed to fetch labels');
    } finally {
      setIsLoadingLabels(false);
    }
  };

  useEffect(() => {
    if (!currentSample) {
      setLabels([]);
      return;
    }

    if (!currentSample.sampleId) {
      setLabels([]);
      setError('This sample has no persisted sampleId yet. Proceed through Step 4 (Clustering) to create a dataset version first.');
      return;
    }

    fetchLabels(currentSample.sampleId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSample?.sampleId]);

  useEffect(() => {
    if (currentIndex <= samples.length - 1) {
      return;
    }
    setCurrentIndex(Math.max(samples.length - 1, 0));
  }, [currentIndex, samples.length]);

  useEffect(() => {
    if (!samples.length) {
      if (currentIndex !== 0) {
        setCurrentIndex(0);
      }
      return;
    }

    const active = samples[currentIndex];
    if (active?.sampleId) {
      return;
    }

    const firstWithSampleId = samples.findIndex((item) => Boolean(item.sampleId));
    if (firstWithSampleId >= 0 && firstWithSampleId !== currentIndex) {
      setCurrentIndex(firstWithSampleId);
    }
  }, [currentIndex, samples]);

  const addLabel = async (name: string, type: 'hard' | 'soft') => {
    if (!currentSample?.sampleId) {
      setError('Cannot add label: missing sampleId');
      return;
    }

    setIsSavingLabel(true);
    setError('');

    try {
      const normalizedName = type === 'hard' ? name.toUpperCase() : name.toLowerCase();
      const addLabelUrl = fromCommunityHub
        ? `/api/labels/${encodeURIComponent(currentSample.sampleId)}/add?fromCommunityHub=true`
        : `/api/labels/${encodeURIComponent(currentSample.sampleId)}/add`;

      const response = await fetch(addLabelUrl, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({
          name: normalizedName,
          type,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Failed to add label (${response.status})`);
      }

      if (type === 'soft') {
        setSoftLabelInput('');
      }

      const payload = await response.json().catch(() => null);
      const created = payload?.label ? normalizeLabel(payload.label) : null;
      if (created) {
        setLabels((prev) => [created, ...prev]);
      } else {
        await fetchLabels(currentSample.sampleId);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to add label');
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleVote = async (labelId: string, voteAction: VoteType) => {
    setError('');

    const previousLabels = labels;
    if (currentUserId) {
      setLabels((prev) =>
        prev.map((item) =>
          item._id === labelId ? applyOptimisticVote(item, voteAction, currentUserId) : item
        )
      );
    }

    try {
      const voteUrl = fromCommunityHub
        ? `/api/labels/${encodeURIComponent(labelId)}/vote?fromCommunityHub=true`
        : `/api/labels/${encodeURIComponent(labelId)}/vote`;

      const response = await fetch(voteUrl, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ voteAction }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Failed to vote (${response.status})`);
      }

      const payload = await response.json();
      const nextLabel = payload?.label;

      if (!nextLabel) {
        setLabels(previousLabels);
        await fetchLabels(currentSample?.sampleId || '');
        return;
      }

      const normalized = normalizeLabel({
        ...nextLabel,
        upvoteCount: payload?.upvoteCount,
        downvoteCount: payload?.downvoteCount,
        score: payload?.score,
        hasVoted: payload?.hasVoted,
        userVoteType: payload?.userVoteType,
      });

      setLabels((prev) =>
        prev.map((item) =>
          item._id === String(nextLabel._id)
            ? normalized
            : item
        )
      );
    } catch (err: any) {
      setLabels(previousLabels);
      setError(err?.message || 'Failed to vote label');
    }
  };

  const handleHardLabelVote = async (hardLabelName: string) => {
    const existing = labels.find((item) => item.type === 'hard' && item.name === hardLabelName);
    if (existing) {
      await handleVote(existing._id, 'up');
      return;
    }

    if (!currentSample?.sampleId) {
      setError('Cannot vote hard label: missing sampleId');
      return;
    }

    setIsSavingLabel(true);
    setError('');
    try {
      const hardLabelUrl = fromCommunityHub
        ? `/api/labels/${encodeURIComponent(currentSample.sampleId)}/add?fromCommunityHub=true`
        : `/api/labels/${encodeURIComponent(currentSample.sampleId)}/add`;

      const response = await fetch(hardLabelUrl, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ name: hardLabelName, type: 'hard' }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Failed to create hard label (${response.status})`);
      }

      const payload = await response.json().catch(() => null);
      const created = payload?.label ? normalizeLabel(payload.label) : null;
      if (!created?._id) {
        await fetchLabels(currentSample.sampleId);
        return;
      }

      setLabels((prev) => [created, ...prev]);
      await handleVote(created._id, 'up');
    } catch (err: any) {
      setError(err?.message || 'Failed to vote hard label');
    } finally {
      setIsSavingLabel(false);
    }
  };

  const sampleCounterText = useMemo(() => {
    if (!samples.length) {
      return '0 / 0';
    }
    return `${currentIndex + 1} / ${samples.length}`;
  }, [currentIndex, samples.length]);

  return (
    <div className="space-y-4">
      {/* Split-pane layout */}
      <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: '60% 40%' }}>

        {/* ── Area 1: Chat History (Left - 60%) ── */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col" style={{ minHeight: '520px' }}>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-xl">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Chat History</h3>
            </div>
            <div className="flex items-center gap-2">
              {currentSample && (
                <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 max-w-[200px] truncate">
                  {currentSample.title}
                </span>
              )}
              <span className="text-xs font-medium text-blue-700 bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5">
                {sampleCounterText}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {!currentSample && (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-gray-400">No samples available.</p>
              </div>
            )}

            {currentSample?.messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tl-sm'
                      : 'bg-gray-100 text-gray-800 border border-gray-200 rounded-tr-sm'
                  }`}
                >
                  <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${message.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {message.role}
                  </p>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content || '–'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Right pane ── */}
        <div className="space-y-3 flex flex-col">

          {/* ── Area 2: Current Labels ── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-shrink-0">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 bg-gradient-to-r from-violet-50 to-purple-50 rounded-t-xl">
              <Tags className="w-4 h-4 text-violet-600" />
              <h3 className="text-sm font-semibold text-gray-900">Current Labels</h3>
              {labels.length > 0 && (
                <span className="ml-auto text-xs font-medium text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-2 py-0.5">
                  {labels.length}
                </span>
              )}
            </div>

            <div className="max-h-[200px] overflow-auto p-3 space-y-2">
              {isLoadingLabels && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading labels...
                </div>
              )}

              {!isLoadingLabels && labels.length === 0 && (
                <p className="text-sm text-gray-400 py-2 text-center">No labels for this sample yet.</p>
              )}

              {!isLoadingLabels && labels.map((label) => (
                <div
                  key={label._id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 bg-gray-50 hover:bg-white transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">{label.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-emerald-600 font-medium">▲ {label.upvoteCount ?? 0}</span>
                      {label.type === 'soft' && (
                        <span className="text-[10px] text-red-500 font-medium">▼ {label.downvoteCount ?? 0}</span>
                      )}
                      <span className={`text-[10px] font-semibold ${scoreColorClass(label.score)}`}>
                        score: {label.score > 0 ? `+${label.score}` : label.score}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      disabled={lockInteractions}
                      onClick={() => handleVote(label._id, 'up')}
                      title="Upvote"
                      className={`rounded-lg p-1.5 transition-all ${
                        (Array.isArray(label.upvotes) && currentUserId && label.upvotes.includes(currentUserId)) || label.userVoteType === 'up'
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 shadow-sm'
                          : 'bg-white text-gray-500 border border-gray-200 hover:bg-emerald-50 hover:text-emerald-600'
                      }`}
                    >
                      <div className="inline-flex items-center gap-1">
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-semibold">{label.upvoteCount ?? label.upvotes?.length ?? 0}</span>
                      </div>
                    </button>
                    {label.type === 'soft' && (
                      <button
                        type="button"
                        disabled={lockInteractions}
                        onClick={() => handleVote(label._id, 'down')}
                        title="Downvote"
                        className={`rounded-lg p-1.5 transition-all ${
                          (Array.isArray(label.downvotes) && currentUserId && label.downvotes.includes(currentUserId)) || label.userVoteType === 'down'
                            ? 'bg-red-100 text-red-700 border border-red-300 shadow-sm'
                            : 'bg-white text-gray-500 border border-gray-200 hover:bg-red-50 hover:text-red-600'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1">
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-semibold">{label.downvoteCount ?? label.downvotes?.length ?? 0}</span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Area 3: Add Label ── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-shrink-0">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-t-xl">
              <Tag className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-gray-900">Add Label</h3>
            </div>

            <div className="p-3 space-y-3">
              {/* Hard Labels */}
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Hard Labels</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {HARD_LABELS.map((hardLabel) => (
                    (() => {
                      const existing = labels.find((item) => item.type === 'hard' && item.name === hardLabel);
                      const upCount = existing?.upvoteCount ?? existing?.upvotes?.length ?? 0;
                      const hasUpvoted = Boolean(
                        existing && currentUserId && Array.isArray(existing.upvotes) && existing.upvotes.includes(currentUserId)
                      );

                      return (
                    <button
                      key={hardLabel}
                      type="button"
                      disabled={isSavingLabel || !currentSample?.sampleId || lockInteractions}
                      onClick={() => handleHardLabelVote(hardLabel)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center justify-between ${
                        HARD_LABEL_COLORS[hardLabel] || 'bg-gray-600 hover:bg-gray-700 text-white border-gray-600'
                      } ${hasUpvoted ? 'ring-2 ring-white/80' : ''}`}
                    >
                      <span>{hardLabel}</span>
                      <span className="ml-2 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-semibold">
                        {upCount}
                      </span>
                    </button>
                      );
                    })()
                  ))}
                </div>
              </div>

              {/* Soft Label */}
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Soft Label</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={softLabelInput}
                    onChange={(event) => setSoftLabelInput(event.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && softLabelInput.trim() && currentSample?.sampleId && !isSavingLabel) {
                        if (lockInteractions) {
                          return;
                        }
                        addLabel(softLabelInput.trim().toLowerCase(), 'soft');
                      }
                    }}
                    placeholder="e.g. grammar error"
                    className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 placeholder-gray-400"
                  />
                  <button
                    type="button"
                    disabled={isSavingLabel || !softLabelInput.trim() || !currentSample?.sampleId || lockInteractions}
                    onClick={() => addLabel(softLabelInput.trim().toLowerCase(), 'soft')}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors flex-shrink-0"
                  >
                    {isSavingLabel ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Area 4: Data Navigation ── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-shrink-0 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-700">Sample Navigation</h3>
              <span className="text-xs text-gray-500 font-medium bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                {sampleCounterText}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canGoPrevSample}
                onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                type="button"
                disabled={!canGoNextSample}
                onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, samples.length - 1))}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lockInteractions && lockReason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{lockReason}</span>
        </div>
      )}

      {/* ── Area 5: Main Action Bar ── */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div>
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
        </div>
        <div className="text-xs text-gray-400 font-medium">Step 5 — Data Labeling</div>
        <div>
          {showNextButton && (
            <button
              type="button"
              onClick={onNext}
              disabled={nextDisabled}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
