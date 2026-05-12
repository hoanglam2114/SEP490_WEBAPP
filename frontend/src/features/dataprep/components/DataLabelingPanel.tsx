import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
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
  type LucideIcon,
} from 'lucide-react';
import { dataprepApi } from '../api/dataprepApi';
import { getAuthUserId } from '../../../services/authSession';

type AiProvider = 'gemini' | 'openai' | 'deepseek';

type LabelItem = {
  _id: string;
  name: string;
  type: 'hard' | 'soft';
  targetScope: 'sample' | 'message';
  messageIndex?: number;
  messageRole?: 'user' | 'assistant';
  targetTextSnapshot?: string;
  creator?: {
    id: string;
    name: string;
    email: string;
  };
  assignedUserCount: number;
  assignedByCurrentUser: boolean;
  assignedUsers?: Array<{
    id: string;
    name: string;
    email: string;
  }>;
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

type BatchAutoLabelResult = {
  processedCount: number;
  successCount: number;
  failureCount: number;
  insertedCount: number;
  results: Array<{
    sampleId: string;
    status: 'success' | 'failed' | 'skipped';
    insertedCount: number;
    suggestionCount: number;
    error?: string;
  }>;
};

type LabelingSample = {
  key: string;
  title: string;
  sampleId: string | null;
  messages: ChatMessage[];
  assignees?: Array<{
    id: string;
    name: string;
    email: string;
  }>;
};

type DataLabelingStepProps = {
  samples: LabelingSample[];
  onBack?: () => void;
  onNext?: () => void;
  showBackButton?: boolean;
  showNextButton?: boolean;
  nextDisabled?: boolean;
  fromCommunityHub?: boolean;
  datasetVersionId?: string;
  assignmentSubmissionEnabled?: boolean;
  lockInteractions?: boolean;
  lockReason?: string;
};

const CONVERSATION_HARD_LABELS = ['REJECT', 'MATH', 'PHYSICAL', 'CHEMISTRY', 'LITERATURE', 'BIOLOGY', 'OUT_OF_SCOPE'] as const;
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
  description: string;
};

const DEFAULT_HARD_LABEL_CHIP: HardLabelChip = {
  short: 'LBL',
  icon: Tag,
  className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100',
  description: 'Nhãn tùy chỉnh',
};

const HARD_LABEL_CHIPS: Record<string, HardLabelChip> = {
  REJECT: { short: 'REJ', icon: X, className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100', description: 'Từ chối hội thoại vì có vấn đề nghiêm trọng' },
  MATH: { short: 'MATH', icon: BookOpen, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100', description: 'Hội thoại thuộc môn Toán' },
  PHYSICAL: { short: 'PHYS', icon: Navigation, className: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100', description: 'Hội thoại thuộc môn Vật lý' },
  CHEMISTRY: { short: 'CHEM', icon: Sparkles, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100', description: 'Hội thoại thuộc môn Hóa học' },
  LITERATURE: { short: 'LIT', icon: MessageSquare, className: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100', description: 'Hội thoại thuộc môn Ngữ văn' },
  BIOLOGY: { short: 'BIO', icon: Heart, className: 'border-lime-200 bg-lime-50 text-lime-700 hover:bg-lime-100', description: 'Hội thoại thuộc môn Sinh học' },
  OUT_OF_SCOPE: { short: 'OOS', icon: Ban, className: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100', description: 'Hội thoại ngoài 5 nhóm môn chính' },
  CORRECT: { short: 'OK', icon: Check, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100', description: 'Người dùng trả lời đúng' },
  INCORRECT: { short: 'NO', icon: X, className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100', description: 'Người dùng trả lời sai' },
  REQUEST_HINT: { short: 'HINT', icon: Lightbulb, className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100', description: 'Người dùng yêu cầu gợi ý' },
  ASK_THEORY: { short: 'THEO', icon: BookOpen, className: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100', description: 'Người dùng hỏi về lý thuyết' },
  REQUEST_EXPLANATION: { short: 'WHY', icon: HelpCircle, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100', description: 'Người dùng yêu cầu giải thích chi tiết' },
  REQUEST_SIMPLER: { short: 'EASY', icon: Minimize2, className: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100', description: 'Người dùng yêu cầu giải thích đơn giản hơn' },
  SKIP_EXERCISE: { short: 'SKIP', icon: SkipForward, className: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100', description: 'Người dùng muốn bỏ qua bài tập' },
  ENCOURAGE: { short: 'ENC', icon: Heart, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100', description: 'Người dùng động viên, khen ngợi' },
  OFF_TOPIC: { short: 'OFF', icon: Ban, className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100', description: 'Người dùng nhắn lạc đề' },
  NEXT_SECTION: { short: 'NEXT', icon: ArrowRight, className: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100', description: 'Người dùng muốn chuyển sang phần tiếp theo' },
  WAIT_READY: { short: 'WAIT', icon: Clock, className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100', description: 'Người dùng đang chuẩn bị, yêu cầu đợi' },
  PRAISING: { short: 'PR', icon: Sparkles, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100', description: 'AI khen ngợi người dùng' },
  SCAFFOLDING: { short: 'SCAF', icon: ListTree, className: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100', description: 'AI hướng dẫn từng bước (scaffolding)' },
  HINTING: { short: 'HINT', icon: Lightbulb, className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100', description: 'AI đưa ra gợi ý' },
  CONCEPT_CLARIFY: { short: 'CLR', icon: BookOpen, className: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100', description: 'AI làm rõ khái niệm' },
  LOGIC_BREAKDOWN: { short: 'LOG', icon: ListTree, className: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100', description: 'AI phân tích logic bài toán' },
  SIMPLIFYING: { short: 'SIMP', icon: Minimize2, className: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100', description: 'AI giải thích đơn giản hơn' },
  NAVIGATING: { short: 'NAV', icon: Navigation, className: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100', description: 'AI điều hướng người dùng sang bước tiếp theo' },
  MOTIVATING: { short: 'MOT', icon: Heart, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100', description: 'AI động viên người dùng' },
  REDIRECTING: { short: 'REDIR', icon: RefreshCw, className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100', description: 'AI kéo người dùng quay lại chủ đề chính' },
  TRANSITIONING: { short: 'TRAN', icon: ArrowRight, className: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100', description: 'AI chuyển sang chủ đề mới' },
  WAITING: { short: 'WAIT', icon: PauseCircle, className: 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100', description: 'AI đợi người dùng trả lời' },
};

const LABEL_GUIDE_SECTIONS: Array<{
  title: string;
  subtitle: string;
  labels: Array<{ name: string; definition: string; pairWith?: string[] }>;
}> = [
  {
    title: 'Conversation Labels',
    subtitle: 'Nhãn ở mức toàn bộ hội thoại.',
    labels: [
      { name: 'REJECT', definition: 'Dùng khi toàn bộ hội thoại không nên đi tiếp trong pipeline vì chất lượng hoặc phạm vi không phù hợp.' },
      { name: 'MATH', definition: 'Hội thoại thuộc môn Toán.', pairWith: ['REQUEST_HINT + HINTING', 'ASK_THEORY + CONCEPT_CLARIFY'] },
      { name: 'PHYSICAL', definition: 'Hội thoại thuộc môn Vật lý.', pairWith: ['REQUEST_EXPLANATION + LOGIC_BREAKDOWN'] },
      { name: 'CHEMISTRY', definition: 'Hội thoại thuộc môn Hóa học.', pairWith: ['ASK_THEORY + CONCEPT_CLARIFY'] },
      { name: 'LITERATURE', definition: 'Hội thoại thuộc môn Ngữ văn.', pairWith: ['REQUEST_EXPLANATION + SIMPLIFYING'] },
      { name: 'BIOLOGY', definition: 'Hội thoại thuộc môn Sinh học.', pairWith: ['ASK_THEORY + CONCEPT_CLARIFY'] },
      { name: 'OUT_OF_SCOPE', definition: 'Hội thoại không thuộc 5 nhóm môn chính hoặc không đủ rõ để gán subject.' },
    ],
  },
  {
    title: 'User Intent Labels',
    subtitle: 'Nhãn cho message của user.',
    labels: [
      { name: 'CORRECT', definition: 'User trả lời đúng hoặc đi đúng hướng.' },
      { name: 'INCORRECT', definition: 'User trả lời sai hoặc suy luận lệch.', pairWith: ['SCAFFOLDING', 'HINTING'] },
      { name: 'REQUEST_HINT', definition: 'User xin gợi ý thay vì lời giải hoàn chỉnh.', pairWith: ['HINTING'] },
      { name: 'ASK_THEORY', definition: 'User hỏi khái niệm, định nghĩa hoặc kiến thức nền.', pairWith: ['CONCEPT_CLARIFY'] },
      { name: 'REQUEST_EXPLANATION', definition: 'User muốn giải thích chi tiết hơn.', pairWith: ['LOGIC_BREAKDOWN', 'SIMPLIFYING'] },
      { name: 'REQUEST_SIMPLER', definition: 'User muốn cách nói đơn giản, dễ hiểu hơn.', pairWith: ['SIMPLIFYING'] },
      { name: 'SKIP_EXERCISE', definition: 'User muốn bỏ qua bài hiện tại.', pairWith: ['TRANSITIONING', 'NAVIGATING'] },
      { name: 'ENCOURAGE', definition: 'User thể hiện thái độ tích cực, động viên hoặc khen.' , pairWith: ['PRAISING', 'MOTIVATING'] },
      { name: 'OFF_TOPIC', definition: 'User nói lệch khỏi chủ đề học tập.', pairWith: ['REDIRECTING'] },
      { name: 'NEXT_SECTION', definition: 'User muốn chuyển sang phần hoặc bài tiếp theo.', pairWith: ['TRANSITIONING', 'NAVIGATING'] },
      { name: 'WAIT_READY', definition: 'User chưa sẵn sàng, muốn tạm dừng hoặc chuẩn bị thêm.', pairWith: ['WAITING'] },
    ],
  },
  {
    title: 'Assistant Action Labels',
    subtitle: 'Nhãn cho message của assistant.',
    labels: [
      { name: 'PRAISING', definition: 'AI khen ngợi hoặc ghi nhận nỗ lực của user.', pairWith: ['CORRECT', 'ENCOURAGE'] },
      { name: 'SCAFFOLDING', definition: 'AI chia nhỏ bài toán thành từng bước để user tự làm.', pairWith: ['INCORRECT'] },
      { name: 'HINTING', definition: 'AI đưa gợi ý ngắn thay vì nói đáp án trực tiếp.', pairWith: ['REQUEST_HINT', 'INCORRECT'] },
      { name: 'CONCEPT_CLARIFY', definition: 'AI làm rõ khái niệm hoặc lý thuyết.', pairWith: ['ASK_THEORY'] },
      { name: 'LOGIC_BREAKDOWN', definition: 'AI phân tích logic hoặc quy trình giải.', pairWith: ['REQUEST_EXPLANATION'] },
      { name: 'SIMPLIFYING', definition: 'AI diễn đạt lại theo cách đơn giản hơn.', pairWith: ['REQUEST_SIMPLER', 'REQUEST_EXPLANATION'] },
      { name: 'NAVIGATING', definition: 'AI điều hướng user sang bước hoặc phần tiếp theo.', pairWith: ['NEXT_SECTION', 'SKIP_EXERCISE'] },
      { name: 'MOTIVATING', definition: 'AI động viên để user tiếp tục.', pairWith: ['ENCOURAGE', 'INCORRECT'] },
      { name: 'REDIRECTING', definition: 'AI kéo hội thoại quay về đúng chủ đề.', pairWith: ['OFF_TOPIC'] },
      { name: 'TRANSITIONING', definition: 'AI chủ động chuyển sang bài hoặc phần mới.', pairWith: ['NEXT_SECTION', 'SKIP_EXERCISE'] },
      { name: 'WAITING', definition: 'AI tạm dừng và chờ user sẵn sàng hoặc phản hồi.', pairWith: ['WAIT_READY'] },
    ],
  },
];

function getErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error
    || error?.response?.data?.details
    || error?.message
    || fallback;
}

function normalizeLabel(label: any): LabelItem {
  return {
    _id: String(label?._id || ''),
    name: String(label?.name || ''),
    type: label?.type === 'hard' ? 'hard' : 'soft',
    targetScope: label?.targetScope === 'message' ? 'message' : 'sample',
    messageIndex: Number.isInteger(label?.messageIndex) ? Number(label.messageIndex) : undefined,
    messageRole: label?.messageRole === 'user' || label?.messageRole === 'assistant' ? label.messageRole : undefined,
    targetTextSnapshot: typeof label?.targetTextSnapshot === 'string' ? label.targetTextSnapshot : undefined,
    assignedUserCount: Number(label?.assignedUserCount || 0),
    assignedByCurrentUser: Boolean(label?.assignedByCurrentUser),
    assignedUsers: Array.isArray(label?.assignedUsers)
      ? label.assignedUsers.map((user: any) => ({
          id: String(user?.id || ''),
          name: String(user?.name || ''),
          email: String(user?.email || ''),
        }))
      : undefined,
    creator: label?.creator ? {
      id: String(label.creator.id || ''),
      name: String(label.creator.name || ''),
      email: String(label.creator.email || ''),
    } : undefined,
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

export function DataLabelingPanel({
  samples,
  onBack,
  onNext,
  showBackButton = true,
  showNextButton = true,
  nextDisabled = false,
  fromCommunityHub = false,
  datasetVersionId,
  assignmentSubmissionEnabled = false,
  lockInteractions = false,
  lockReason,
}: DataLabelingStepProps) {
  const queryClient = useQueryClient();
  const currentUserId = useMemo(() => getAuthUserId(), []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [messageLabelCounts, setMessageLabelCounts] = useState<Record<number, number>>({});
  const [messageLabelNames, setMessageLabelNames] = useState<Record<number, string[]>>({});
  const [softLabelInput, setSoftLabelInput] = useState('');
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isAutoLabelingMessages, setIsAutoLabelingMessages] = useState(false);
  const [isSavingAutoLabels, setIsSavingAutoLabels] = useState(false);
  const [autoLabelProvider, setAutoLabelProvider] = useState<AiProvider>('gemini');
  const [autoLabelSuggestions, setAutoLabelSuggestions] = useState<Record<number, MessageAutoLabelSuggestion>>({});
  const [autoLabelBatchCountInput, setAutoLabelBatchCountInput] = useState('1');
  const [batchAutoLabelResult, setBatchAutoLabelResult] = useState<BatchAutoLabelResult | null>(null);
  const [isUserGuideOpen, setIsUserGuideOpen] = useState(false);
  const [error, setError] = useState('');

  const assignmentStatusQuery = useQuery({
    queryKey: ['my-assignment-submission-status', datasetVersionId],
    queryFn: () => dataprepApi.getMyAssignmentSubmissionStatus(datasetVersionId || ''),
    enabled: Boolean(datasetVersionId && assignmentSubmissionEnabled),
  });

  const submitAssignmentMutation = useMutation({
    mutationFn: () => dataprepApi.submitMyAssignment(datasetVersionId || ''),
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
      toast.success(payload?.message || 'Assignment submitted.');
    },
    onError: (err: any) => {
      setError(getErrorMessage(err, 'Submit assignment failed'));
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
    },
  });

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
  const remainingSampleCount = Math.max(samples.length - currentIndex, 0);
  const maxBatchCount = Math.max(remainingSampleCount, 1);
  const parsedBatchCount = Number.parseInt(autoLabelBatchCountInput, 10);
  const effectiveBatchCount = Math.min(
    maxBatchCount,
    Number.isInteger(parsedBatchCount) && parsedBatchCount > 0 ? parsedBatchCount : 1,
  );
  const assignmentStatus = assignmentStatusQuery.data;
  const assignmentIsLocked = assignmentStatus?.status === 'submitted' || assignmentStatus?.status === 'approved';
  const effectiveLockInteractions = lockInteractions || assignmentIsLocked;
  const effectiveLockReason = assignmentIsLocked
    ? `Assignment is ${assignmentStatus?.status}; labels are locked.`
    : lockReason;
  const contributionFilterUserId = '';

  useEffect(() => {
    if (!error) {
      return;
    }
    toast.error(error);
    setError('');
  }, [error]);

  const fetchMessageLabelCounts = async (sampleId: string) => {
    try {
      const payload = await dataprepApi.getSampleLabels(sampleId, {
        scope: 'all',
      });
      const counts: Record<number, number> = {};
      const names: Record<number, string[]> = {};
      (Array.isArray(payload?.labels) ? payload.labels.map(normalizeLabel) : [])
        .filter((label) => label.targetScope === 'message' && Number.isInteger(label.messageIndex))
        .forEach((label) => {
          const index = Number(label.messageIndex);
          counts[index] = (counts[index] || 0) + 1;
          const current = names[index] || [];
          if (!current.includes(label.name)) {
            names[index] = [...current, label.name];
          }
        });
      setMessageLabelCounts(counts);
      setMessageLabelNames(names);
    } catch {
      setMessageLabelCounts({});
      setMessageLabelNames({});
    }
  };

  const fetchLabels = async (sampleId: string, messageIndex: number | null = selectedTargetIndex) => {
    setIsLoadingLabels(true);
    setError('');

    try {
      const payload = messageIndex === null
        ? await dataprepApi.getSampleLabels(sampleId, {
          })
        : await dataprepApi.getSampleLabels(sampleId, {
            scope: 'message',
            messageIndex,
          });
      setLabels(Array.isArray(payload?.labels) ? payload.labels.map(normalizeLabel) : []);
    } catch (err: any) {
      setLabels([]);
      setError(getErrorMessage(err, 'Failed to fetch labels'));
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
      setMessageLabelNames({});
      setError('This sample has no persisted sampleId yet. Proceed through Step 4 (Clustering) to create a dataset version first.');
      return;
    }

    fetchLabels(currentSample.sampleId, selectedTargetIndex);
    fetchMessageLabelCounts(currentSample.sampleId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributionFilterUserId, currentSample?.sampleId, selectedTargetIndex]);

  useEffect(() => {
    setSelectedMessageIndex(null);
    setSoftLabelInput('');
    setAutoLabelSuggestions({});
  }, [currentSample?.sampleId]);

  useEffect(() => {
    if (!samples.length) {
      if (autoLabelBatchCountInput !== '1') {
        setAutoLabelBatchCountInput('1');
      }
      return;
    }

    if (effectiveBatchCount !== parsedBatchCount) {
      setAutoLabelBatchCountInput(String(effectiveBatchCount));
    }
  }, [autoLabelBatchCountInput, currentIndex, effectiveBatchCount, parsedBatchCount, samples.length]);

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

      await fetchLabels(currentSample.sampleId, selectedTargetIndex);
      await fetchMessageLabelCounts(currentSample.sampleId);
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to add label'));
    } finally {
      setIsSavingLabel(false);
    }
  };

  const removeLabelAssignment = async (label: LabelItem) => {
    if (!currentSample?.sampleId) {
      setError('Cannot remove label: missing sampleId');
      return;
    }

    setIsSavingLabel(true);
    setError('');

    try {
      await dataprepApi.removeSampleLabel(
        currentSample.sampleId,
        {
          name: label.name,
          type: label.type,
          targetScope: label.targetScope,
          messageIndex: label.messageIndex,
          messageRole: label.messageRole,
        },
        fromCommunityHub
      );
      await fetchLabels(currentSample.sampleId, selectedTargetIndex);
      await fetchMessageLabelCounts(currentSample.sampleId);
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to remove label'));
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleHardLabelVote = async (hardLabelName: string) => {
    const existing = labels.find((item) => item.type === 'hard' && item.name === hardLabelName);
    if (existing?.assignedByCurrentUser) {
      await removeLabelAssignment(existing);
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
      await fetchLabels(currentSample.sampleId, selectedTargetIndex);
      await fetchMessageLabelCounts(currentSample.sampleId);
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to vote hard label'));
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleAutoLabelMessages = async () => {
    if (!samples.length) {
      setError('Cannot auto-label: there are no samples.');
      return;
    }

    const targetSamples = samples
      .slice(currentIndex, currentIndex + effectiveBatchCount)
      .filter((sample) => sample.sampleId)
      .map((sample) => ({
        sampleId: String(sample.sampleId),
        messages: sample.messages.map((message, index) => ({
          messageIndex: index,
          role: message.role,
          content: message.content,
        })),
      }));

    if (!targetSamples.length) {
      setError('Cannot auto-label: selected samples are missing sampleId.');
      return;
    }

    setIsAutoLabelingMessages(true);
    setError('');
    setBatchAutoLabelResult(null);

    try {
      const payload = await dataprepApi.previewAndSaveMessageAutoLabelsBatch({
        provider: autoLabelProvider,
        samples: targetSamples,
        concurrency: 4,
      }, fromCommunityHub);
      setBatchAutoLabelResult(payload);

      const currentSampleId = currentSample?.sampleId;
      const currentSampleInBatch = currentSampleId
        ? targetSamples.some((sample) => sample.sampleId === currentSampleId)
        : false;

      if (currentSampleId && currentSampleInBatch) {
        await fetchLabels(currentSampleId, selectedTargetIndex);
        await fetchMessageLabelCounts(currentSampleId);
      }

      setAutoLabelSuggestions({});
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
      queryClient.invalidateQueries({ queryKey: ['labeling-intent-action-status', datasetVersionId] });

      toast.success(
        `Auto-labeled ${payload.successCount}/${payload.processedCount} samples. Inserted ${payload.insertedCount} labels.`,
      );
    } catch (err: any) {
      setError(getErrorMessage(err, 'Batch message auto-labeling failed'));
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
      }, fromCommunityHub);
      await fetchLabels(currentSample.sampleId, selectedTargetIndex);
      await fetchMessageLabelCounts(currentSample.sampleId);
      setAutoLabelSuggestions({});
      queryClient.invalidateQueries({ queryKey: ['my-assignment-submission-status', datasetVersionId] });
      if (result.insertedCount === 0) {
        toast('AI labels were already saved for these messages.');
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Save AI labels failed'));
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

          {currentSample && (
            <div className="border-b border-gray-100 bg-slate-50/70 px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-slate-500">Assignment</span>
                {currentSample.assignees && currentSample.assignees.length > 0 ? (
                  currentSample.assignees.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                    >
                      {item.name}
                    </span>
                  ))
                ) : (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    Unassigned
                  </span>
                )}
              </div>
            </div>
          )}

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
              const savedLabels = messageLabelNames[index] || [];
              const visibleMessageLabels = aiLabels.length > 0 ? aiLabels : savedLabels;
              const visibleMessageLabelTitle = aiLabels.length > 0
                ? `AI: ${aiLabels.join(', ')}${Number.isFinite(aiSuggestion?.confidence) ? ` (${Math.round((aiSuggestion?.confidence || 0) * 100)}%)` : ''}`
                : `Saved labels: ${savedLabels.join(', ')}`;

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
                  {visibleMessageLabels.length > 0 && (
                    <span
                      className={`absolute -bottom-2 ${message.role === 'user' ? '-right-2' : '-left-2'} flex max-w-[260px] flex-wrap items-center justify-end gap-1`}
                      title={visibleMessageLabelTitle}
                    >
                      {visibleMessageLabels.slice(0, 4).map((label) => {
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
                      {visibleMessageLabels.length > 4 && (
                        <span className="inline-flex rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600 shadow-sm">
                          +{visibleMessageLabels.length - 4}
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
                      <span className="text-[10px] text-blue-700 font-medium">{label.assignedUserCount} user(s)</span>
                      {label.assignedByCurrentUser && (
                        <span className="text-[10px] font-semibold text-emerald-700">Assigned by you</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {label.assignedByCurrentUser && (
                      <button
                        type="button"
                        disabled={effectiveLockInteractions}
                        onClick={() => removeLabelAssignment(label)}
                        title="Remove my label"
                        className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-600 transition-all hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
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
              <input
                type="number"
                min={1}
                max={maxBatchCount}
                value={autoLabelBatchCountInput}
                onChange={(event) => setAutoLabelBatchCountInput(event.target.value)}
                disabled={isAutoLabelingMessages || isSavingAutoLabels || effectiveLockInteractions || !samples.length}
                className="ml-auto w-16 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-amber-700 shadow-sm outline-none hover:bg-amber-50 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                title="Number of samples to auto-label from the start of the current list"
              />
              <select
                value={autoLabelProvider}
                onChange={(event) => setAutoLabelProvider(event.target.value as AiProvider)}
                disabled={isAutoLabelingMessages || isSavingAutoLabels || effectiveLockInteractions}
                className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm outline-none hover:bg-amber-50 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                title="Choose AI provider for message auto-labeling"
              >
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">Deepseek</option>
              </select>
              <button
                type="button"
                onClick={handleAutoLabelMessages}
                disabled={isAutoLabelingMessages || isSavingAutoLabels || !samples.length || effectiveLockInteractions}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Use AI to auto-label the first N samples in the current list"
              >
                {isAutoLabelingMessages ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Auto Labeling
              </button>
              <button
                type="button"
                onClick={() => setIsUserGuideOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm hover:bg-sky-50"
                title="Open labeling guide"
              >
                <BookOpen className="h-3.5 w-3.5" />
                User Guide
              </button>
            </div>

            <div className="p-3 space-y-3">
              {batchAutoLabelResult && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">
                    Processed {batchAutoLabelResult.processedCount} samples. Success: {batchAutoLabelResult.successCount}. Failed: {batchAutoLabelResult.failureCount}. Inserted labels: {batchAutoLabelResult.insertedCount}.
                  </p>
                </div>
              )}
              {autoLabelSuggestionCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-amber-800">
                      AI suggested {autoLabelSuggestedLabelCount} labels across {autoLabelSuggestionCount} messages.
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveAutoLabels}
                      disabled={isSavingAutoLabels || effectiveLockInteractions}
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
                      const upCount = existing?.assignedUserCount ?? 0;
                      const hasUpvoted = Boolean(existing?.assignedByCurrentUser);
                      const chip = HARD_LABEL_CHIPS[hardLabel] || DEFAULT_HARD_LABEL_CHIP;
                      const Icon = chip.icon;

                      return (
                    <button
                      key={hardLabel}
                      type="button"
                      disabled={isSavingLabel || !currentSample?.sampleId || effectiveLockInteractions}
                      onClick={() => handleHardLabelVote(hardLabel)}
                      title={`${hardLabel}: ${chip.description}`}
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
                        if (effectiveLockInteractions) {
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
                    disabled={isSavingLabel || !softLabelInput.trim() || !currentSample?.sampleId || effectiveLockInteractions}
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

      {assignmentSubmissionEnabled && assignmentStatus && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-950">Submit Assignment</p>
              <p className="text-xs text-blue-700">
                Progress: {assignmentStatus.progress.completedMessages} / {assignmentStatus.progress.requiredMessages} messages ({assignmentStatus.progress.percent}%)
                {' '}· Status: {assignmentStatus.status}
              </p>
              {!assignmentStatus.progress.isComplete && assignmentStatus.progress.missingMessages.length > 0 && (
                <p className="mt-1 text-xs text-blue-600">
                  {assignmentStatus.progress.missingMessages.length > 1 ? ` (+${assignmentStatus.progress.missingMessages.length - 1} more)` : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => submitAssignmentMutation.mutate()}
              disabled={!assignmentStatus.progress.isComplete || assignmentIsLocked || submitAssignmentMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitAssignmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Submit Result
            </button>
          </div>
        </div>
      )}

      {effectiveLockInteractions && effectiveLockReason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{effectiveLockReason}</span>
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

      {isUserGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Labeling User Guide</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Reference for manual intent-action labeling, with definitions and common intent-action pairings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUserGuideOpen(false)}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[calc(85vh-80px)] overflow-auto px-6 py-5 space-y-6">
              {LABEL_GUIDE_SECTIONS.map((section) => (
                <section key={section.title} className="space-y-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{section.title}</h4>
                    <p className="text-xs text-slate-500">{section.subtitle}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {section.labels.map((item) => {
                      const chip = HARD_LABEL_CHIPS[item.name] || DEFAULT_HARD_LABEL_CHIP;
                      const Icon = chip.icon;
                      return (
                        <div key={item.name} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${chip.className}`}>
                              <Icon className="h-3.5 w-3.5" />
                              {item.name}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">{item.definition}</p>
                          {item.pairWith && item.pairWith.length > 0 && (
                            <div className="mt-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Good pairings</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {item.pairWith.map((pair) => (
                                  <span key={pair} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                                    {pair}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
