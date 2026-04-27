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
  Check,
  X,
  Lightbulb,
  BookOpen,
  MessageCircle,
  Minimize2,
  SkipForward,
  Heart,
  Ban,
  ArrowRight,
  Clock,
  Sparkles,
  HelpCircle,
  ListTree,
  Navigation,
  RefreshCw,
  PauseCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { dataprepApi } from '../api/dataprepApi';

type VoteType = 'up' | 'down';
type AiProvider = 'gemini' | 'openai' | 'deepseek';

type LabelItem = {
  _id: string;
  name: string;
  type: 'hard' | 'soft';
  targetScope: 'sample' | 'message';
  messageIndex?: number;
  messageRole?: 'user' | 'assistant';
  targetTextSnapshot?: string;
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

type MessageAutoLabelSuggestion = {
  messageIndex: number;
  role: 'user' | 'assistant';
  label: string[] | string;
  confidence?: number;
  is_correct_logic?: boolean;
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

const CONVERSATION_HARD_LABELS = ['REJECT', 'ERROR_FORMULAR', 'USER_SPAM', 'ERROR_RESPONSE', 'ERROR_FORMAT'] as const;
const USER_MESSAGE_HARD_LABELS = [
  'CORRECT',
  'INCORRECT',
  'REQUEST_HINT',
  'ASK_THEORY',
  'REQUEST_EXPLANATION',
  'REQUEST_SIMPLER',
  'SKIP_EXERCISE',
  'ENCOURAGE',
  'OFF_TOPIC',
  'NEXT_SECTION',
  'WAIT_READY',
] as const;
const ASSISTANT_MESSAGE_HARD_LABELS = [
  'PRAISING',
  'SCAFFOLDING',
  'HINTING',
  'CONCEPT_CLARIFY',
  'LOGIC_BREAKDOWN',
  'SIMPLIFYING',
  'NAVIGATING',
  'MOTIVATING',
  'REDIRECTING',
  'TRANSITIONING',
  'WAITING',
] as const;

type HardLabelChip = {
  short: string;
  icon: LucideIcon;
  className: string;
};

const DEFAULT_HARD_LABEL_CHIP: HardLabelChip = {
  short: 'LBL',
  icon: Tag,
  className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100',
};

const HARD_LABEL_CHIPS: Record<string, HardLabelChip> = {
  REJECT: { short: 'REJ', icon: X, className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
  ERROR_FORMULAR: { short: 'FORM', icon: AlertTriangle, className: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100' },
  USER_SPAM: { short: 'SPAM', icon: Ban, className: 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100' },
  ERROR_RESPONSE: { short: 'RESP', icon: MessageCircle, className: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100' },
  ERROR_FORMAT: { short: 'FMT', icon: ListTree, className: 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100' },
  CORRECT: { short: 'OK', icon: Check, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  INCORRECT: { short: 'NO', icon: X, className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
  REQUEST_HINT: { short: 'HINT', icon: Lightbulb, className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100' },
  ASK_THEORY: { short: 'THEO', icon: BookOpen, className: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
  REQUEST_EXPLANATION: { short: 'WHY', icon: HelpCircle, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
  REQUEST_SIMPLER: { short: 'EASY', icon: Minimize2, className: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' },
  SKIP_EXERCISE: { short: 'SKIP', icon: SkipForward, className: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100' },
  ENCOURAGE: { short: 'ENC', icon: Heart, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  OFF_TOPIC: { short: 'OFF', icon: Ban, className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' },
  NEXT_SECTION: { short: 'NEXT', icon: ArrowRight, className: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100' },
  WAIT_READY: { short: 'WAIT', icon: Clock, className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100' },
  PRAISING: { short: 'PR', icon: Sparkles, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  SCAFFOLDING: { short: 'SCAF', icon: ListTree, className: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
  HINTING: { short: 'HINT', icon: Lightbulb, className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100' },
  CONCEPT_CLARIFY: { short: 'CLR', icon: BookOpen, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
  LOGIC_BREAKDOWN: { short: 'LOG', icon: ListTree, className: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100' },
  SIMPLIFYING: { short: 'SIMP', icon: Minimize2, className: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' },
  NAVIGATING: { short: 'NAV', icon: Navigation, className: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100' },
  MOTIVATING: { short: 'MOT', icon: Heart, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  REDIRECTING: { short: 'REDIR', icon: RefreshCw, className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' },
  TRANSITIONING: { short: 'TRAN', icon: ArrowRight, className: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100' },
  WAITING: { short: 'WAIT', icon: PauseCircle, className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100' },
};

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
    targetScope: label?.targetScope === 'message' ? 'message' : 'sample',
    messageIndex: Number.isInteger(label?.messageIndex) ? Number(label.messageIndex) : undefined,
    messageRole: label?.messageRole === 'user' || label?.messageRole === 'assistant' ? label.messageRole : undefined,
    targetTextSnapshot: typeof label?.targetTextSnapshot === 'string' ? label.targetTextSnapshot : undefined,
    upvotes,
    downvotes,
    score: Number(label?.score ?? upvoteCount - downvoteCount),
    upvoteCount,
    downvoteCount,
    hasVoted: Boolean(label?.hasVoted ?? userVoteType),
    userVoteType,
  };
}

function suggestionLabels(suggestion?: MessageAutoLabelSuggestion): string[] {
  if (!suggestion) {
    return [];
  }
  const labels = Array.isArray(suggestion.label) ? suggestion.label : [suggestion.label];
  return labels
    .map((label) => String(label || '').trim().toUpperCase())
    .filter(Boolean);
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
  } else {
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

export function DataLabelingPanel({
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
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [messageLabelCounts, setMessageLabelCounts] = useState<Record<number, number>>({});
  const [softLabelInput, setSoftLabelInput] = useState('');
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isAutoLabelingMessages, setIsAutoLabelingMessages] = useState(false);
  const [isSavingAutoLabels, setIsSavingAutoLabels] = useState(false);
  const [autoLabelProvider, setAutoLabelProvider] = useState<AiProvider>('gemini');
  const [autoLabelSuggestions, setAutoLabelSuggestions] = useState<Record<number, MessageAutoLabelSuggestion>>({});
  const [error, setError] = useState('');

  const currentSample = samples[currentIndex] || null;
  const selectedMessage = selectedMessageIndex !== null ? currentSample?.messages[selectedMessageIndex] : null;
  const selectedTargetIndex = selectedMessage ? selectedMessageIndex : null;
  const targetLabel = selectedMessage
    ? `Message #${selectedMessageIndex! + 1} - ${selectedMessage.role.toUpperCase()}`
    : 'Conversation';
  const availableHardLabels = selectedMessage?.role === 'user'
    ? USER_MESSAGE_HARD_LABELS
    : selectedMessage?.role === 'assistant'
      ? ASSISTANT_MESSAGE_HARD_LABELS
      : CONVERSATION_HARD_LABELS;

  const canGoPrevSample = currentIndex > 0;
  const canGoNextSample = currentIndex < samples.length - 1;
  const currentMessagesPayload = useMemo(
    () => (currentSample?.messages || []).map((message, index) => ({
      messageIndex: index,
      role: message.role,
      content: message.content,
    })),
    [currentSample?.messages]
  );
  const autoLabelSuggestionCount = Object.keys(autoLabelSuggestions).length;
  const autoLabelSuggestedLabelCount = Object.values(autoLabelSuggestions)
    .reduce((sum, suggestion) => sum + suggestionLabels(suggestion).length, 0);

  const scoreColorClass = (score: number): string => {
    if (score > 0) return 'text-emerald-700 font-semibold';
    if (score < 0) return 'text-red-600 font-semibold';
    return 'text-gray-500';
  };

  const fetchMessageLabelCounts = async (sampleId: string) => {
    try {
      const payload = await dataprepApi.getSampleLabels(sampleId, { scope: 'all' });
      const counts: Record<number, number> = {};
      (Array.isArray(payload?.labels) ? payload.labels.map(normalizeLabel) : [])
        .filter((label) => label.targetScope === 'message' && Number.isInteger(label.messageIndex))
        .forEach((label) => {
          const index = Number(label.messageIndex);
          counts[index] = (counts[index] || 0) + 1;
        });
      setMessageLabelCounts(counts);
    } catch {
      setMessageLabelCounts({});
    }
  };

  const fetchLabels = async (sampleId: string, messageIndex: number | null = selectedTargetIndex) => {
    setIsLoadingLabels(true);
    setError('');

    try {
      const payload = messageIndex === null
        ? await dataprepApi.getSampleLabels(sampleId)
        : await dataprepApi.getSampleLabels(sampleId, { scope: 'message', messageIndex });
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
      setMessageLabelCounts({});
      setError('This sample has no persisted sampleId yet. Proceed through Step 4 (Clustering) to create a dataset version first.');
      return;
    }

    fetchLabels(currentSample.sampleId, selectedTargetIndex);
    fetchMessageLabelCounts(currentSample.sampleId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSample?.sampleId, selectedTargetIndex]);

  useEffect(() => {
    setSelectedMessageIndex(null);
    setSoftLabelInput('');
    setAutoLabelSuggestions({});
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
      const payload = await dataprepApi.addSampleLabel(
        currentSample.sampleId,
        {
          name: normalizedName,
          type,
          targetScope: selectedMessage ? 'message' : 'sample',
          messageIndex: selectedTargetIndex ?? undefined,
          messageRole: selectedMessage?.role,
          targetTextSnapshot: selectedMessage?.content,
        },
        fromCommunityHub
      );

      if (type === 'soft') {
        setSoftLabelInput('');
      }

      const created = payload?.label ? normalizeLabel(payload.label) : null;
      if (created) {
        setLabels((prev) => [created, ...prev]);
        if (created.targetScope === 'message' && Number.isInteger(created.messageIndex)) {
          setMessageLabelCounts((prev) => ({
            ...prev,
            [Number(created.messageIndex)]: (prev[Number(created.messageIndex)] || 0) + 1,
          }));
        }
      } else {
        await fetchLabels(currentSample.sampleId);
        await fetchMessageLabelCounts(currentSample.sampleId);
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
      const payload = await dataprepApi.voteSampleLabel(labelId, voteAction, fromCommunityHub);
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
      const payload = await dataprepApi.addSampleLabel(
        currentSample.sampleId,
        {
          name: hardLabelName,
          type: 'hard',
          targetScope: selectedMessage ? 'message' : 'sample',
          messageIndex: selectedTargetIndex ?? undefined,
          messageRole: selectedMessage?.role,
          targetTextSnapshot: selectedMessage?.content,
        },
        fromCommunityHub
      );
      const created = payload?.label ? normalizeLabel(payload.label) : null;
      if (!created?._id) {
        await fetchLabels(currentSample.sampleId);
        await fetchMessageLabelCounts(currentSample.sampleId);
        return;
      }

      setLabels((prev) => [created, ...prev]);
      if (created.targetScope === 'message' && Number.isInteger(created.messageIndex)) {
        setMessageLabelCounts((prev) => ({
          ...prev,
          [Number(created.messageIndex)]: (prev[Number(created.messageIndex)] || 0) + 1,
        }));
      }
      if (fromCommunityHub) {
        await handleVote(created._id, 'up');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to vote hard label');
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleAutoLabelMessages = async () => {
    if (!currentSample?.sampleId) {
      setError('Cannot auto-label: missing sampleId');
      return;
    }
    if (!currentMessagesPayload.length) {
      setError('Cannot auto-label: this conversation has no messages.');
      return;
    }

    setIsAutoLabelingMessages(true);
    setError('');

    try {
      const payload = await dataprepApi.previewMessageAutoLabels(currentSample.sampleId, {
        provider: autoLabelProvider,
        messages: currentMessagesPayload,
      });
      const nextSuggestions = (payload?.suggestions || []).reduce<Record<number, MessageAutoLabelSuggestion>>((acc, suggestion) => {
        if (Number.isInteger(suggestion.messageIndex)) {
          acc[Number(suggestion.messageIndex)] = suggestion;
        }
        return acc;
      }, {});
      setAutoLabelSuggestions(nextSuggestions);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Message auto-labeling failed');
    } finally {
      setIsAutoLabelingMessages(false);
    }
  };

  const handleSaveAutoLabels = async () => {
    if (!currentSample?.sampleId) {
      setError('Cannot save AI labels: missing sampleId');
      return;
    }

    const suggestions = Object.values(autoLabelSuggestions);
    if (!suggestions.length) {
      setError('No AI label suggestions to save.');
      return;
    }

    setIsSavingAutoLabels(true);
    setError('');

    try {
      const result = await dataprepApi.saveMessageAutoLabels(currentSample.sampleId, {
        suggestions,
        messages: currentMessagesPayload,
      });
      await fetchLabels(currentSample.sampleId, selectedTargetIndex);
      await fetchMessageLabelCounts(currentSample.sampleId);
      setAutoLabelSuggestions({});
      if (result.insertedCount === 0) {
        setError('AI labels were already saved for these messages.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save AI labels failed');
    } finally {
      setIsSavingAutoLabels(false);
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

            {currentSample?.messages.map((message, index) => {
              const isSelected = selectedMessageIndex === index;
              const labelCount = messageLabelCounts[index] || 0;
              const aiSuggestion = autoLabelSuggestions[index];
              const aiLabels = suggestionLabels(aiSuggestion);

              return (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedMessageIndex(index)}
                  className={`relative max-w-[88%] rounded-2xl px-4 py-3 text-left text-sm shadow-sm transition-all ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tl-sm'
                      : 'bg-gray-100 text-gray-800 border border-gray-200 rounded-tr-sm'
                  } ${isSelected ? 'ring-2 ring-amber-400 ring-offset-2' : 'hover:ring-2 hover:ring-blue-200 hover:ring-offset-1'}`}
                  title="Select this message for labeling"
                >
                  {labelCount > 0 && (
                    <span
                      className={`absolute -top-2 ${message.role === 'user' ? '-right-2' : '-left-2'} rounded-full border px-2 py-0.5 text-[10px] font-bold shadow-sm ${
                        message.role === 'user'
                          ? 'border-blue-200 bg-white text-blue-700'
                          : 'border-violet-200 bg-violet-600 text-white'
                      }`}
                    >
                      {labelCount}
                    </span>
                  )}
                  {aiSuggestion && aiLabels.length > 0 && (
                    <span
                      className={`absolute -bottom-2 ${message.role === 'user' ? '-right-2' : '-left-2'} flex max-w-[260px] flex-wrap items-center justify-end gap-1`}
                      title={`AI: ${aiLabels.join(', ')}${Number.isFinite(aiSuggestion.confidence) ? ` (${Math.round((aiSuggestion.confidence || 0) * 100)}%)` : ''}`}
                    >
                      {aiLabels.slice(0, 4).map((label) => {
                        const aiChip = HARD_LABEL_CHIPS[label] || DEFAULT_HARD_LABEL_CHIP;
                        const AiIcon = aiChip.icon;
                        return (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shadow-sm ${aiChip.className}`}
                          >
                            <AiIcon className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{aiChip.short}</span>
                          </span>
                        );
                      })}
                      {aiLabels.length > 4 && (
                        <span className="inline-flex rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600 shadow-sm">
                          +{aiLabels.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                  <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${message.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {message.role}
                  </p>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content || '–'}</p>
                </button>
              </div>
              );
            })}
          </div>
        </section>

        {/* ── Right pane ── */}
        <div className="space-y-3 flex flex-col">

          {/* ── Area 2: Current Labels ── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-shrink-0">
            <div className="border-b border-gray-100 px-4 py-3 bg-gradient-to-r from-violet-50 to-purple-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <Tags className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-semibold text-gray-900">Current Labels</h3>
                {labels.length > 0 && (
                  <span className="ml-auto text-xs font-medium text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-2 py-0.5">
                    {labels.length}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700">
                  {targetLabel}
                </span>
                {selectedMessage && (
                  <button
                    type="button"
                    onClick={() => setSelectedMessageIndex(null)}
                    className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Conversation
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[200px] overflow-auto p-3 space-y-2">
              {isLoadingLabels && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading labels...
                </div>
              )}

              {!isLoadingLabels && labels.length === 0 && (
                <p className="text-sm text-gray-400 py-2 text-center">
                  No labels for this {selectedMessage ? 'message' : 'conversation'} yet.
                </p>
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
                      {true && (
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
                    {true && (
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
              <select
                value={autoLabelProvider}
                onChange={(event) => setAutoLabelProvider(event.target.value as AiProvider)}
                disabled={isAutoLabelingMessages || isSavingAutoLabels || lockInteractions}
                className="ml-auto rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm outline-none hover:bg-amber-50 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                title="Choose AI provider for message auto-labeling"
              >
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">Deepseek</option>
              </select>
              <button
                type="button"
                onClick={handleAutoLabelMessages}
                disabled={isAutoLabelingMessages || isSavingAutoLabels || !currentSample?.sampleId || lockInteractions}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Use AI to suggest hard labels for every message in this conversation"
              >
                {isAutoLabelingMessages ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Auto Labeling
              </button>
            </div>

            <div className="p-3 space-y-3">
              {autoLabelSuggestionCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-amber-800">
                      AI suggested {autoLabelSuggestedLabelCount} labels across {autoLabelSuggestionCount} messages.
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveAutoLabels}
                      disabled={isSavingAutoLabels || lockInteractions}
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {isSavingAutoLabels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save AI Labels
                    </button>
                  </div>
                </div>
              )}
              {/* Hard Labels */}
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {selectedMessage ? `${selectedMessage.role.toUpperCase()} Hard Labels` : 'Conversation Hard Labels'}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {availableHardLabels.map((hardLabel) => (
                    (() => {
                      const existing = labels.find((item) => item.type === 'hard' && item.name === hardLabel);
                      const upCount = existing?.upvoteCount ?? existing?.upvotes?.length ?? 0;
                      const hasUpvoted = Boolean(
                        existing && currentUserId && Array.isArray(existing.upvotes) && existing.upvotes.includes(currentUserId)
                      );
                      const chip = HARD_LABEL_CHIPS[hardLabel] || DEFAULT_HARD_LABEL_CHIP;
                      const Icon = chip.icon;

                      return (
                    <button
                      key={hardLabel}
                      type="button"
                      disabled={isSavingLabel || !currentSample?.sampleId || lockInteractions}
                      onClick={() => handleHardLabelVote(hardLabel)}
                      title={hardLabel}
                      aria-label={`Add hard label ${hardLabel}`}
                      className={`min-w-0 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-sm ${
                        chip.className
                      } ${hasUpvoted ? 'ring-2 ring-blue-300 ring-offset-1' : ''}`}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{chip.short}</span>
                      <span className="ml-auto rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-current">
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
                onClick={() => {
                  setSelectedMessageIndex(null);
                  setCurrentIndex((prev) => Math.max(prev - 1, 0));
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                type="button"
                disabled={!canGoNextSample}
                onClick={() => {
                  setSelectedMessageIndex(null);
                  setCurrentIndex((prev) => Math.min(prev + 1, samples.length - 1));
                }}
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
        <div className="text-xs text-gray-400 font-medium">Substep — Labeling</div>
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
