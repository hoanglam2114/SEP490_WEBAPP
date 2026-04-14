import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileUploader } from '../components/FileUploader';
import { ConversionOptions } from '../components/ConversionOptions';
import { Preview } from '../components/Preview';
import { HuggingFaceUpload } from '../components/HuggingFaceUpload';
import { useAppStore } from '../hooks/useAppStore';
import { apiService } from '../services/api';
import type { ConversionResult } from '../types';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type PreviewMode = 'alpaca' | 'openai';
type AiProvider = 'gemini' | 'openai' | 'deepseek';

type EvaluationScores = {
  accuracy?: number | null;
  clarity?: number | null;
  completeness?: number | null;
  socratic?: number | null;
  encouragement?: number | null;
  factuality?: number | null;
  overall: number | null;
  reason: string;
};

type EvaluatedBy = 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';

type RowEvaluationEntry = {
  scores: EvaluationScores;
  evaluatedBy: EvaluatedBy;
};

type DisplayRow = {
  id: string;
  blockId: string;
  blockLabel: string;
  isBlockLast: boolean;
  instruction: string;
  input: string;
  output: string;
  userText: string;
  thinkText: string;
  assistantText: string;
  conversationPairs?: Array<{ user: string; think?: string; assistant: string }>;
  groupId?: number;
};

type ClusterGroup = {
  groupId: number;
  count: number;
  label: string;
};

type LoadProjectPayload = {
  fileId: string;
  projectName: string;
  format: 'openai' | 'alpaca';
  data: any[];
  evaluationMap: Record<string, RowEvaluationEntry>;
};

function clampScore(value: string | number): number {
  if (typeof value === 'string' && value.trim() === '') {
    return 0;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(10, Math.max(0, n));
}

function parseOptionalScore(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.min(10, Math.max(0, n));
}

function formatTableScore(value: number | null | undefined): string {
  if (value === null || value === undefined || value === -1) {
    return '';
  }
  return String(value);
}

function calculateOverallFromThree(a: number, b: number, c: number): number {
  return Math.round(((a + b + c) / 3) * 10) / 10;
}
function formatDefaultProjectName(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `Project_${dd}/${mm}_${hh}:${min}`;
}

const STEP_CONFIG: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Upload & Convert' },
  { id: 2, label: 'Clean Data' },
  { id: 3, label: 'Visualization' },
  { id: 4, label: 'Clustering Data' },
  { id: 5, label: 'Evaluation' },
  { id: 6, label: 'Data Refinement' },
  { id: 7, label: 'Finish' },
];

type VisualizationResult = {
  elbow: Array<{ k: number; wcss: number }>;
  kDistance: Array<{ rank: number; distance: number }>;
  pointCount: number;
  noiseCount?: number;
};

// NOTE: Local visualization helpers (euclideanDistance, vectorMean, computeKMeansWcss,
// computeElbow, computeKDistance, buildFeatureVectors) have been removed.
// Step 3 now uses GPU Service API for semantic embedding-based computation.

function shuffle<T>(arr: T[]): T[] {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sanitizeRecordForDownload(record: any, mode: PreviewMode): any {
  if (mode === 'openai') {
    const messages = Array.isArray(record?.messages) ? record.messages : [];
    return {
      messages: messages.map((msg: any) => ({
        role: String(msg?.role || ''),
        content: String(msg?.content || ''),
      })),
    };
  }

  return {
    instruction: String(record?.instruction ?? record?.query ?? ''),
    input: String(record?.input ?? record?.context ?? ''),
    output: String(record?.output ?? record?.answer ?? record?.response ?? ''),
  };
}

const METRIC_TOOLTIPS: Record<string, string> = {
  socratic:
    'TÍNH SƯ PHẠM: Điểm tối đa nếu AI không đưa ra đáp án trực tiếp xuyên suốt hội thoại, chỉ dùng câu hỏi gợi mở hoặc ví dụ tương tự. Điểm 0 nếu AI đưa đáp án quá sớm hoặc giải hộ bài ở bất kỳ lượt nào.',
  encouragement:
    "TÍNH KHÍCH LỆ (encouragement):\n- Điểm tối đa (9-10): AI sử dụng ngôn ngữ tích cực, công nhận nỗ lực của người dùng. Tông giọng ấm áp, thân thiện và giàu năng lượng.\n- Điểm trung bình (5-8): Có khen ngợi nhưng còn rập khuôn hoặc khen không đúng lúc. Tông giọng trung tính.\n- ĐIỂM 0: AI phản hồi cụt lủn, máy móc, hoặc tệ hơn là có thái độ gây nản lòng (ví dụ: \"Sai rồi, làm lại đi\").",
  factuality:
    'ĐỘ CHÍNH XÁC KIẾN THỨC: Điểm tối đa nếu kiến thức, công thức và logic đều đúng trong toàn bộ hội thoại. Điểm 0 nếu có thông tin sai lệch hoặc tính toán sai.',
  accuracy:
    'CHÍNH XÁC: Câu trả lời có đúng về mặt nội dung không?',
  clarity:
    'RÕ RÀNG: Câu trả lời có dễ hiểu, văn phong rõ ràng không?',
  completeness:
    'ĐỦ Ý: Câu trả lời có bao phủ đầy đủ nội dung câu hỏi không?',
};

function parseThinkContent(content: string): { thinkText: string; assistantText: string } {
  const thinkMatches = [...content.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
  const thinkText = thinkMatches.map((m) => (m[1] || '').trim()).filter(Boolean).join('\n\n');
  const assistantText = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  return {
    thinkText,
    assistantText,
  };
}

function normalizeOpenAIConversations(rawData: any[]): Array<{ conversation_id: string; messages: Array<{ role: string; content: string }> }> {
  if (rawData.every((item) => Array.isArray(item?.messages))) {
    return rawData.map((item, index) => ({
      conversation_id: String(item?.conversation_id || `conv-${index + 1}`),
      messages: item.messages.map((msg: any) => ({
        role: String(msg?.role || ''),
        content: String(msg?.content || ''),
      })),
    }));
  }

  const isRawMessageList = rawData.every((item) => item?.conversation_id && item?.role && item?.content !== undefined);

  if (!isRawMessageList) {
    return [];
  }

  const grouped = new Map<string, any[]>();
  rawData.forEach((item) => {
    const key = String(item.conversation_id);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(item);
  });

  return Array.from(grouped.entries()).map(([conversationId, messages]) => {
    const sorted = [...messages].sort((a, b) => {
      const ta = new Date(a?.created_at?.$date || a?.created_at || 0).getTime();
      const tb = new Date(b?.created_at?.$date || b?.created_at || 0).getTime();
      return ta - tb;
    });

    return {
      conversation_id: conversationId,
      messages: sorted.map((msg) => ({
        role: String(msg.role || ''),
        content: String(msg.content || ''),
      })),
    };
  });
}

function buildDisplayRows(data: any[], mode: PreviewMode, removeThinkTags: boolean): DisplayRow[] {
  if (mode === 'openai') {
    const conversations = normalizeOpenAIConversations(data);
    const rows: DisplayRow[] = [];

    conversations.forEach((conv, convIndex) => {
      const pairs: Array<{ user: string; think: string; assistant: string }> = [];
      const messages = conv.messages || [];

      for (let i = 0; i < messages.length; i += 1) {
        const current = messages[i];
        if (current.role !== 'user') {
          continue;
        }

        const nextAssistant = messages.slice(i + 1).find((msg) => msg.role === 'assistant');
        const parsed = parseThinkContent(String(nextAssistant?.content || ''));

        pairs.push({
          user: String(current.content || ''),
          think: removeThinkTags ? '' : parsed.thinkText,
          assistant: parsed.assistantText,
        });
      }

      if (pairs.length === 0) {
        return;
      }

      rows.push({
        id: String(conv.conversation_id),
        blockId: String(conv.conversation_id),
        blockLabel: `Conversation ${convIndex + 1}`,
        isBlockLast: true,
        instruction: pairs[0].user,
        input: pairs[0].think,
        output: pairs[0].assistant,
        userText: pairs[0].user,
        thinkText: pairs[0].think,
        assistantText: pairs[0].assistant,
        conversationPairs: pairs,
        groupId: (conv as any).cluster,
      });
    });

    return rows;
  }

  return data.map((item, index) => {
    const instruction = String(item?.instruction ?? item?.query ?? item?.question ?? '');
    const input = String(item?.input ?? item?.context ?? '');
    const output = String(item?.output ?? item?.answer ?? item?.response ?? '');

    return {
      id: `alpaca-${index}`,
      blockId: `alpaca-${index}`,
      blockLabel: `Record ${index + 1}`,
      isBlockLast: true,
      instruction,
      input,
      output,
      userText: instruction,
      thinkText: input,
      assistantText: output,
      groupId: (item as any).cluster,
    };
  });
}

function StepperHeader({ currentStep }: { currentStep: Step }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="grid grid-cols-7 gap-2 sm:gap-3">
        {STEP_CONFIG.map((step) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;

          return (
            <div
              key={step.id}
              className={`h-full min-h-[92px] rounded-xl border px-2 py-2 text-center ${isCompleted
                ? 'border-green-200 bg-green-50'
                : isActive
                  ? 'border-primary-200 bg-primary-50'
                  : 'border-gray-200 bg-white'
                }`}
            >
              <div
                className={`mx-auto w-7 h-7 sm:w-8 sm:h-8 rounded-full border flex items-center justify-center text-[11px] sm:text-xs font-semibold ${isCompleted
                  ? 'bg-green-600 border-green-600 text-white'
                  : isActive
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600'
                  }`}
              >
                {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </div>
              <p className="mt-1 text-[10px] sm:text-[11px] text-gray-500">Step {step.id}</p>
              <p className={`text-[11px] sm:text-xs font-semibold leading-tight ${isActive ? 'text-primary-700' : 'text-gray-800'}`}>
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailTextModal({
  isOpen,
  title,
  content,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  content: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h4 className="text-base font-semibold text-gray-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">{content || '-'}</p>
        </div>
      </div>
    </div>
  );
}

function ActionModalFrame({
  isOpen,
  title,
  description,
  confirmText,
  isSubmitting,
  onClose,
  onConfirm,
  children,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h4 className="text-base font-semibold text-gray-900">{title}</h4>
          <p className="mt-1 text-sm text-gray-600">{description}</p>
        </div>

        <div className="space-y-4 px-5 py-4">{children}</div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(isSubmitting)}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={Boolean(isSubmitting)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-400"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function EvaluateModal({
  isOpen,
  provider,
  onProviderChange,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  isOpen: boolean;
  provider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}) {
  return (
    <ActionModalFrame
      isOpen={isOpen}
      title="Evaluate with AI"
      description="Choose a model to evaluate all visible rows on this page."
      confirmText="Confirm Evaluation"
      isSubmitting={isSubmitting}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">AI Model</label>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as AiProvider)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">Deepseek</option>
        </select>
      </div>
    </ActionModalFrame>
  );
}

function RefineModal({
  isOpen,
  provider,
  scoreThreshold,
  onProviderChange,
  onScoreThresholdChange,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  isOpen: boolean;
  provider: AiProvider;
  scoreThreshold: number;
  onProviderChange: (provider: AiProvider) => void;
  onScoreThresholdChange: (value: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}) {
  return (
    <ActionModalFrame
      isOpen={isOpen}
      title="Refine Data"
      description="Choose a model and score threshold to refine all targeted visible rows."
      confirmText="Confirm Refinement"
      isSubmitting={isSubmitting}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">AI Model</label>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as AiProvider)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">Deepseek</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Refine items with overall &lt;=</label>
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={scoreThreshold}
          onChange={(e) => onScoreThresholdChange(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>
    </ActionModalFrame>
  );
}

function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h4 className="text-base font-semibold text-gray-900">Remove</h4>
          <p className="mt-1 text-sm text-gray-600">Are you sure you want to remove this item?</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function ClampedTextCell({
  text,
  label,
  onReadMore,
}: {
  text: string;
  label: string;
  onReadMore: (title: string, content: string) => void;
}) {
  const displayText = text || '-';
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const evaluateOverflow = () => {
      const node = textRef.current;
      if (!node) {
        return;
      }
      setIsOverflowing(node.scrollHeight > node.clientHeight + 1);
    };

    evaluateOverflow();
    window.addEventListener('resize', evaluateOverflow);
    return () => window.removeEventListener('resize', evaluateOverflow);
  }, [displayText]);

  return (
    <div>
      <p ref={textRef} className="whitespace-pre-wrap break-words line-clamp-3 text-gray-800">
        {displayText}
      </p>
      {isOverflowing && (
        <button
          type="button"
          onClick={() => onReadMore(label, displayText)}
          className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Read more
        </button>
      )}
    </div>
  );
}

function ConvertedDatasetTable({
  rows,
  mode,
  showEvaluationColumns,
  showEvaluationActions = true,
  showRowSelection = true,
  evaluationMap,
  selectedManualRows,
  selectedRows,
  rowHighlightMap,
  editableSelectedRows = true,
  onEvaluate,
  onAccept,
  onReset,
  onToggleRow,
  onManualFieldChange,
  extraActions,
  isEvaluating,
  disableEvaluate,
  isAccepting,
  onVisibleRowsChange,
  onRequestDeleteRow,
}: {
  rows: DisplayRow[];
  mode: PreviewMode;
  showEvaluationColumns?: boolean;
  showEvaluationActions?: boolean;
  showRowSelection?: boolean;
  evaluationMap?: Record<string, RowEvaluationEntry>;
  selectedManualRows?: Set<string>;
  selectedRows?: Set<string>;
  rowHighlightMap?: Record<string, 'refined'>;
  editableSelectedRows?: boolean;
  onEvaluate?: () => void;
  onAccept?: () => void;
  onReset?: () => void;
  onToggleRow?: (row: DisplayRow, checked: boolean) => void;
  onManualFieldChange?: (row: DisplayRow, field: string, value: string) => void;
  extraActions?: any;
  isEvaluating?: boolean;
  disableEvaluate?: boolean;
  isAccepting?: boolean;
  onVisibleRowsChange?: (rows: DisplayRow[]) => void;
  onRequestDeleteRow?: (row: DisplayRow) => void;
}) {
  const PAGE_SIZE_STEPS = [5, 10, 20, 100, 250, 500];
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_STEPS[0]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [detailModal, setDetailModal] = useState<{ title: string; content: string } | null>(null);
  const lastVisibleSignatureRef = useRef<string>('');

  useEffect(() => {
    setCurrentPage(1);
  }, [rows.length, pageSize, showAll]);

  const totalRows = rows.length;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const startIndex = showAll ? 0 : (safePage - 1) * pageSize;
  const endIndexExclusive = showAll ? totalRows : Math.min(startIndex + pageSize, totalRows);
  const visibleRows = rows.slice(startIndex, endIndexExclusive);

  useEffect(() => {
    if (!onVisibleRowsChange) {
      return;
    }

    const signature = `${startIndex}:${endIndexExclusive}:${visibleRows.map((row) => row.id).join('|')}`;
    if (signature === lastVisibleSignatureRef.current) {
      return;
    }

    lastVisibleSignatureRef.current = signature;
    onVisibleRowsChange(visibleRows);
  }, [onVisibleRowsChange, visibleRows]);

  const currentStepIndex = PAGE_SIZE_STEPS.indexOf(pageSize);
  const canIncreaseLimit = currentStepIndex >= 0 && currentStepIndex < PAGE_SIZE_STEPS.length - 1;

  const handleIncreaseLimit = () => {
    if (!canIncreaseLimit) {
      return;
    }
    setPageSize(PAGE_SIZE_STEPS[currentStepIndex + 1]);
  };

  const hasRows = totalRows > 0;
  const showDeleteAction = Boolean(onRequestDeleteRow);
  const emptyColSpan = (showEvaluationColumns ? (showRowSelection ? 9 : 8) : 3) + (showDeleteAction ? 1 : 0);
  const metricA = mode === 'openai' ? 'socratic' : 'accuracy';
  const metricB = mode === 'openai' ? 'encouragement' : 'clarity';
  const metricC = mode === 'openai' ? 'factuality' : 'completeness';

  const renderMetricHeader = (metric: 'socratic' | 'encouragement' | 'factuality' | 'accuracy' | 'clarity' | 'completeness') => (
    <span className="relative inline-flex items-center group cursor-help" title={METRIC_TOOLTIPS[metric]}>
      {metric}
      <span className="absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-md border border-gray-200 bg-white p-2 text-xs font-normal text-gray-700 shadow-lg group-hover:block">
        {METRIC_TOOLTIPS[metric]}
      </span>
    </span>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">Converted Dataset Preview</h3>
          <div className="text-xs text-gray-600">
            {totalRows === 0
              ? 'No records'
              : `Showing ${startIndex + 1}-${endIndexExclusive} of ${totalRows} records`}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowAll((prev) => !prev)}
              disabled={!hasRows}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
            >
              {showAll ? 'Use Pagination' : 'Show All'}
            </button>
            <button
              onClick={handleIncreaseLimit}
              disabled={!hasRows || showAll || !canIncreaseLimit}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
            >
              Increase Limit ({pageSize})
            </button>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              disabled={!hasRows || showAll}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-60 text-xs font-semibold text-gray-700"
            >
              {PAGE_SIZE_STEPS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>

          </div>

          {showEvaluationColumns && showEvaluationActions && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onEvaluate}
                disabled={!hasRows || disableEvaluate || isEvaluating}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white text-xs font-semibold"
              >
                {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Evaluate with AI</span>
              </button>

              {extraActions}

              <button
                onClick={onAccept}
                disabled={!hasRows || isAccepting}
                className="px-4 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
              >
                Accept
              </button>

              <button
                onClick={onReset}
                disabled={!hasRows}
                className="px-4 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[680px]">
        <table className="min-w-full text-sm table-fixed">
          <colgroup>
            {showEvaluationColumns && showRowSelection && <col className="w-[48px]" />}
            <col className="w-[30%]" />
            <col className="w-[20%]" />
            <col className="w-[40%]" />
            {showEvaluationColumns && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="min-w-[280px]" />}
            {showDeleteAction && <col className="w-[64px]" />}
          </colgroup>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {showEvaluationColumns && showRowSelection && <th className="px-4 py-3 w-[48px]" />}
              <th className="text-left px-4 py-3 font-semibold text-gray-700">
                {mode === 'openai' ? 'User' : 'Instruction'}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">
                {mode === 'openai' ? '<think>' : 'Input'}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">
                {mode === 'openai' ? 'Assistant' : 'Output'}
              </th>
              {showEvaluationColumns && (
                <>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricA)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricB)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricC)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">overall</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-[280px]">reason</th>
                  {showDeleteAction && <th className="px-2 py-3" />}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? (
              showEvaluationColumns && mode === 'openai'
                ? visibleRows.flatMap((row, index) => {
                  const entry = evaluationMap?.[row.id] || evaluationMap?.[row.blockId];
                  const score = entry?.scores;
                  const activeSelection = selectedRows || selectedManualRows;
                  const isManual = activeSelection?.has(row.id) || activeSelection?.has(row.blockId) || false;
                  const metricInputClass =
                    'w-20 px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';
                  const reasonInputClass =
                    'w-full min-w-[220px] px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';

                  const pairs = row.conversationPairs && row.conversationPairs.length > 0
                    ? row.conversationPairs
                    : [{ user: row.userText || '-', assistant: row.assistantText || '-' }];

                  return pairs.map((pair, pairIndex) => (
                    <tr
                      key={`${row.id}-${pairIndex}`}
                      className={`align-top ${pairIndex === pairs.length - 1
                        ? 'border-b-4 border-b-gray-200'
                        : 'border-b border-b-gray-100'
                        } ${index === 0 && pairIndex === 0 ? 'border-t border-t-gray-100' : ''} ${isManual ? 'bg-emerald-50' : ''
                        } ${(rowHighlightMap?.[row.id] || rowHighlightMap?.[row.blockId]) === 'refined' ? 'bg-sky-50' : ''
                        }`}
                    >
                      {pairIndex === 0 && (
                        showRowSelection ? (
                          <td className="px-4 py-3 align-top" rowSpan={pairs.length}>
                            <input
                              type="checkbox"
                              checked={isManual}
                              onChange={(e) => onToggleRow?.(row, e.target.checked)}
                            />
                          </td>
                        ) : null
                      )}

                      <td className="px-4 py-3 align-top">
                        <ClampedTextCell
                          text={pair.user || '-'}
                          label="User"
                          onReadMore={(title, content) => setDetailModal({ title, content })}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{pair.think || '-'}</td>
                      <td className="px-4 py-3 align-top">
                        <ClampedTextCell
                          text={pair.assistant || '-'}
                          label="Assistant"
                          onReadMore={(title, content) => setDetailModal({ title, content })}
                        />
                      </td>

                      {pairIndex === 0 && (
                        <>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual && editableSelectedRows ? (
                              <input
                                type="number"
                                min={0}
                                max={10}
                                step="any"
                                value={score?.socratic ?? ''}
                                onChange={(e) => onManualFieldChange?.(row, 'socratic', e.target.value)}
                                className={metricInputClass}
                              />
                            ) : (
                              formatTableScore(score?.socratic)
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual && editableSelectedRows ? (
                              <input
                                type="number"
                                min={0}
                                max={10}
                                step="any"
                                value={score?.encouragement ?? ''}
                                onChange={(e) => onManualFieldChange?.(row, 'encouragement', e.target.value)}
                                className={metricInputClass}
                              />
                            ) : (
                              formatTableScore(score?.encouragement)
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual && editableSelectedRows ? (
                              <input
                                type="number"
                                min={0}
                                max={10}
                                step="any"
                                value={score?.factuality ?? ''}
                                onChange={(e) => onManualFieldChange?.(row, 'factuality', e.target.value)}
                                className={metricInputClass}
                              />
                            ) : (
                              formatTableScore(score?.factuality)
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 font-semibold align-top" rowSpan={pairs.length}>{formatTableScore(score?.overall)}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words align-top" rowSpan={pairs.length}>
                            {isManual && editableSelectedRows ? (
                              <input
                                type="text"
                                value={score?.reason ?? ''}
                                onChange={(e) => onManualFieldChange?.(row, 'reason', e.target.value)}
                                className={reasonInputClass}
                              />
                            ) : (
                              score?.reason ?? ''
                            )}
                          </td>
                          {showDeleteAction && (
                            <td className="px-2 py-3 align-bottom" rowSpan={pairs.length}>
                              <div className="flex h-full items-end justify-end">
                                <button
                                  type="button"
                                  onClick={() => onRequestDeleteRow?.(row)}
                                  className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                  title="Delete sample"
                                  aria-label="Delete sample"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  ));
                })
                : mode === 'openai'
                  ? visibleRows.flatMap((row, index) => {
                    const pairs = row.conversationPairs && row.conversationPairs.length > 0
                      ? row.conversationPairs
                      : [{ user: row.userText || '-', think: row.thinkText || '-', assistant: row.assistantText || '-' }];

                    return pairs.map((pair, pairIndex) => (
                      <tr
                        key={`${row.id}-${pairIndex}`}
                        className={`align-top ${pairIndex === pairs.length - 1
                          ? 'border-b-4 border-b-gray-200'
                          : 'border-b border-b-gray-100'
                          } ${index === 0 && pairIndex === 0 ? 'border-t border-t-gray-100' : ''}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <ClampedTextCell
                            text={pair.user || '-'}
                            label="User"
                            onReadMore={(title, content) => setDetailModal({ title, content })}
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{pair.think || '-'}</td>
                        <td className="px-4 py-3 align-top">
                          <ClampedTextCell
                            text={pair.assistant || '-'}
                            label="Assistant"
                            onReadMore={(title, content) => setDetailModal({ title, content })}
                          />
                        </td>
                      </tr>
                    ));
                  })
                  : visibleRows.map((row, index) => {
                    const entry = evaluationMap?.[row.id] || evaluationMap?.[row.blockId];
                    const score = entry?.scores;
                    const activeSelection = selectedRows || selectedManualRows;
                    const isManual = activeSelection?.has(row.id) || activeSelection?.has(row.blockId) || false;
                    const metricInputClass =
                      'w-20 px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';
                    const reasonInputClass =
                      'w-full min-w-[220px] px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';

                    return (
                      <tr
                        key={row.id}
                        className={`align-top ${row.isBlockLast ? 'border-b-4 border-b-gray-200' : 'border-b border-b-gray-100'
                          } ${index === 0 ? 'border-t border-t-gray-100' : ''} ${isManual ? 'bg-emerald-50' : ''} ${(rowHighlightMap?.[row.id] || rowHighlightMap?.[row.blockId]) === 'refined' ? 'bg-sky-50' : ''}`}
                      >
                        {showEvaluationColumns && showRowSelection && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isManual}
                              onChange={(e) => onToggleRow?.(row, e.target.checked)}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 align-top">
                          <ClampedTextCell
                            text={row.userText || '-'}
                            label="Instruction"
                            onReadMore={(title, content) => setDetailModal({ title, content })}
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{row.thinkText || '-'}</td>
                        <td className="px-4 py-3 align-top">
                          <ClampedTextCell
                            text={row.assistantText || '-'}
                            label="Output"
                            onReadMore={(title, content) => setDetailModal({ title, content })}
                          />
                        </td>
                        {showEvaluationColumns && (
                          <>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual && editableSelectedRows ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={10}
                                  step="any"
                                  value={score?.accuracy ?? ''}
                                  onChange={(e) => onManualFieldChange?.(row, 'accuracy', e.target.value)}
                                  className={metricInputClass}
                                />
                              ) : (
                                formatTableScore(score?.accuracy)
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual && editableSelectedRows ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={10}
                                  step="any"
                                  value={score?.clarity ?? ''}
                                  onChange={(e) => onManualFieldChange?.(row, 'clarity', e.target.value)}
                                  className={metricInputClass}
                                />
                              ) : (
                                formatTableScore(score?.clarity)
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual && editableSelectedRows ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={10}
                                  step="any"
                                  value={score?.completeness ?? ''}
                                  onChange={(e) => onManualFieldChange?.(row, 'completeness', e.target.value)}
                                  className={metricInputClass}
                                />
                              ) : (
                                formatTableScore(score?.completeness)
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-semibold">{formatTableScore(score?.overall)}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words">
                              {isManual && editableSelectedRows ? (
                                <input
                                  type="text"
                                  value={score?.reason ?? ''}
                                  onChange={(e) => onManualFieldChange?.(row, 'reason', e.target.value)}
                                  className={reasonInputClass}
                                />
                              ) : (
                                score?.reason ?? ''
                              )}
                            </td>
                            {showDeleteAction && (
                              <td className="px-2 py-3 align-bottom">
                                <div className="flex h-full items-end justify-end">
                                  <button
                                    type="button"
                                    onClick={() => onRequestDeleteRow?.(row)}
                                    className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    title="Delete sample"
                                    aria-label="Delete sample"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    );
                  })
            ) : (
              <tr>
                <td colSpan={emptyColSpan} className="px-4 py-10 text-center text-gray-500">
                  No converted records to preview.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!showAll && totalRows > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
          >
            Previous
          </button>
          <div className="text-xs text-gray-600 font-medium">
            Page {safePage} / {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={safePage >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
          >
            Next
          </button>
        </div>
      )}

      <DetailTextModal
        isOpen={Boolean(detailModal)}
        title={detailModal?.title || ''}
        content={detailModal?.content || ''}
        onClose={() => setDetailModal(null)}
      />
    </div>
  );
}

function StepNavigation({
  showBack,
  showNext,
  onBack,
  onNext,
  nextDisabled,
}: {
  showBack?: boolean;
  showNext?: boolean;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        {showBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-medium text-gray-700"
          >
            Back
          </button>
        )}
      </div>
      <div>
        {showNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-medium"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function FileStatisticsCard({ stats }: { stats: any }) {
  if (!stats) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-6 border border-primary-200 shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
        <Zap className="w-4 h-4 mr-2 text-primary-600" />
        File Statistics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-2xl font-bold text-primary-600">
            {stats.fileType === 'lesson'
              ? stats.lessonCount?.toLocaleString()
              : stats.conversationCount?.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 font-medium">
            {stats.fileType === 'lesson' ? 'Lessons' : 'Conversations'}
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-primary-600">
            {stats.fileType === 'lesson'
              ? stats.exerciseCount?.toLocaleString()
              : stats.messageCount?.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 font-medium">
            {stats.fileType === 'lesson' ? 'Exercises' : 'Messages'}
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-primary-600">{stats.uniqueUsers}</div>
          <div className="text-sm text-gray-600 font-medium">Unique Users</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-primary-600">{stats.avgMessagesPerConversation}</div>
          <div className="text-sm text-gray-600 font-medium">Avg Msg/Conv</div>
        </div>
      </div>

      {stats.fileType !== 'lesson' && (
        <div className="mt-4 pt-4 border-t border-primary-100 items-center flex text-xs text-gray-500">
          <span className="font-medium mr-2 text-gray-700">Date Range:</span>
          {new Date(stats.dateRange.earliest).toLocaleDateString()} -{' '}
          {new Date(stats.dateRange.latest).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function PostConversionSummary({ result }: { result: ConversionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="bg-green-50 px-4 py-3 border-b border-green-100 flex items-center text-green-800">
        <CheckCircle2 className="w-4 h-4 mr-2" />
        <span className="font-semibold text-sm">Post-conversion Statistics</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <div className="text-gray-500 text-xs">Total Units</div>
            <div className="font-semibold text-gray-900">{result.stats.totalConversations.toLocaleString()}</div>
          </div>
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <div className="text-gray-500 text-xs">Total Messages</div>
            <div className="font-semibold text-gray-900">{result.stats.totalMessages.toLocaleString()}</div>
          </div>
        </div>

        {result.stats.cleaning && (
          <div className="pt-3 border-t border-gray-100">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">Cleaning Report</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 p-2 rounded-lg">
                <div className="text-xs text-gray-500">Boilerplate</div>
                <div className="text-sm font-semibold text-red-600">-{result.stats.cleaning.removedBoilerplate}</div>
              </div>
              <div className="bg-gray-50 p-2 rounded-lg">
                <div className="text-xs text-gray-500">Length</div>
                <div className="text-sm font-semibold text-orange-600">
                  -{result.stats.cleaning.removedTooShort + result.stats.cleaning.removedTooLong}
                </div>
              </div>
              <div className="bg-gray-50 p-2 rounded-lg">
                <div className="text-xs text-gray-500">Duplicates</div>
                <div className="text-sm font-semibold text-yellow-600">-{result.stats.cleaning.removedDuplicates}</div>
              </div>
              <div className="bg-primary-50 p-2 rounded-lg">
                <div className="text-xs text-primary-700">Final Count</div>
                <div className="text-sm font-bold text-primary-700">{result.stats.cleaning.finalCount}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CleaningPipelineOptions({ onAccept, isLoading }: { onAccept: () => void; isLoading: boolean }) {
  const { conversionOptions, updateConversionOptions } = useAppStore();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Data Cleaning Pipeline</h3>
        <label className="flex items-center space-x-2 cursor-pointer">
          <span className="text-sm text-gray-600">Enable</span>
          <input
            type="checkbox"
            checked={conversionOptions.enableCleaning ?? false}
            onChange={(e) => updateConversionOptions({ enableCleaning: e.target.checked })}
            className="rounded"
          />
        </label>
      </div>

      {conversionOptions.enableCleaning && (
        <>
          <div className="space-y-3">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={conversionOptions.removeBoilerplate ?? true}
                onChange={(e) => updateConversionOptions({ removeBoilerplate: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Remove AI boilerplate</span>
            </label>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={conversionOptions.removeEmptyOutput ?? true}
                onChange={(e) => updateConversionOptions({ removeEmptyOutput: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Loại bỏ những mẫu không có nội dung của Assistant</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {conversionOptions.format === 'openai' ? (
              <>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min &lt;think&gt;</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsThink ?? 10}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsThink: parseInt(e.target.value, 10) || 10 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max &lt;think&gt;</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsThink ?? 2000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsThink: parseInt(e.target.value, 10) || 2000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min assistant</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsAssistant ?? 5}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsAssistant: parseInt(e.target.value, 10) || 5 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max assistant</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsAssistant ?? 4000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsAssistant: parseInt(e.target.value, 10) || 4000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Số cặp hỏi đáp tối thiểu:</label>
                  <input
                    type="number"
                    value={conversionOptions.minTurns ?? 1}
                    onChange={(e) =>
                      updateConversionOptions({ minTurns: e.target.value ? parseInt(e.target.value, 10) : 1 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min instruction</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsInstruction ?? 10}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsInstruction: parseInt(e.target.value, 10) || 10 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max instruction</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsInstruction ?? 2000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsInstruction: parseInt(e.target.value, 10) || 2000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min output</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsOutput ?? 5}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsOutput: parseInt(e.target.value, 10) || 5 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max output</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsOutput ?? 4000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsOutput: parseInt(e.target.value, 10) || 4000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Số cặp hỏi đáp tối thiểu:</label>
                  <input
                    type="number"
                    value={conversionOptions.minTurns ?? 1}
                    onChange={(e) =>
                      updateConversionOptions({ minTurns: e.target.value ? parseInt(e.target.value, 10) : 1 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
              </>
            )}
          </div>

          <div className="pt-2 border-t border-gray-100 flex justify-end">
            <button
              onClick={onAccept}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              Accept & Apply Cleaning
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ConversionPage() {
  const { uploadedFile, conversionOptions, projectName, setProjectName, updateConversionOptions } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [originalConvertedResult, setOriginalConvertedResult] = useState<ConversionResult | null>(null);
  const [visualizationResult, setVisualizationResult] = useState<VisualizationResult | null>(null);
  const [maxK, setMaxK] = useState<number>(20);
  const [dbscanEps, setDbscanEps] = useState<number>(0.15);
  const [dbscanMinSamples, setDbscanMinSamples] = useState<number>(6);
  const [clusterK, setClusterK] = useState<number>(8);
  const [isVisualizing, setIsVisualizing] = useState<boolean>(false);
  const [evaluationMap, setEvaluationMap] = useState<Record<string, RowEvaluationEntry>>({});
  const [manualRowIds, setManualRowIds] = useState<Set<string>>(new Set());
  const [refinementSelectedRowIds, setRefinementSelectedRowIds] = useState<Set<string>>(new Set());
  const [refinedRowIds, setRefinedRowIds] = useState<Set<string>>(new Set());
  const [clusterGroups, setClusterGroups] = useState<ClusterGroup[]>([]);
  const [rowClusterMap, setRowClusterMap] = useState<Record<string, number>>({});
  const [selectedClusterIds, setSelectedClusterIds] = useState<number[]>([]);
  const [filterThreshold, setFilterThreshold] = useState<number>(0.9);
  const [downloadScoreThreshold, setDownloadScoreThreshold] = useState<number>(8);
  const [loadedProjectFileId, setLoadedProjectFileId] = useState<string | null>(null);
  const [clusteredResult, setClusteredResult] = useState<{ data: any[]; assignments: number[]; groups: ClusterGroup[] } | null>(null);
  const [visibleRowsInEvaluation, setVisibleRowsInEvaluation] = useState<DisplayRow[]>([]);
  const [visibleRowsInRefinement, setVisibleRowsInRefinement] = useState<DisplayRow[]>([]);
  const [isEvaluateModalOpen, setIsEvaluateModalOpen] = useState(false);
  const [isRefineModalOpen, setIsRefineModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DisplayRow | null>(null);
  const [evaluateProvider, setEvaluateProvider] = useState<AiProvider>('gemini');
  const [refineProvider, setRefineProvider] = useState<AiProvider>('gemini');
  const [refineScoreThreshold, setRefineScoreThreshold] = useState<number>(8);
  const loadHandledRef = useRef<boolean>(false);

  const { data: stats } = useQuery({
    queryKey: ['stats', uploadedFile?.fileId],
    queryFn: () => apiService.getStats(uploadedFile!.fileId),
    enabled: !!uploadedFile,
  });

  const previewMode: PreviewMode = conversionOptions.format === 'openai' ? 'openai' : 'alpaca';

  const allRows = useMemo(
    () => buildDisplayRows(conversionResult?.data || [], previewMode, conversionOptions.removeThinkTags ?? true),
    [conversionResult?.data, conversionOptions.removeThinkTags, previewMode]
  );

  const rowsWithClusterGroups = useMemo(
    () => allRows.map((row) => ({ ...row, groupId: rowClusterMap[row.id] ?? row.groupId })),
    [allRows, rowClusterMap]
  );

  const clusteredRows = useMemo(() => {
    if (!selectedClusterIds.length) return rowsWithClusterGroups;
    return rowsWithClusterGroups.filter((row) => row.groupId !== undefined && selectedClusterIds.includes(row.groupId));
  }, [rowsWithClusterGroups, selectedClusterIds]);

  const evaluationRows = useMemo(() => {
    if (previewMode !== 'openai') {
      return rowsWithClusterGroups;
    }

    const conversations = normalizeOpenAIConversations(conversionResult?.data || []);
    const groupByConversation = new Map<string, number | undefined>();
    rowsWithClusterGroups.forEach((row) => {
      if (!groupByConversation.has(row.blockId)) {
        groupByConversation.set(row.blockId, row.groupId);
      }
    });

    return conversations
      .map((conv, index) => {
        const pairs: Array<{ user: string; assistant: string }> = [];
        for (let i = 0; i < conv.messages.length; i += 1) {
          if (conv.messages[i].role !== 'user') continue;
          const nextAssistant = conv.messages.slice(i + 1).find((msg) => msg.role === 'assistant');
          pairs.push({ user: String(conv.messages[i].content || '').trim(), assistant: String(nextAssistant?.content || '').trim() });
        }
        const firstUser = conv.messages.find((msg) => msg.role === 'user')?.content || '';
        const lastAssistant = [...conv.messages].reverse().find((msg) => msg.role === 'assistant')?.content || '';
        return {
          id: String(conv.conversation_id),
          blockId: String(conv.conversation_id),
          blockLabel: `Conversation ${index + 1}`,
          isBlockLast: true,
          instruction: firstUser,
          input: '',
          output: lastAssistant,
          userText: pairs.map((p) => p.user).join('\n\n') || firstUser || '-',
          thinkText: '-',
          assistantText: pairs.map((p) => p.assistant).join('\n\n') || lastAssistant || '-',
          conversationPairs: pairs.length ? pairs : [{ user: firstUser || '-', assistant: lastAssistant || '-' }],
          groupId: groupByConversation.get(String(conv.conversation_id)),
        } as DisplayRow;
      });
  }, [conversionResult?.data, previewMode, rowsWithClusterGroups]);

  const averagedEvaluation = useMemo(() => {
    const values = Object.values(evaluationMap)
      .map((entry) => entry.scores)
      .filter((score) => Number.isFinite(score.overall) && (score.overall as number) >= 0);
    if (!values.length) return null;
    const total = values.reduce(
      (acc, item) => ({
        accuracy: acc.accuracy + (item.accuracy || 0),
        clarity: acc.clarity + (item.clarity || 0),
        completeness: acc.completeness + (item.completeness || 0),
        socratic: acc.socratic + (item.socratic || 0),
        encouragement: acc.encouragement + (item.encouragement || 0),
        factuality: acc.factuality + (item.factuality || 0),
        overall: acc.overall + (item.overall || 0),
      }),
      { accuracy: 0, clarity: 0, completeness: 0, socratic: 0, encouragement: 0, factuality: 0, overall: 0 }
    );
    const size = values.length;
    return {
      count: size,
      accuracy: Number((total.accuracy / size).toFixed(2)),
      clarity: Number((total.clarity / size).toFixed(2)),
      completeness: Number((total.completeness / size).toFixed(2)),
      socratic: Number((total.socratic / size).toFixed(2)),
      encouragement: Number((total.encouragement / size).toFixed(2)),
      factuality: Number((total.factuality / size).toFixed(2)),
      overall: Number((total.overall / size).toFixed(2)),
    };
  }, [evaluationMap]);

  const convertMutation = useMutation({
    mutationFn: (mode: 'initial' | 'clean') => {
      const options = mode === 'initial' ? { ...conversionOptions, enableCleaning: false } : conversionOptions;
      return apiService.convertData(uploadedFile!.fileId, options);
    },
    onSuccess: (data, mode) => {
      setConversionResult(data);
      setEvaluationMap({});
      setManualRowIds(new Set());
      setRefinementSelectedRowIds(new Set());
      setRefinedRowIds(new Set());
      setVisualizationResult(null);
      setClusterGroups([]);
      setRowClusterMap({});
      setSelectedClusterIds([]);
      setVisibleRowsInEvaluation([]);
      setVisibleRowsInRefinement([]);
      if (mode === 'initial') {
        setOriginalConvertedResult(data);
        setCurrentStep(2);
        toast.success('Conversion completed. Continue to cleaning.');
      } else {
        toast.success('Cleaning rules applied to the converted dataset.');
      }
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Conversion failed'),
  });

  const evaluateMutation = useMutation({
    mutationFn: async (params: { provider: AiProvider; rows: DisplayRow[]; excludeManualEvaluated: boolean }) => {
      const rowsToEvaluate = params.rows.filter((row) => {
        if (!params.excludeManualEvaluated) {
          return true;
        }
        const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
        return entry?.evaluatedBy !== 'manual';
      });

      if (!rowsToEvaluate.length) throw new Error('No rows to evaluate.');

      const newMap: Record<string, RowEvaluationEntry> = {};
      if (previewMode === 'openai') {
        const normalizedConvs = normalizeOpenAIConversations(conversionResult?.data || []);
        const convMessagesMap = new Map<string, Array<{ role: string; content: string }>>();
        normalizedConvs.forEach((conv) => convMessagesMap.set(String(conv.conversation_id), conv.messages));

        const convOrderedIds = Array.from(new Set(rowsToEvaluate.map((row) => row.blockId)));
        const conversationPayload = convOrderedIds.map((convId) => ({
          conversation_id: convId,
          messages: convMessagesMap.get(convId) || [],
        }));

        const evaluation = await apiService.evaluateDataChunked(conversationPayload, previewMode, undefined, params.provider);
        evaluation.samples.forEach((sample, idx) => {
          const convId = convOrderedIds[idx];
          if (!convId || !Number.isFinite(sample.scores.overall)) return;
          const score: EvaluationScores = {
            socratic: sample.scores.socratic,
            encouragement: sample.scores.encouragement,
            factuality: sample.scores.factuality,
            overall: sample.scores.overall,
            reason: sample.reason,
          };
          rowsToEvaluate.filter((row) => row.blockId === convId).forEach((row) => {
            newMap[row.id] = { scores: score, evaluatedBy: params.provider };
          });
        });
      } else {
        const payload = rowsToEvaluate.map((row) => ({ instruction: row.instruction, input: row.input, output: row.output }));
        const evaluation = await apiService.evaluateDataChunked(payload, previewMode, undefined, params.provider);
        evaluation.samples.forEach((sample, idx) => {
          const row = rowsToEvaluate[idx];
          if (!row || !Number.isFinite(sample.scores.overall)) return;
          newMap[row.id] = {
            scores: {
              accuracy: sample.scores.accuracy,
              clarity: sample.scores.clarity,
              completeness: sample.scores.completeness,
              overall: sample.scores.overall,
              reason: sample.reason,
            },
            evaluatedBy: params.provider,
          };
        });
      }
      setEvaluationMap((prev) => ({ ...prev, ...newMap }));
      return { count: Object.keys(newMap).length, provider: params.provider };
    },
    onSuccess: ({ count, provider }) => {
      const label = provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'Deepseek' : 'Gemini';
      toast.success(`Evaluation completed. ${count} rows scored by ${label}.`);
    },
    onError: (error: any) => {
      const backendError = error?.response?.data;
      const message = backendError?.details
        ? `${backendError.error}: ${backendError.details}`
        : (backendError?.error || error.message || 'Evaluation failed');
      toast.error(message);
    },
  });

  const refineMutation = useMutation({
    mutationFn: async (params: { provider: AiProvider; rows: DisplayRow[]; scoreThreshold: number }) => {
      const candidateRows = params.rows.filter((row) => {
        const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
        const overall = entry?.scores?.overall;
        return Number.isFinite(overall) && (overall as number) >= 0 && (overall as number) <= params.scoreThreshold;
      });

      if (!candidateRows.length) {
        throw new Error(`No visible rows matched overall <= ${params.scoreThreshold.toFixed(1)}.`);
      }

      const hasMissingReason = candidateRows.some((row) => {
        const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
        return !String(entry?.scores?.reason || '').trim();
      });

      if (hasMissingReason) {
        throw new Error('Please ensure all targeted items have a reason before refining.');
      }

      const payload = candidateRows.map((row) => ({
        assistant: row.assistantText,
        reason: (evaluationMap[row.id] || evaluationMap[row.blockId])?.scores.reason || '',
      }));
      const refined = await apiService.refineDataChunked(payload, params.provider);

      setConversionResult((prev) => {
        if (!prev) return prev;
        const nextData = [...prev.data];

        if (previewMode === 'openai') {
          const convs = normalizeOpenAIConversations(prev.data || []);
          const convIdToIndex = new Map<string, number>();
          convs.forEach((conv, idx) => convIdToIndex.set(String(conv.conversation_id), idx));

          candidateRows.forEach((row, idx) => {
            const targetIndex = convIdToIndex.get(row.blockId);
            const refinedText = refined.items[idx]?.refinedOutput || row.assistantText;
            if (targetIndex === undefined) return;
            const record = nextData[targetIndex];
            if (Array.isArray(record?.messages)) {
              const assistantIdx = [...record.messages]
                .map((msg: any, i: number) => ({ role: String(msg?.role || ''), i }))
                .filter((m: any) => m.role === 'assistant')
                .map((m: any) => m.i)
                .pop();
              if (assistantIdx !== undefined) {
                record.messages[assistantIdx] = {
                  ...record.messages[assistantIdx],
                  content: refinedText,
                };
              }
            }
          });
        } else {
          candidateRows.forEach((row, idx) => {
            const rowIndex = allRows.findIndex((r) => r.id === row.id);
            if (rowIndex >= 0 && nextData[rowIndex]) {
              nextData[rowIndex] = {
                ...nextData[rowIndex],
                output: refined.items[idx]?.refinedOutput || row.assistantText,
              };
            }
          });
        }

        return { ...prev, data: nextData };
      });

      const refinedIds = new Set(refinedRowIds);
      candidateRows.forEach((row) => refinedIds.add(row.id));
      setRefinedRowIds(refinedIds);

      const selectable = new Set(refinementSelectedRowIds);
      candidateRows.forEach((row) => selectable.add(row.id));
      setRefinementSelectedRowIds(selectable);

      return { count: candidateRows.length, provider: params.provider };
    },
    onSuccess: ({ count, provider }) => {
      const label = provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'Deepseek' : 'Gemini';
      toast.success(`Refined ${count} rows using ${label}.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Refinement failed'),
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const effectiveFileId = uploadedFile?.fileId || loadedProjectFileId;
      if (!effectiveFileId || !conversionResult) throw new Error('No data available to save.');
      const createdAt = new Date().toISOString();
      const convMessagesMap = new Map<string, Array<{ role: string; content: string }>>();
      if (previewMode === 'openai') {
        normalizeOpenAIConversations(conversionResult.data || []).forEach((conv) => {
          convMessagesMap.set(String(conv.conversation_id), conv.messages || []);
        });
      }

      const records = allRows
        .map((row) => {
          const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
          const defaultScores: EvaluationScores = previewMode === 'openai'
            ? {
              socratic: null,
              encouragement: null,
              factuality: null,
              overall: null,
              reason: '',
            }
            : {
              accuracy: null,
              clarity: null,
              completeness: null,
              overall: null,
              reason: '',
            };
          const resolvedScores = entry?.scores || defaultScores;

          return {
            format: previewMode,
            data: previewMode === 'openai'
              ? { messages: convMessagesMap.get(row.blockId) || [] }
              : { instruction: row.instruction, input: row.input, output: row.output },
            evaluatedBy: entry?.evaluatedBy || 'none',
            results: previewMode === 'openai'
              ? {
                socratic: resolvedScores.socratic ?? null,
                encouragement: resolvedScores.encouragement ?? null,
                factuality: resolvedScores.factuality ?? null,
                overall: resolvedScores.overall ?? null,
                reason: resolvedScores.reason,
              }
              : {
                accuracy: resolvedScores.accuracy ?? null,
                clarity: resolvedScores.clarity ?? null,
                completeness: resolvedScores.completeness ?? null,
                overall: resolvedScores.overall ?? null,
                reason: resolvedScores.reason,
              },
            createdAt,
          };
        }) as Array<any>;

      if (!records.length) throw new Error('No evaluated rows to save.');
      await apiService.saveEvaluationResults({
        fileId: effectiveFileId,
        projectName: projectName.trim() || formatDefaultProjectName(),
        items: records,
      });
      return records.length;
    },
    onSuccess: (savedCount) => toast.success(`Accepted and saved ${savedCount} records to MongoDB.`),
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Accept failed'),
  });

  const clusterMutation = useMutation({
    mutationFn: async () => {
      if (!conversionResult?.data?.length) throw new Error('No converted data to cluster.');
      return apiService.clusterData(conversionResult.data, clusterK, dbscanEps, dbscanMinSamples);
    },
    onSuccess: (result) => {
      setConversionResult((prev) => (prev ? { ...prev, data: result.data } : null));
      setClusteredResult(result);
      const nextMap: Record<string, number> = {};
      if (previewMode === 'openai') {
        const conversations = normalizeOpenAIConversations(conversionResult?.data || []);
        conversations.forEach((conv, idx) => {
          const groupId = result.assignments[idx] ?? 0;
          rowsWithClusterGroups.forEach((row) => {
            if (row.blockId === String(conv.conversation_id)) {
              nextMap[row.id] = groupId;
            }
          });
        });
      } else {
        allRows.forEach((row, idx) => {
          nextMap[row.id] = result.assignments[idx] ?? 0;
        });
      }
      setRowClusterMap(nextMap);
      setClusterGroups(result.groups);
      setSelectedClusterIds([]);
      toast.success(`Clustered data into ${result.groups.length} groups.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Clustering failed'),
  });

  const filterMutation = useMutation({
    mutationFn: async () => {
      if (!conversionResult?.data?.length) throw new Error('No clustered data to filter.');
      return apiService.clusterFilter(conversionResult.data, filterThreshold);
    },
    onSuccess: (result) => {
      setConversionResult((prev) => (prev ? { ...prev, data: result.data } : null));
      setClusterGroups(result.groups);
      const nextMap: Record<string, number> = {};
      if (previewMode === 'openai') {
        normalizeOpenAIConversations(result.data).forEach((conv, idx) => {
          nextMap[String(conv.conversation_id)] = result.assignments[idx] ?? 0;
        });
      } else {
        result.data.forEach((item, idx) => {
          nextMap[`alpaca-${idx}`] = (item as any).cluster ?? result.assignments[idx] ?? 0;
        });
      }
      setRowClusterMap(nextMap);
      setSelectedClusterIds([]);
      toast.success(`Filtered dataset down to ${result.data.length} records.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Filtering failed'),
  });

  const handleResetFiltering = () => {
    if (!clusteredResult) return;
    setConversionResult((prev) => (prev ? { ...prev, data: clusteredResult.data } : null));
    setClusterGroups(clusteredResult.groups);
    setSelectedClusterIds([]);
    toast.success('Reset to pre-filter clustered state.');
  };

  const handleResetCleaning = () => {
    if (!originalConvertedResult) return;
    setConversionResult(originalConvertedResult);
    setClusterGroups([]);
    setRowClusterMap({});
    setEvaluationMap({});
    setManualRowIds(new Set());
    setRefinedRowIds(new Set());
    setRefinementSelectedRowIds(new Set());
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    toast.success('Dataset reset to original converted state.');
  };

  const handleVisualize = async () => {
    if (!conversionResult?.data?.length) {
      toast.error('No data available for visualization.');
      return;
    }
    setIsVisualizing(true);
    try {
      const result = await apiService.clusterVisualize(conversionResult.data, maxK, dbscanEps, dbscanMinSamples);
      setVisualizationResult({
        elbow: result.elbow,
        kDistance: result.kDistance,
        pointCount: result.pointCount,
        noiseCount: result.noiseCount,
      });
      toast.success(`GPU Visualization complete — ${result.pointCount} points analyzed.`);
    } catch (err: any) {
      console.error('Visualize error:', err);
      const msg = err?.response?.data?.error || err?.message || 'Failed to compute visualization.';
      toast.error(msg);
    } finally {
      setIsVisualizing(false);
    }
  };

  const handleDownloadTrainTestZip = async () => {
    if (!conversionResult?.data?.length || !clusterGroups.length) {
      toast.error('Please run Clustering first.');
      return;
    }

    const groupAssignments =
      previewMode === 'openai'
        ? normalizeOpenAIConversations(conversionResult.data || []).map((conv) => {
            const row = rowsWithClusterGroups.find((item) => item.blockId === String(conv.conversation_id));
            return row?.groupId ?? 1;
          })
        : allRows.map((row) => rowClusterMap[row.id] ?? row.groupId ?? 1);

    const byGroup = new Map<number, number[]>();
    groupAssignments.forEach((groupId, idx) => {
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId)!.push(idx);
    });

    const testIndexSet = new Set<number>();
    byGroup.forEach((indices) => {
      const shuffled = shuffle(indices);
      const testCount = Math.max(1, Math.round(indices.length * 0.1));
      shuffled.slice(0, testCount).forEach((i) => testIndexSet.add(i));
    });

    const trainData: any[] = [];
    const testData: any[] = [];
    conversionResult.data.forEach((record, idx) => {
      const payload = sanitizeRecordForDownload(record, previewMode);
      if (testIndexSet.has(idx)) {
        testData.push(payload);
      } else {
        trainData.push(payload);
      }
    });

    const zip = new JSZip();
    zip.file('train_dataset.json', JSON.stringify(trainData, null, 2));
    zip.file('test_dataset.json', JSON.stringify(testData, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${projectName.trim() || 'dataset'}_train_test.zip`);
    toast.success(`Downloaded zip with ${trainData.length} train and ${testData.length} test records.`);
  };

  const handleDownloadByScore = () => {
    if (!conversionResult?.data?.length) {
      toast.error('No data available to download.');
      return;
    }

    const qualifiedRows = rowsWithClusterGroups.filter((row) => {
      const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
      const overall = entry?.scores?.overall;
      return Number.isFinite(overall) && (overall || 0) >= downloadScoreThreshold;
    });

    if (!qualifiedRows.length) {
      toast.error(`Không tìm thấy mẫu nào có overall >= ${downloadScoreThreshold.toFixed(1)}.`);
      return;
    }

    const filteredData: any[] = [];
    if (previewMode === 'openai') {
      const selectedConversationIds = new Set(qualifiedRows.map((row) => row.blockId));
      const normalized = normalizeOpenAIConversations(conversionResult.data || []);
      normalized.forEach((conv, idx) => {
        if (selectedConversationIds.has(String(conv.conversation_id)) && conversionResult.data[idx]) {
          filteredData.push(sanitizeRecordForDownload(conversionResult.data[idx], previewMode));
        }
      });
    } else {
      const selectedRowIds = new Set(qualifiedRows.map((row) => row.id));
      allRows.forEach((row, idx) => {
        if (selectedRowIds.has(row.id) && conversionResult.data[idx]) {
          filteredData.push(sanitizeRecordForDownload(conversionResult.data[idx], previewMode));
        }
      });
    }

    if (!filteredData.length) {
      toast.error(`Không tìm thấy mẫu nào có overall >= ${downloadScoreThreshold.toFixed(1)}.`);
      return;
    }

    const thresholdLabel = downloadScoreThreshold.toFixed(1).replace('.', '_');
    const blob = new Blob([JSON.stringify(filteredData, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    saveAs(blob, `${projectName.trim() || 'dataset'}_overall_gte_${thresholdLabel}.json`);
    toast.success(`Downloaded ${filteredData.length} samples with overall >= ${downloadScoreThreshold.toFixed(1)}.`);
  };

  const handleToggleManualRow = (row: DisplayRow, checked: boolean) => {
    const metric1 = previewMode === 'openai' ? 'socratic' : 'accuracy';
    const metric2 = previewMode === 'openai' ? 'encouragement' : 'clarity';
    const metric3 = previewMode === 'openai' ? 'factuality' : 'completeness';
    if (checked) {
      setManualRowIds((prev) => new Set(prev).add(row.id));
      setEvaluationMap((prev) => {
        const existing = prev[row.id]?.scores;
        if (existing) {
          return { ...prev, [row.id]: { ...prev[row.id], evaluatedBy: 'manual' } };
        }
        const m1 = clampScore(0);
        const m2 = clampScore(0);
        const m3 = clampScore(0);
        return {
          ...prev,
          [row.id]: {
            scores: {
              [metric1]: m1,
              [metric2]: m2,
              [metric3]: m3,
              overall: calculateOverallFromThree(m1, m2, m3),
              reason: '',
            },
            evaluatedBy: 'manual',
          },
        };
      });
    } else {
      setManualRowIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleManualFieldChange = (row: DisplayRow, field: string, value: string) => {
    if (!manualRowIds.has(row.id)) return;
    const metric1 = previewMode === 'openai' ? 'socratic' : 'accuracy';
    const metric2 = previewMode === 'openai' ? 'encouragement' : 'clarity';
    const metric3 = previewMode === 'openai' ? 'factuality' : 'completeness';

    setEvaluationMap((prev) => {
      const existing = prev[row.id]?.scores || { overall: 0, reason: '' };
      const nextScores: EvaluationScores = { ...existing };
      if (field === 'reason') {
        nextScores.reason = value;
      } else {
        (nextScores as any)[field] = parseOptionalScore(value);
      }
      const v1 = clampScore((nextScores as any)[metric1] ?? 0);
      const v2 = clampScore((nextScores as any)[metric2] ?? 0);
      const v3 = clampScore((nextScores as any)[metric3] ?? 0);
      nextScores.overall = calculateOverallFromThree(v1, v2, v3);
      return { ...prev, [row.id]: { scores: nextScores, evaluatedBy: 'manual' } };
    });
  };

  const handleResetEvaluation = () => {
    setEvaluationMap({});
    setManualRowIds(new Set());
    setRefinementSelectedRowIds(new Set());
    setRefinedRowIds(new Set());
    toast.success('Evaluation results have been reset.');
  };

  const toggleClusterSelection = (groupId: number) => {
    setSelectedClusterIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  };

  useEffect(() => {
    const payload = (location.state as { loadProject?: LoadProjectPayload } | null)?.loadProject;
    if (!payload || loadHandledRef.current) {
      return;
    }

    const normalizedFormat: PreviewMode = payload.format === 'alpaca' ? 'alpaca' : 'openai';
    const safeData = Array.isArray(payload.data) ? payload.data : [];
    const safeEvaluationMap = payload.evaluationMap && typeof payload.evaluationMap === 'object'
      ? payload.evaluationMap
      : {};

    const restoredResult: ConversionResult = {
      data: safeData,
      format: normalizedFormat,
      output: JSON.stringify(safeData),
      filename: `${payload.projectName || 'reloaded_project'}.json`,
      stats: {
        totalConversations: safeData.length,
        totalMessages: normalizedFormat === 'openai'
          ? safeData.reduce((sum, item) => sum + (Array.isArray(item?.messages) ? item.messages.length : 0), 0)
          : safeData.length,
        totalTokensEstimate: 0,
      },
    };

    setConversionResult(restoredResult);
    setOriginalConvertedResult(restoredResult);
    setVisualizationResult(null);
    setEvaluationMap(safeEvaluationMap);
    setManualRowIds(new Set(
      Object.entries(safeEvaluationMap)
        .filter(([, value]) => value?.evaluatedBy === 'manual')
        .map(([key]) => key)
    ));
    setRefinedRowIds(new Set());
    setRefinementSelectedRowIds(new Set());
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setLoadedProjectFileId(payload.fileId || null);
    updateConversionOptions({ format: normalizedFormat });
    setProjectName(payload.projectName || formatDefaultProjectName());
    setCurrentStep(5);
    loadHandledRef.current = true;

    // Clear consumed router state to avoid accidental re-processing on future renders.
    navigate(location.pathname, { replace: true, state: null });

    toast.success('Project loaded. Continue evaluation at Step 5.');
  }, [location.pathname, location.state, navigate, setProjectName, updateConversionOptions]);

  useEffect(() => {
    const hasLoadProjectState = Boolean((location.state as { loadProject?: LoadProjectPayload } | null)?.loadProject);

    // Do not run reset flow while restoring project from history.
    if (hasLoadProjectState || loadHandledRef.current) {
      return;
    }

    setCurrentStep(1);
    setConversionResult(null);
    setOriginalConvertedResult(null);
    setVisualizationResult(null);
    setEvaluationMap({});
    setManualRowIds(new Set());
    setRefinedRowIds(new Set());
    setRefinementSelectedRowIds(new Set());
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setLoadedProjectFileId(null);
    loadHandledRef.current = false;
    if (uploadedFile?.fileId) setProjectName(formatDefaultProjectName());
    else setProjectName('');
  }, [location.state, setProjectName, uploadedFile?.fileId]);

  const canMoveFromStep2 = !!conversionResult;
  const canMoveFromStep3 = !!visualizationResult;
  const canMoveFromStep4 = clusterGroups.length > 0;
  const canMoveFromStep5 = !!conversionResult;
  const canMoveFromStep6 = !!conversionResult;

  const refinedHighlightMap = useMemo(() => {
    const map: Record<string, 'refined'> = {};
    refinedRowIds.forEach((id) => {
      map[id] = 'refined';
    });
    return map;
  }, [refinedRowIds]);

  const visibleRefinedRowsInStep6 = useMemo(
    () => visibleRowsInRefinement.filter((row) => refinedRowIds.has(row.id) || refinedRowIds.has(row.blockId)),
    [refinedRowIds, visibleRowsInRefinement]
  );

  const remapKeyAfterAlpacaDelete = (key: string, deletedIndex: number): string | null => {
    const match = /^alpaca-(\d+)$/.exec(key);
    if (!match) {
      return key;
    }
    const index = Number(match[1]);
    if (index === deletedIndex) {
      return null;
    }
    if (index > deletedIndex) {
      return `alpaca-${index - 1}`;
    }
    return key;
  };

  const remapRecordKeysAfterAlpacaDelete = <T,>(source: Record<string, T>, deletedIndex: number): Record<string, T> => {
    return Object.entries(source).reduce((acc, [key, value]) => {
      const nextKey = remapKeyAfterAlpacaDelete(key, deletedIndex);
      if (nextKey) {
        acc[nextKey] = value;
      }
      return acc;
    }, {} as Record<string, T>);
  };

  const remapSetKeysAfterAlpacaDelete = (source: Set<string>, deletedIndex: number): Set<string> => {
    const next = new Set<string>();
    source.forEach((key) => {
      const mapped = remapKeyAfterAlpacaDelete(key, deletedIndex);
      if (mapped) {
        next.add(mapped);
      }
    });
    return next;
  };

  const buildGroupsFromData = (data: any[], clusterMap: Record<string, number>): ClusterGroup[] => {
    const rows = buildDisplayRows(data, previewMode, conversionOptions.removeThinkTags ?? true);
    const counts = new Map<number, number>();
    rows.forEach((row) => {
      const groupId = clusterMap[row.id] ?? row.groupId;
      if (!Number.isFinite(groupId)) {
        return;
      }
      const id = Number(groupId);
      counts.set(id, (counts.get(id) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([groupId, count]) => ({ groupId, count, label: `Group ${groupId}` }));
  };

  const handleConfirmDeleteSample = () => {
    if (!conversionResult || !itemToDelete) {
      setItemToDelete(null);
      return;
    }

    let nextData = conversionResult.data || [];
    let nextEvaluationMap = { ...evaluationMap };
    let nextManualRowIds = new Set(manualRowIds);
    let nextRefinedRowIds = new Set(refinedRowIds);
    let nextRefinementSelectedRowIds = new Set(refinementSelectedRowIds);
    let nextRowClusterMap = { ...rowClusterMap };

    if (previewMode === 'openai') {
      const targetId = itemToDelete.blockId;
      if (Array.isArray(conversionResult.data?.[0]?.messages)) {
        const convs = normalizeOpenAIConversations(conversionResult.data || []);
        const removeIndex = convs.findIndex((conv) => String(conv.conversation_id) === targetId);
        if (removeIndex >= 0) {
          nextData = conversionResult.data.filter((_, idx) => idx !== removeIndex);
        }
      } else {
        nextData = (conversionResult.data || []).filter((item: any) => String(item?.conversation_id || '') !== targetId);
      }

      delete nextEvaluationMap[itemToDelete.id];
      delete nextEvaluationMap[itemToDelete.blockId];
      nextManualRowIds.delete(itemToDelete.id);
      nextManualRowIds.delete(itemToDelete.blockId);
      nextRefinedRowIds.delete(itemToDelete.id);
      nextRefinedRowIds.delete(itemToDelete.blockId);
      nextRefinementSelectedRowIds.delete(itemToDelete.id);
      nextRefinementSelectedRowIds.delete(itemToDelete.blockId);
      delete nextRowClusterMap[itemToDelete.id];
      delete nextRowClusterMap[itemToDelete.blockId];
    } else {
      const match = /^alpaca-(\d+)$/.exec(itemToDelete.id);
      const deleteIndex = match ? Number(match[1]) : -1;
      if (deleteIndex >= 0) {
        nextData = (conversionResult.data || []).filter((_, idx) => idx !== deleteIndex);
        nextEvaluationMap = remapRecordKeysAfterAlpacaDelete(nextEvaluationMap, deleteIndex);
        nextManualRowIds = remapSetKeysAfterAlpacaDelete(nextManualRowIds, deleteIndex);
        nextRefinedRowIds = remapSetKeysAfterAlpacaDelete(nextRefinedRowIds, deleteIndex);
        nextRefinementSelectedRowIds = remapSetKeysAfterAlpacaDelete(nextRefinementSelectedRowIds, deleteIndex);
        nextRowClusterMap = remapRecordKeysAfterAlpacaDelete(nextRowClusterMap, deleteIndex);
      }
    }

    const nextStats = {
      ...conversionResult.stats,
      totalConversations: nextData.length,
      totalMessages: previewMode === 'openai'
        ? normalizeOpenAIConversations(nextData).reduce((sum, conv) => sum + (Array.isArray(conv.messages) ? conv.messages.length : 0), 0)
        : nextData.length,
    };

    const nextGroups = buildGroupsFromData(nextData, nextRowClusterMap);

    setConversionResult({
      ...conversionResult,
      data: nextData,
      output: JSON.stringify(nextData),
      stats: nextStats,
    });
    setEvaluationMap(nextEvaluationMap);
    setManualRowIds(nextManualRowIds);
    setRefinedRowIds(nextRefinedRowIds);
    setRefinementSelectedRowIds(nextRefinementSelectedRowIds);
    setRowClusterMap(nextRowClusterMap);
    setClusterGroups(nextGroups);
    setSelectedClusterIds((prev) => prev.filter((id) => nextGroups.some((group) => group.groupId === id)));
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setItemToDelete(null);
    toast.success('Sample deleted successfully.');
  };

  return (
    <div className="space-y-6">
      <StepperHeader currentStep={currentStep} />

      {currentStep === 1 && (
        <div className="space-y-6">
          <FileUploader />
          {uploadedFile && (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <label htmlFor="projectName" className="block text-sm font-semibold text-gray-800">Project Name</label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={formatDefaultProjectName()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <FileStatisticsCard stats={stats} />
              <Preview />
              <ConversionOptions />
              <button
                onClick={() => convertMutation.mutate('initial')}
                disabled={convertMutation.isPending}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-xl shadow-lg shadow-primary-200 transition-all active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
              >
                {convertMutation.isPending ? <><Loader2 className="w-6 h-6 animate-spin" /><span>Processing Dataset...</span></> : <><Wand2 className="w-6 h-6" /><span>Convert Dataset</span></>}
              </button>
            </>
          )}
        </div>
      )}

      {currentStep === 2 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable rows={allRows} mode={previewMode} />
            </div>
            <div className="space-y-4 lg:col-span-1">
              <PostConversionSummary result={conversionResult} />
              <CleaningPipelineOptions onAccept={() => convertMutation.mutate('clean')} isLoading={convertMutation.isPending} />
              <button
                onClick={handleResetCleaning}
                disabled={!originalConvertedResult || convertMutation.isPending}
                className="px-4 py-2 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60 font-semibold text-gray-700"
              >
                Reset to Original
              </button>
            </div>
          </div>
          <StepNavigation showBack showNext onBack={() => setCurrentStep(1)} onNext={() => setCurrentStep(3)} nextDisabled={!canMoveFromStep2} />
        </div>
      )}

      {currentStep === 3 && (
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Step 3 - Visualization</h3>
                <p className="text-sm text-gray-600">Send dataset to GPU Service to compute Elbow &amp; K-Distance curves using semantic embeddings.</p>
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
                    onChange={(e) => setDbscanEps(parseFloat(e.target.value) || 0.15)}
                    className="w-20 px-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Min Samples:</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={dbscanMinSamples}
                    onChange={(e) => setDbscanMinSamples(parseInt(e.target.value, 10) || 6)}
                    className="w-16 px-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <button
                  onClick={handleVisualize}
                  disabled={isVisualizing || !conversionResult?.data?.length}
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

          <StepNavigation showBack showNext onBack={() => setCurrentStep(2)} onNext={() => setCurrentStep(4)} nextDisabled={!canMoveFromStep3} />
        </div>
      )}

      {currentStep === 4 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable rows={clusteredRows} mode={previewMode} />
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
                  onClick={() => clusterMutation.mutate()}
                  disabled={!conversionResult || clusterMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold transition-colors"
                >
                  {clusterMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Clustering...</span></> : <><Zap className="w-4 h-4" /><span>Cluster</span></>}
                </button>
              </div>

              {clusterGroups.length > 0 && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700">Similarity Threshold</label>
                    <span className="text-sm font-mono bg-white px-2 py-0.5 rounded border border-gray-200">{filterThreshold.toFixed(2)}</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.01" value={filterThreshold} onChange={(e) => setFilterThreshold(parseFloat(e.target.value))} className="w-full" />
                  <div className="flex gap-2">
                    <button onClick={() => filterMutation.mutate()} disabled={filterMutation.isPending} className="flex-1 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold">Filter Noise</button>
                    <button onClick={handleResetFiltering} disabled={filterMutation.isPending} className="px-4 py-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-semibold">Reset Filter</button>
                  </div>
                </div>
              )}

              {clusterGroups.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-900">Cluster Statistics</h3>
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
          <StepNavigation showBack showNext onBack={() => setCurrentStep(3)} onNext={() => setCurrentStep(5)} nextDisabled={!canMoveFromStep4} />
        </div>
      )}

      {currentStep === 5 && (
        <div className="space-y-5">
          <ConvertedDatasetTable
            rows={evaluationRows}
            mode={previewMode}
            showEvaluationColumns
            evaluationMap={evaluationMap}
            selectedManualRows={manualRowIds}
            onEvaluate={() => setIsEvaluateModalOpen(true)}
            onAccept={() => acceptMutation.mutate()}
            onReset={handleResetEvaluation}
            onToggleRow={handleToggleManualRow}
            onManualFieldChange={handleManualFieldChange}
            isEvaluating={evaluateMutation.isPending}
            disableEvaluate={!conversionResult || visibleRowsInEvaluation.length === 0}
            isAccepting={acceptMutation.isPending}
            onVisibleRowsChange={setVisibleRowsInEvaluation}
            onRequestDeleteRow={(row) => setItemToDelete(row)}
          />

          {averagedEvaluation && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
              <p className="font-semibold">Average scores ({averagedEvaluation.count} rows)</p>
              <p className="mt-1">
                {previewMode === 'openai'
                  ? `socratic: ${averagedEvaluation.socratic} | encouragement: ${averagedEvaluation.encouragement} | factuality: ${averagedEvaluation.factuality} | overall: ${averagedEvaluation.overall}`
                  : `accuracy: ${averagedEvaluation.accuracy} | clarity: ${averagedEvaluation.clarity} | completeness: ${averagedEvaluation.completeness} | overall: ${averagedEvaluation.overall}`}
              </p>
            </div>
          )}

          <StepNavigation showBack showNext onBack={() => setCurrentStep(4)} onNext={() => setCurrentStep(6)} nextDisabled={!canMoveFromStep5} />
        </div>
      )}

      {currentStep === 6 && (
        <div className="space-y-5">
          <ConvertedDatasetTable
            rows={evaluationRows}
            mode={previewMode}
            showEvaluationColumns
            showRowSelection={false}
            evaluationMap={evaluationMap}
            editableSelectedRows={false}
            rowHighlightMap={refinedHighlightMap}
            onEvaluate={() => setIsEvaluateModalOpen(true)}
            onAccept={() => acceptMutation.mutate()}
            onReset={handleResetEvaluation}
            extraActions={
              <button
                onClick={() => setIsRefineModalOpen(true)}
                disabled={refineMutation.isPending}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white text-xs font-semibold"
              >
                {refineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Refine data</span>
              </button>
            }
            isEvaluating={evaluateMutation.isPending}
            disableEvaluate={!conversionResult || visibleRefinedRowsInStep6.length === 0}
            isAccepting={acceptMutation.isPending}
            onVisibleRowsChange={setVisibleRowsInRefinement}
            onRequestDeleteRow={(row) => setItemToDelete(row)}
          />

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            Rows refined successfully are highlighted with a light-blue background. Their previous scores are preserved until you re-evaluate selected rows.
          </div>

          <StepNavigation showBack showNext onBack={() => setCurrentStep(5)} onNext={() => setCurrentStep(7)} nextDisabled={!canMoveFromStep6} />
        </div>
      )}

      {currentStep === 7 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable rows={evaluationRows} mode={previewMode} showEvaluationColumns showEvaluationActions={false} evaluationMap={evaluationMap} />
            </div>
            <div className="space-y-4 lg:col-span-1">
              <button
                onClick={handleDownloadTrainTestZip}
                disabled={!conversionResult || clusterGroups.length === 0}
                className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-4 px-6 rounded-xl shadow-md"
              >
                <Download className="w-5 h-5" />
                <span>Download train/test zip</span>
              </button>

              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">Download Filter by Overall Score</p>
                  <span className="text-sm font-mono bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-gray-700">
                    {downloadScoreThreshold.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={downloadScoreThreshold}
                  onChange={(e) => setDownloadScoreThreshold(parseFloat(e.target.value))}
                  className="w-full"
                />
                <button
                  onClick={handleDownloadByScore}
                  disabled={!conversionResult}
                  className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  <span>Download overall &gt;= filter</span>
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 flex gap-2">
                <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>Upload final dataset to Hugging Face after validating the split files.</p>
              </div>

              {uploadedFile && conversionResult && <HuggingFaceUpload conversionResult={conversionResult} />}
            </div>
          </div>

          <StepNavigation showBack onBack={() => setCurrentStep(6)} />
        </div>
      )}

      <EvaluateModal
        isOpen={isEvaluateModalOpen}
        provider={evaluateProvider}
        onProviderChange={setEvaluateProvider}
        onClose={() => setIsEvaluateModalOpen(false)}
        onConfirm={() => {
          const sourceRows = currentStep === 6 ? visibleRefinedRowsInStep6 : visibleRowsInEvaluation;
          if (sourceRows.length === 0) {
            toast.error('No highlighted refined rows on this page to evaluate.');
            return;
          }
          evaluateMutation.mutate({
            provider: evaluateProvider,
            rows: sourceRows,
            excludeManualEvaluated: true,
          });
          setIsEvaluateModalOpen(false);
        }}
        isSubmitting={evaluateMutation.isPending}
      />

      <RefineModal
        isOpen={isRefineModalOpen}
        provider={refineProvider}
        scoreThreshold={refineScoreThreshold}
        onProviderChange={setRefineProvider}
        onScoreThresholdChange={setRefineScoreThreshold}
        onClose={() => setIsRefineModalOpen(false)}
        onConfirm={() => {
          refineMutation.mutate({
            provider: refineProvider,
            rows: visibleRowsInRefinement,
            scoreThreshold: refineScoreThreshold,
          });
          setIsRefineModalOpen(false);
        }}
        isSubmitting={refineMutation.isPending}
      />

      <DeleteConfirmModal
        isOpen={Boolean(itemToDelete)}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleConfirmDeleteSample}
      />
    </div>
  );
}
