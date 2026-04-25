import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Columns,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Wand2,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileUploader } from '../features/dataprep/upload/FileUploader';
import { ConversionOptions } from '../features/dataprep/upload/ConversionOptions';
import { Preview } from '../features/dataprep/upload/Preview';
import { ScoreHistoryModal, type ScoreHistoryEntry } from '../components/ScoreHistoryModal';
import { StepNavigation } from '../components/StepNavigation';
import { DataLabelingPanel } from '../features/dataprep/components/DataLabelingPanel';
import { dataprepApi } from '../features/dataprep/api/dataprepApi';
import { EvaluationPanel } from '../features/dataprep/evaluation/EvaluationPanel';
import { RefinementPanel } from '../features/dataprep/evaluation/RefinementPanel';
import { AutoLabelingPanel } from '../features/dataprep/labeling/AutoLabelingPanel';
import { LabelingWorkflowPanel } from '../features/dataprep/labeling/LabelingWorkflowPanel';
import { ClusterPanel } from '../features/dataprep/preprocessing/ClusterPanel';
import { CleaningPipelineOptions } from '../features/dataprep/preprocessing/CleaningPipelineOptions';
import { PostConversionSummary } from '../features/dataprep/preprocessing/PostConversionSummary';
import { VisualizationPanel, type VisualizationResult } from '../features/dataprep/preprocessing/VisualizationPanel';
import { SystemPromptStepPanel } from '../features/dataprep/prompt/SystemPromptStepPanel';
import { useAppStore } from '../hooks/useAppStore';
import { apiService } from '../services/api';
import type { ConversionResult } from '../types';
import { useAuthStore } from '../store/authStore';
import { ExportPanel } from '../features/dataprep/export/ExportPanel';
import type { AutoLabelSuggestion, SubjectAutoLabel } from '../services/api';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
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
};

type EvaluatedBy = 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';

type EvaluationRecord = {
  evaluatedBy: EvaluatedBy;
  scores: EvaluationScores;
  reason: string;
  timestamp: string;
};

type RowEvaluationEntry = {
  evaluations: EvaluationRecord[];
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
  fileId?: string;
  projectName: string;
  format: 'openai' | 'alpaca';
  data: any[];
  evaluationMap: Record<string, RowEvaluationEntry>;
  datasetVersionId?: string;
  sampleIdMap?: Record<string, string>;
  ownerId?: string;
  startStep?: Step;
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  return parsed.toFixed(2);
}

function calculateOverallFromThree(a: number, b: number, c: number): number {
  return Math.round(((a + b + c) / 3) * 10) / 10;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function resolveEvaluationKey(row: DisplayRow): string {
  return row.blockId || row.id;
}

function toIsoTimestamp(value?: string): string {
  const raw = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(raw)) {
    return new Date().toISOString();
  }
  return new Date(raw).toISOString();
}

function normalizeEvaluationEntry(raw: any): RowEvaluationEntry {
  if (Array.isArray(raw?.evaluations)) {
    const evaluations = raw.evaluations.map((item: any) => ({
      evaluatedBy: (item?.evaluatedBy || 'none') as EvaluatedBy,
      scores: {
        accuracy: normalizeNullableNumber(item?.scores?.accuracy),
        clarity: normalizeNullableNumber(item?.scores?.clarity),
        completeness: normalizeNullableNumber(item?.scores?.completeness),
        socratic: normalizeNullableNumber(item?.scores?.socratic),
        encouragement: normalizeNullableNumber(item?.scores?.encouragement),
        factuality: normalizeNullableNumber(item?.scores?.factuality),
        overall: normalizeNullableNumber(item?.scores?.overall),
      },
      reason: String(item?.reason || ''),
      timestamp: toIsoTimestamp(item?.timestamp),
    }));

    return { evaluations };
  }

  if (raw?.scores) {
    return {
      evaluations: [
        {
          evaluatedBy: (raw.evaluatedBy || 'none') as EvaluatedBy,
          scores: {
            accuracy: normalizeNullableNumber(raw.scores.accuracy),
            clarity: normalizeNullableNumber(raw.scores.clarity),
            completeness: normalizeNullableNumber(raw.scores.completeness),
            socratic: normalizeNullableNumber(raw.scores.socratic),
            encouragement: normalizeNullableNumber(raw.scores.encouragement),
            factuality: normalizeNullableNumber(raw.scores.factuality),
            overall: normalizeNullableNumber(raw.scores.overall),
          },
          reason: String(raw.scores.reason || ''),
          timestamp: toIsoTimestamp(raw.timestamp),
        },
      ],
    };
  }

  return { evaluations: [] };
}

function getLatestEvaluation(entry?: RowEvaluationEntry): EvaluationRecord | null {
  if (!entry?.evaluations?.length) {
    return null;
  }
  return [...entry.evaluations].sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return ta - tb;
  })[entry.evaluations.length - 1] || null;
}

function getEvaluatedBySummary(entry?: RowEvaluationEntry): string {
  if (!entry?.evaluations?.length) {
    return '';
  }

  const providers = entry.evaluations
    .map((item) => String(item?.evaluatedBy || '').trim())
    .filter((provider) => provider && provider !== 'none');

  if (!providers.length) {
    return 'none';
  }

  return Array.from(new Set(providers)).join(', ');
}

function getAveragedScores(entry: RowEvaluationEntry | undefined, mode: PreviewMode): EvaluationScores | null {
  const evaluations = entry?.evaluations || [];
  if (!evaluations.length) {
    return null;
  }

  const count = evaluations.length;
  const sum = evaluations.reduce(
    (acc, item) => ({
      accuracy: acc.accuracy + (Number(item.scores.accuracy) || 0),
      clarity: acc.clarity + (Number(item.scores.clarity) || 0),
      completeness: acc.completeness + (Number(item.scores.completeness) || 0),
      socratic: acc.socratic + (Number(item.scores.socratic) || 0),
      encouragement: acc.encouragement + (Number(item.scores.encouragement) || 0),
      factuality: acc.factuality + (Number(item.scores.factuality) || 0),
      overall: acc.overall + (Number(item.scores.overall) || 0),
    }),
    {
      accuracy: 0,
      clarity: 0,
      completeness: 0,
      socratic: 0,
      encouragement: 0,
      factuality: 0,
      overall: 0,
    }
  );

  const avg = {
    accuracy: sum.accuracy / count,
    clarity: sum.clarity / count,
    completeness: sum.completeness / count,
    socratic: sum.socratic / count,
    encouragement: sum.encouragement / count,
    factuality: sum.factuality / count,
    overall: sum.overall / count,
  };

  return {
    accuracy: mode === 'alpaca' ? avg.accuracy : null,
    clarity: mode === 'alpaca' ? avg.clarity : null,
    completeness: mode === 'alpaca' ? avg.completeness : null,
    socratic: mode === 'openai' ? avg.socratic : null,
    encouragement: mode === 'openai' ? avg.encouragement : null,
    factuality: mode === 'openai' ? avg.factuality : null,
    overall: avg.overall,
  };
}

function isMongoObjectId(value: string): boolean {
  return /^[a-f\d]{24}$/i.test(String(value || ''));
}

function mergeEvaluationUpdates(
  base: Record<string, RowEvaluationEntry>,
  updates: Record<string, EvaluationRecord>
): Record<string, RowEvaluationEntry> {
  const merged = { ...base };

  Object.entries(updates).forEach(([key, evaluation]) => {
    const normalized = normalizeEvaluationEntry(merged[key]);
    merged[key] = {
      evaluations: [...normalized.evaluations, evaluation],
    };
  });

  return merged;
}

function formatDefaultProjectName(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `Project_${dd}/${mm}_${hh}:${min}`;
}

type MainPipelineStage = {
  id: 'upload' | 'preprocessing' | 'labeling' | 'evaluation' | 'finish';
  label: string;
  steps: Step[];
};

const MAIN_PIPELINE_STAGES: MainPipelineStage[] = [
  { id: 'upload', label: 'Upload & Convert', steps: [1] },
  { id: 'preprocessing', label: 'Preprocessing', steps: [2, 3, 4] },
  { id: 'labeling', label: 'Labeling', steps: [5, 6] },
  { id: 'evaluation', label: 'Evaluation', steps: [7, 8] },
  { id: 'finish', label: 'Finish', steps: [9, 10] },
];

const SUBSTEP_PIPELINE: Array<{ id: Step; label: string; group: string }> = [
  { id: 2, label: 'Clean', group: 'Preprocessing' },
  { id: 3, label: 'Find K', group: 'Preprocessing' },
  { id: 4, label: 'K-means Cluster', group: 'Preprocessing' },
  { id: 5, label: 'Auto Labeling', group: 'Labeling' },
  { id: 6, label: 'Labeling', group: 'Labeling' },
  { id: 7, label: 'Evaluation', group: 'Evaluation' },
  { id: 8, label: 'Refine', group: 'Evaluation' },
  { id: 9, label: 'System Prompt', group: 'Finish' },
  { id: 10, label: 'Train/Test Export', group: 'Finish' },
];

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

function sanitizeRecordForDownload(record: any, mode: PreviewMode, systemPromptText?: string): any {
  const trimmedSystemPrompt = String(systemPromptText || '').trim();

  if (mode === 'openai') {
    const messages = Array.isArray(record?.messages) ? record.messages : [];
    const normalizedMessages = messages.map((msg: any) => ({
      role: String(msg?.role || ''),
      content: String(msg?.content || ''),
    }));

    return {
      messages: trimmedSystemPrompt
        ? [{ role: 'system', content: trimmedSystemPrompt }, ...normalizedMessages]
        : normalizedMessages,
    };
  }

  return {
    instruction: String(record?.instruction ?? record?.query ?? ''),
    input: String(record?.input ?? record?.context ?? ''),
    output: String(record?.output ?? record?.answer ?? record?.response ?? ''),
  };
}

function injectSystemPromptIntoConversation(record: any, selectedPromptContent?: string): any {
  const normalizedMessages = Array.isArray(record?.messages)
    ? record.messages.map((msg: any) => ({
      role: String(msg?.role || ''),
      content: String(msg?.content || ''),
    }))
    : [];

  const trimmedPrompt = String(selectedPromptContent || '').trim();
  if (!trimmedPrompt) {
    return {
      ...record,
      messages: normalizedMessages,
    };
  }

  const firstSystemIndex = normalizedMessages.findIndex((msg: { role: string; content: string }) => msg.role === 'system');
  const nextMessages = [...normalizedMessages];

  if (firstSystemIndex >= 0) {
    nextMessages[firstSystemIndex] = {
      ...nextMessages[firstSystemIndex],
      content: trimmedPrompt,
    };
  } else {
    nextMessages.unshift({ role: 'system', content: trimmedPrompt });
  }

  return {
    ...record,
    messages: nextMessages,
  };
}

const METRIC_TOOLTIPS: Record<string, string> = {
  socratic:
    'TÍNH SƯ PHẠM: - Điểm tối đa (9-10) ̣nếu AI không đưa ra đáp án trực tiếp xuyên suốt cả cuộc hội thoại, chỉ đưa ra công thức và dùng câu hỏi gợi mở hoặc ví dụ tương tự.\n- Điểm 5-8 :Có lời chào hỏi, có dẫn dắt nhưng gợi ý quá lộ liễu (gần như cho đáp án).\n- ĐIỂM 0-4 nếu AI đưa ra đáp án đúng nhưng quá sớm (Premature Disclosure) hoặc giải hộ bài ở bất kỳ lượt nào.\n',
  encouragement:
    "TÍNH KHÍCH LỆ (encouragement):\n- Điểm tối đa (9-10): AI sử dụng ngôn ngữ tích cực, công nhận nỗ lực của người dùng. Tông giọng ấm áp, thân thiện và giàu năng lượng.\n- Điểm trung bình (5-8): Có khen ngợi nhưng còn rập khuôn hoặc khen không đúng lúc. Tông giọng trung tính.\n- ĐIỂM 0: AI phản hồi cụt lủn, máy móc, hoặc tệ hơn là có thái độ gây nản lòng (ví dụ: \"Sai rồi, làm lại đi\").",
  factuality:
    'ĐỘ CHÍNH XÁC KIẾN THỨC: - Điểm tối đa (9-10) nếu mọi kiến thức, công thức và logic toán học/khoa học đều đúng trong toàn bộ cuộc hội thoại.\n- Điểm 5-8: Có sai sót nhỏ nhưng không ảnh hưởng đến kết quả cuối cùng.\n- ĐIỂM 0-4 nếu AI cung cấp thông tin sai lệch,lỗi định dạng, sai công thức, tính toán sai ở bất kỳ lượt nào.',
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
    const rowId = String(item?.id ?? item?.sampleId ?? `alpaca-${index}`);

    return {
      id: rowId,
      blockId: rowId,
      blockLabel: item?.id ? String(item.id) : `Record ${index + 1}`,
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

function StepperHeader({ currentStep, lockedToStep }: { currentStep: Step; lockedToStep?: Step | null }) {
  const activeMainStage = MAIN_PIPELINE_STAGES.find((stage) => stage.steps.includes(currentStep));
  const visibleSubsteps = activeMainStage
    ? SUBSTEP_PIPELINE.filter((step) => activeMainStage.steps.includes(step.id))
    : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {MAIN_PIPELINE_STAGES.map((stage, index) => {
          const stageStart = stage.steps[0];
          const stageEnd = stage.steps[stage.steps.length - 1];
          const isActive = stage.id === activeMainStage?.id;
          const isCompleted = currentStep > stageEnd;
          const isLocked = Boolean(lockedToStep && !stage.steps.includes(lockedToStep));

          return (
            <div key={stage.id} className="relative">
              {index > 0 && <div className="absolute -left-2 top-1/2 hidden h-px w-2 bg-slate-200 lg:block" />}
              <div
                className={`flex min-h-[58px] items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${isLocked
                  ? 'border-slate-200 bg-white opacity-60'
                  : isActive
                    ? 'border-sky-400 bg-sky-50 text-sky-950'
                    : isCompleted
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                      : 'border-slate-300 bg-white text-slate-800'
                  }`}
              >
                <div
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border text-xs font-bold ${isLocked
                    ? 'border-slate-300 bg-slate-100 text-slate-500'
                    : isCompleted
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : isActive
                        ? 'border-sky-700 bg-sky-700 text-white'
                        : 'border-slate-400 bg-white text-slate-600'
                    }`}
                >
                  {isLocked ? <ShieldCheck className="h-4 w-4" /> : isCompleted ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Stage {index + 1}</p>
                  <p className="truncate text-sm font-bold leading-tight">{stage.label}</p>
                  <p className="text-[11px] text-slate-500">
                    Step {stageStart}{stageEnd !== stageStart ? `-${stageEnd}` : ''}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {visibleSubsteps.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="mx-auto flex max-w-3xl items-start justify-center">
            {visibleSubsteps.map((step) => {
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;
              const isLocked = Boolean(lockedToStep && step.id !== lockedToStep);

              return (
                <div key={step.id} className="flex flex-1 items-start">
                  <div className="flex min-w-[84px] flex-col items-center">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${isLocked
                        ? 'border-slate-300 bg-white text-slate-400 opacity-60'
                        : isActive
                          ? 'border-slate-700 bg-sky-200 text-slate-900 shadow-sm'
                          : isCompleted
                            ? 'border-emerald-500 bg-emerald-100 text-emerald-900'
                            : 'border-slate-500 bg-sky-100 text-slate-800'
                        }`}
                    >
                      {visibleSubsteps.findIndex((item) => item.id === step.id) + 1}
                    </div>
                    <p className="mt-2 text-center text-xs font-medium leading-tight text-slate-800">{step.label}</p>
                  </div>
                  {visibleSubsteps[visibleSubsteps.length - 1].id !== step.id && (
                    <div className="mt-[21px] h-0.5 flex-1 bg-blue-800" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
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
      description="Choose a model to evaluate all visible rows on the current page."
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

function AutoLabelModal({
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
      title="Label with AI"
      description="Choose a model to assign one subject label to each cluster."
      confirmText="Confirm Auto Labeling"
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
  scoreThresholdInput,
  scoreThresholdError,
  onProviderChange,
  onScoreThresholdInputChange,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  isOpen: boolean;
  provider: AiProvider;
  scoreThresholdInput: string;
  scoreThresholdError?: string;
  onProviderChange: (provider: AiProvider) => void;
  onScoreThresholdInputChange: (value: string) => void;
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
          type="text"
          inputMode="decimal"
          value={scoreThresholdInput}
          onChange={(e) => onScoreThresholdInputChange(e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 ${scoreThresholdError
            ? 'border-red-400 focus:ring-red-200'
            : 'border-gray-300 focus:ring-indigo-200'
            }`}
        />
        <p
          className={`mt-1 min-h-[20px] text-xs font-medium ${scoreThresholdError ? 'text-red-600' : 'text-transparent'}`}
          aria-live="polite"
        >
          {scoreThresholdError || ''}
        </p>
      </div>
    </ActionModalFrame>
  );
}

function ManualEvaluateModal({
  isOpen,
  mode,
  metricA,
  metricB,
  metricC,
  reason,
  isSubmitting,
  onChange,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  mode: PreviewMode;
  metricA: string;
  metricB: string;
  metricC: string;
  reason: string;
  isSubmitting?: boolean;
  onChange: (field: 'metricA' | 'metricB' | 'metricC' | 'reason', value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const labelA = mode === 'openai' ? 'socratic' : 'accuracy';
  const labelB = mode === 'openai' ? 'encouragement' : 'clarity';
  const labelC = mode === 'openai' ? 'factuality' : 'completeness';

  return (
    <ActionModalFrame
      isOpen={isOpen}
      title="Add evaluate by manual"
      description="Fill in the evaluation metrics and reason."
      confirmText="Save Evaluation"
      isSubmitting={isSubmitting}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{labelA}</label>
          <input
            type="number"
            min={0}
            max={10}
            step="any"
            value={metricA}
            onChange={(e) => onChange('metricA', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{labelB}</label>
          <input
            type="number"
            min={0}
            max={10}
            step="any"
            value={metricB}
            onChange={(e) => onChange('metricB', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{labelC}</label>
          <input
            type="number"
            min={0}
            max={10}
            step="any"
            value={metricC}
            onChange={(e) => onChange('metricC', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">reason</label>
        <textarea
          value={reason}
          onChange={(e) => onChange('reason', e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          placeholder="Nhap ly do danh gia"
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
  evaluationMap,
  rowHighlightMap,
  onEvaluate,
  onReset,
  extraActions,
  isEvaluating,
  disableEvaluate,
  onVisibleRowsChange,
  onRequestViewHistory,
  onRequestManualEvaluate,
  onRequestDeleteRow,
  refineHistoryMap,
  onRequestViewRefineChange,
  isFinishPreview = false,
  systemPromptText,
}: {
  rows: DisplayRow[];
  mode: PreviewMode;
  showEvaluationColumns?: boolean;
  showEvaluationActions?: boolean;
  evaluationMap?: Record<string, RowEvaluationEntry>;
  rowHighlightMap?: Record<string, 'refined'>;
  onEvaluate?: () => void;
  onReset?: () => void;
  extraActions?: any;
  isEvaluating?: boolean;
  disableEvaluate?: boolean;
  onVisibleRowsChange?: (rows: DisplayRow[]) => void;
  onRequestViewHistory?: (row: DisplayRow) => void;
  onRequestManualEvaluate?: (row: DisplayRow) => void;
  onRequestDeleteRow?: (row: DisplayRow) => void;
  refineHistoryMap?: Record<string, { original: string; refined: string }>;
  onRequestViewRefineChange?: (row: DisplayRow) => void;
  isFinishPreview?: boolean;
  systemPromptText?: string;
}) {
  const PAGE_SIZE_STEPS = [5, 10, 20, 100, 250, 500];
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_STEPS[0]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [detailModal, setDetailModal] = useState<{ title: string; content: string } | null>(null);
  const [openActionMenuKey, setOpenActionMenuKey] = useState<string | null>(null);
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
  const showRefineComparisonAction = Boolean(onRequestViewRefineChange);
  const showActionMenu = Boolean(showDeleteAction || onRequestManualEvaluate || onRequestViewHistory);
  const showSystemColumn = isFinishPreview;
  const hideOpenAIMetricBreakdown = Boolean(isFinishPreview && mode === 'openai');
  const scoreColumnCount = showEvaluationColumns
    ? (hideOpenAIMetricBreakdown ? 1 : 4) + 2
    : 0;
  const emptyColSpan = 3 + (showSystemColumn ? 1 : 0) + scoreColumnCount + (showActionMenu ? 1 : 0);
  const metricA = mode === 'openai' ? 'socratic' : 'accuracy';
  const metricB = mode === 'openai' ? 'encouragement' : 'clarity';
  const metricC = mode === 'openai' ? 'factuality' : 'completeness';

  const renderMetricHeader = (metric: 'socratic' | 'encouragement' | 'factuality' | 'accuracy' | 'clarity' | 'completeness') => (
    <span className="relative inline-flex items-center group cursor-help">
      {metric}
      <span className="absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-md border border-gray-200 bg-white p-2 text-xs font-normal text-gray-700 shadow-lg group-hover:block">
        {METRIC_TOOLTIPS[metric]}
      </span>
    </span>
  );

  const renderActionMenuCell = (row: DisplayRow, rowSpan?: number) => {
    if (!showActionMenu) {
      return null;
    }

    const rowKey = resolveEvaluationKey(row);
    const isOpen = openActionMenuKey === rowKey;
    const hasRefineHistory = Boolean(refineHistoryMap?.[row.id] || refineHistoryMap?.[row.blockId]);

    return (
      <td className="px-2 py-3 align-bottom" rowSpan={rowSpan}>
        <div className="relative flex h-full items-end justify-end">
          <button
            type="button"
            onClick={() => setOpenActionMenuKey((prev) => (prev === rowKey ? null : rowKey))}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            title="Actions"
            aria-label="Actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {isOpen && (
            <div className="absolute bottom-full right-4 mb-1 z-20 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg origin-bottom-right">
              {onRequestViewHistory && (
                <button
                  type="button"
                  onClick={() => {
                    onRequestViewHistory(row);
                    setOpenActionMenuKey(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>All evaluate mark</span>
                </button>
              )}
              {onRequestManualEvaluate && (
                <button
                  type="button"
                  onClick={() => {
                    onRequestManualEvaluate(row);
                    setOpenActionMenuKey(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Evaluate manual</span>
                </button>
              )}
              {showRefineComparisonAction && hasRefineHistory && (
                <button
                  type="button"
                  onClick={() => {
                    onRequestViewRefineChange?.(row);
                    setOpenActionMenuKey(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Columns className="h-3.5 w-3.5" />
                  <span>Compare Refine</span>
                </button>
              )}
              {showDeleteAction && (
                <button
                  type="button"
                  onClick={() => {
                    onRequestDeleteRow?.(row);
                    setOpenActionMenuKey(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete </span>
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    );
  };

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

              {onReset && (
                <button
                  onClick={onReset}
                  disabled={!hasRows}
                  className="px-4 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[680px]">
        <table className="min-w-full text-sm table-fixed">
          <colgroup>
            {showSystemColumn && <col className="w-[16%]" />}
            <col className="w-[30%]" />
            <col className="w-[20%]" />
            <col className="w-[40%]" />
            {showEvaluationColumns && !hideOpenAIMetricBreakdown && <col className="w-[88px]" />}
            {showEvaluationColumns && !hideOpenAIMetricBreakdown && <col className="w-[88px]" />}
            {showEvaluationColumns && !hideOpenAIMetricBreakdown && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="w-[88px]" />}
            {showEvaluationColumns && <col className="min-w-[280px]" />}
            {showEvaluationColumns && <col className="w-[120px]" />}
            {showActionMenu && <col className="w-[64px]" />}
          </colgroup>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {showSystemColumn && <th className="text-left px-4 py-3 font-semibold text-gray-700">System</th>}
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
                  {!hideOpenAIMetricBreakdown && (
                    <>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricA)}</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricB)}</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricC)}</th>
                    </>
                  )}
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">overall</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-[280px]">reason</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">evaluated by</th>
                  {showActionMenu && <th className="px-2 py-3" />}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? (
              showEvaluationColumns && mode === 'openai'
                ? visibleRows.flatMap((row, index) => {
                  const key = resolveEvaluationKey(row);
                  const entry = normalizeEvaluationEntry(evaluationMap?.[key] || evaluationMap?.[row.id]);
                  const averagedScores = getAveragedScores(entry, mode);
                  const latestEvaluation = getLatestEvaluation(entry);
                  const evaluatedBySummary = getEvaluatedBySummary(entry);

                  const pairs = row.conversationPairs && row.conversationPairs.length > 0
                    ? row.conversationPairs
                    : [{ user: row.userText || '-', assistant: row.assistantText || '-' }];

                  return pairs.map((pair, pairIndex) => (
                    <tr
                      key={`${row.id}-${pairIndex}`}
                      className={`align-top ${pairIndex === pairs.length - 1
                        ? 'border-b-4 border-b-gray-200'
                        : 'border-b border-b-gray-100'
                        } ${index === 0 && pairIndex === 0 ? 'border-t border-t-gray-100' : ''}
                        } ${(rowHighlightMap?.[row.id] || rowHighlightMap?.[row.blockId]) === 'refined' ? 'bg-sky-50' : ''
                        }`}
                    >
                      {showSystemColumn && pairIndex === 0 && (
                        <td className="px-4 py-3 align-top" rowSpan={pairs.length}>
                          <p className="whitespace-pre-wrap break-words line-clamp-3 text-gray-700">
                            {systemPromptText?.trim() || '-'}
                          </p>
                        </td>
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
                          {!hideOpenAIMetricBreakdown && (
                            <>
                              <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                                {formatTableScore(averagedScores?.socratic)}
                              </td>
                              <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                                {formatTableScore(averagedScores?.encouragement)}
                              </td>
                              <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                                {formatTableScore(averagedScores?.factuality)}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3 text-gray-700 font-semibold align-top" rowSpan={pairs.length}>{formatTableScore(averagedScores?.overall)}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words align-top" rowSpan={pairs.length}>
                            {latestEvaluation?.reason ?? ''}
                          </td>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {evaluatedBySummary || latestEvaluation?.evaluatedBy || ''}
                          </td>
                          {renderActionMenuCell(row, pairs.length)}
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
                        {showSystemColumn && (
                          <td className="px-4 py-3 align-top">
                            <p className="whitespace-pre-wrap break-words line-clamp-3 text-gray-700">
                              {systemPromptText?.trim() || '-'}
                            </p>
                          </td>
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
                      </tr>
                    ));
                  })
                  : visibleRows.map((row, index) => {
                    const key = resolveEvaluationKey(row);
                    const entry = normalizeEvaluationEntry(evaluationMap?.[key] || evaluationMap?.[row.id]);
                    const averagedScores = getAveragedScores(entry, mode);
                    const latestEvaluation = getLatestEvaluation(entry);
                    const evaluatedBySummary = getEvaluatedBySummary(entry);

                    return (
                      <tr
                        key={row.id}
                        className={`align-top ${row.isBlockLast ? 'border-b-4 border-b-gray-200' : 'border-b border-b-gray-100'
                          } ${index === 0 ? 'border-t border-t-gray-100' : ''} ${(rowHighlightMap?.[row.id] || rowHighlightMap?.[row.blockId]) === 'refined' ? 'bg-sky-50' : ''}`}
                      >
                        {showSystemColumn && (
                          <td className="px-4 py-3 align-top">
                            <p className="whitespace-pre-wrap break-words line-clamp-3 text-gray-700">
                              {systemPromptText?.trim() || '-'}
                            </p>
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
                            {!hideOpenAIMetricBreakdown && (
                              <>
                                <td className="px-4 py-3 text-gray-700">{formatTableScore(averagedScores?.accuracy)}</td>
                                <td className="px-4 py-3 text-gray-700">{formatTableScore(averagedScores?.clarity)}</td>
                                <td className="px-4 py-3 text-gray-700">{formatTableScore(averagedScores?.completeness)}</td>
                              </>
                            )}
                            <td className="px-4 py-3 text-gray-700 font-semibold">{formatTableScore(averagedScores?.overall)}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words">
                              {latestEvaluation?.reason ?? ''}
                            </td>
                            <td className="px-4 py-3 text-gray-700">{evaluatedBySummary || latestEvaluation?.evaluatedBy || ''}</td>
                            {renderActionMenuCell(row)}
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

function RefineComparisonModal({
  isOpen,
  title,
  original,
  refined,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  original: string;
  refined: string;
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
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-7xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h4 className="text-base font-semibold text-slate-900">{title}</h4>
            <p className="text-sm text-slate-600">Compare the content before and after refining.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="grid max-h-[72vh] grid-cols-1 gap-4 overflow-auto p-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">Before refine</div>
            <div className="max-h-[60vh] overflow-auto px-4 py-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{original || '-'}</p>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50">
            <div className="border-b border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-800">After refine</div>
            <div className="max-h-[60vh] overflow-auto px-4 py-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{refined || '-'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareGroupSlot({
  title,
  selectedGroupId,
  otherSelectedGroupId,
  clusterGroups,
  rows,
  onSelectGroup,
  onRemoveGroup,
}: {
  title: string;
  selectedGroupId: number | null;
  otherSelectedGroupId: number | null;
  clusterGroups: ClusterGroup[];
  rows: DisplayRow[];
  onSelectGroup: (groupId: number) => void;
  onRemoveGroup: () => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (selectedGroupId !== null) {
      setIsMenuOpen(false);
    }
  }, [selectedGroupId]);

  const selectableGroups = useMemo(
    () => clusterGroups.filter((group) => group.groupId !== otherSelectedGroupId),
    [clusterGroups, otherSelectedGroupId]
  );

  const selectedGroup = clusterGroups.find((group) => group.groupId === selectedGroupId) || null;
  const selectedRows = useMemo(
    () => rows.filter((row) => row.groupId === selectedGroupId),
    [rows, selectedGroupId]
  );

  if (selectedGroupId === null || !selectedGroup) {
    return (
      <div className="h-full rounded-2xl border-2 border-dashed border-slate-300 bg-white/85 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">Empty slot</p>
        </div>

        <div className="relative flex h-[calc(100%-2rem)] items-center justify-center rounded-xl bg-slate-50">
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="inline-flex h-24 w-24 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
            title="Select Group"
          >
            <Plus className="h-12 w-12" />
          </button>

          {isMenuOpen && (
            <div className="absolute left-1/2 top-[58%] z-20 w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Select Group</p>
              <div className="max-h-56 overflow-auto">
                {selectableGroups.length > 0 ? (
                  selectableGroups.map((group) => (
                    <button
                      key={group.groupId}
                      type="button"
                      onClick={() => onSelectGroup(group.groupId)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                    >
                      <span>Group {group.groupId}</span>
                      <span className="text-xs text-slate-500">{group.count} rows</span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-slate-500">No available groups.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Group {selectedGroup.groupId}</p>
          <p className="text-xs text-slate-500">{selectedRows.length} rows</p>
        </div>
        <button
          type="button"
          onClick={onRemoveGroup}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          title="Remove group"
          aria-label="Remove group"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[22%]" />
            <col className="w-[44%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">User</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">&lt;think&gt;</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Assistant</th>
            </tr>
          </thead>
          <tbody>
            {selectedRows.length > 0 ? (
              selectedRows.map((row, index) => (
                <tr key={`${selectedGroupId}-${row.id}-${index}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-800 whitespace-pre-wrap break-words">{row.userText || '-'}</td>
                  <td className="px-3 py-2 text-slate-700 whitespace-pre-wrap break-words">{row.thinkText || '-'}</td>
                  <td className="px-3 py-2 text-slate-800 whitespace-pre-wrap break-words">{row.assistantText || '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-500">
                  No rows found for this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareOverlay({
  isOpen,
  compareSlot1,
  compareSlot2,
  clusterGroups,
  rows,
  onClose,
  onUpdateSlot1,
  onUpdateSlot2,
}: {
  isOpen: boolean;
  compareSlot1: number | null;
  compareSlot2: number | null;
  clusterGroups: ClusterGroup[];
  rows: DisplayRow[];
  onClose: () => void;
  onUpdateSlot1: (groupId: number | null) => void;
  onUpdateSlot2: (groupId: number | null) => void;
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
    <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Cluster Group Comparison</h3>
            <p className="text-sm text-slate-600">Compare two groups side by side using User, &lt;think&gt;, and Assistant content.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
            Close Comparison
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
          <CompareGroupSlot
            title="Comparison Slot 1"
            selectedGroupId={compareSlot1}
            otherSelectedGroupId={compareSlot2}
            clusterGroups={clusterGroups}
            rows={rows}
            onSelectGroup={(groupId) => onUpdateSlot1(groupId)}
            onRemoveGroup={() => onUpdateSlot1(null)}
          />
          <CompareGroupSlot
            title="Comparison Slot 2"
            selectedGroupId={compareSlot2}
            otherSelectedGroupId={compareSlot1}
            clusterGroups={clusterGroups}
            rows={rows}
            onSelectGroup={(groupId) => onUpdateSlot2(groupId)}
            onRemoveGroup={() => onUpdateSlot2(null)}
          />
        </div>
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

export function ConversionPage() {
  const { uploadedFile, conversionOptions, projectName, setProjectName, updateConversionOptions } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [originalConvertedResult, setOriginalConvertedResult] = useState<ConversionResult | null>(null);
  const [visualizationResult, setVisualizationResult] = useState<VisualizationResult | null>(null);
  const [maxK, setMaxK] = useState<number>(20);
  const [dbscanEps, setDbscanEps] = useState<number>(0.1);
  const [dbscanMinSamples, setDbscanMinSamples] = useState<number>(3);
  const [clusterK, setClusterK] = useState<number>(8);
  const [isVisualizing, setIsVisualizing] = useState<boolean>(false);
  const [evaluationMap, setEvaluationMap] = useState<Record<string, RowEvaluationEntry>>({});
  const [refinedRowIds, setRefinedRowIds] = useState<Set<string>>(new Set());
  const [clusterGroups, setClusterGroups] = useState<ClusterGroup[]>([]);
  const [rowClusterMap, setRowClusterMap] = useState<Record<string, number>>({});
  const [selectedClusterIds, setSelectedClusterIds] = useState<number[]>([]);
  const [filterThreshold, setFilterThreshold] = useState<number>(0.9);
  const [downloadScoreThreshold, setDownloadScoreThreshold] = useState<number>(8);
  const [downloadTestPercentage, setDownloadTestPercentage] = useState<number>(10);
  const [currentDatasetVersionId, setCurrentDatasetVersionId] = useState<string | null>(null);
  const [sampleIdMap, setSampleIdMap] = useState<Record<string, string>>({});
  const [clusteredResult, setClusteredResult] = useState<{ data: any[]; assignments: number[]; groups: ClusterGroup[] } | null>(null);
  const [visibleRowsInEvaluation, setVisibleRowsInEvaluation] = useState<DisplayRow[]>([]);
  const [visibleRowsInRefinement, setVisibleRowsInRefinement] = useState<DisplayRow[]>([]);
  const [isEvaluateModalOpen, setIsEvaluateModalOpen] = useState(false);
  const [isAutoLabelModalOpen, setIsAutoLabelModalOpen] = useState(false);
  const [isRefineModalOpen, setIsRefineModalOpen] = useState(false);
  const [isManualEvalModalOpen, setIsManualEvalModalOpen] = useState(false);
  const [scoreHistoryModalOpen, setScoreHistoryModalOpen] = useState(false);
  const [scoreHistoryModalTitle, setScoreHistoryModalTitle] = useState<string>('Score History');
  const [scoreHistoryItems, setScoreHistoryItems] = useState<ScoreHistoryEntry[]>([]);
  const [manualTargetRow, setManualTargetRow] = useState<DisplayRow | null>(null);
  const [isComparingGroups, setIsComparingGroups] = useState(false);
  const [compareSlot1, setCompareSlot1] = useState<number | null>(null);
  const [compareSlot2, setCompareSlot2] = useState<number | null>(null);
  const [refineHistoryMap, setRefineHistoryMap] = useState<Record<string, { original: string; refined: string }>>({});
  const [refineComparisonView, setRefineComparisonView] = useState<{ title: string; original: string; refined: string } | null>(null);
  const [manualDraft, setManualDraft] = useState<{ metricA: string; metricB: string; metricC: string; reason: string }>({
    metricA: '',
    metricB: '',
    metricC: '',
    reason: '',
  });
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DisplayRow | null>(null);
  const [evaluateProvider, setEvaluateProvider] = useState<AiProvider>('gemini');
  const [autoLabelProvider, setAutoLabelProvider] = useState<AiProvider>('gemini');
  const [autoLabelSuggestions, setAutoLabelSuggestions] = useState<AutoLabelSuggestion[]>([]);
  const [autoLabelsSaved, setAutoLabelsSaved] = useState(false);
  const [autoLabelFilterGroupId, setAutoLabelFilterGroupId] = useState<number | null>(null);
  const [refineProvider, setRefineProvider] = useState<AiProvider>('gemini');
  const [refineScoreThreshold, setRefineScoreThreshold] = useState<number>(8);
  const [refineScoreThresholdInput, setRefineScoreThresholdInput] = useState<string>('8');
  const [refineScoreThresholdError, setRefineScoreThresholdError] = useState<string>('');
  const [systemPromptText, setSystemPromptText] = useState<string>('');
  const [selectedPromptContent, setSelectedPromptContent] = useState<string>('');
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [selectedSystemPromptVersion, setSelectedSystemPromptVersion] = useState<string>('');
  const [datasetVersionPromptId, setDatasetVersionPromptId] = useState<string>('');
  const [activeProjectOwnerId, setActiveProjectOwnerId] = useState<string | null>(null);
  const [isCurrentVersionPublic, setIsCurrentVersionPublic] = useState(false);
  const [isTogglingVersionPublic, setIsTogglingVersionPublic] = useState(false);
  const [communityShowRejectedSamples, setCommunityShowRejectedSamples] = useState(false);
  const [communityLoadedRejectedMode, setCommunityLoadedRejectedMode] = useState<boolean | null>(null);
  const [communityCounts, setCommunityCounts] = useState<{ visible: number; total: number; rejected: number }>({
    visible: 0,
    total: 0,
    rejected: 0,
  });
  const loadHandledRef = useRef<boolean>(false);
  const currentUserId = useMemo(() => {
    const candidate = (user as any)?.id || (user as any)?._id || (user as any)?.userId;
    return candidate ? String(candidate) : '';
  }, [user]);
  const isGuestMode = Boolean(activeProjectOwnerId && currentUserId && currentUserId !== String(activeProjectOwnerId));

  const { data: stats } = useQuery({
    queryKey: ['stats', uploadedFile?.fileId],
    queryFn: () => apiService.getStats(uploadedFile!.fileId),
    enabled: !!uploadedFile,
  });

  const previewMode: PreviewMode = conversionOptions.format === 'openai' ? 'openai' : 'alpaca';
  const isProjectLabelingRoute = /^\/project\/[^/]+\/labeling$/i.test(location.pathname);
  const isOwnerInCommunityHub = Boolean(
    isProjectLabelingRoute && activeProjectOwnerId && currentUserId && currentUserId === String(activeProjectOwnerId)
  );
  const canManageVersionVisibility = Boolean(
    currentDatasetVersionId && activeProjectOwnerId && currentUserId && currentUserId === String(activeProjectOwnerId)
  );

  useEffect(() => {
    if (!currentDatasetVersionId) {
      setIsCurrentVersionPublic(false);
      return;
    }

    let disposed = false;
    const syncVisibility = async () => {
      try {
        const detail = await dataprepApi.getDatasetVersionDetail(
          currentDatasetVersionId,
          false,
          isProjectLabelingRoute
        );
        if (!disposed) {
          setIsCurrentVersionPublic(Boolean(detail?.datasetVersion?.isPublic));
        }
      } catch {
        if (!disposed) {
          setIsCurrentVersionPublic(false);
        }
      }
    };

    syncVisibility();
    return () => {
      disposed = true;
    };
  }, [currentDatasetVersionId, isProjectLabelingRoute]);

  const handleToggleVersionVisibility = async () => {
    if (!currentDatasetVersionId || !canManageVersionVisibility || isTogglingVersionPublic) {
      return;
    }

    try {
      setIsTogglingVersionPublic(true);
      const next = !isCurrentVersionPublic;
      const response = await dataprepApi.updateDatasetVersionVisibility(currentDatasetVersionId, next);
      setIsCurrentVersionPublic(Boolean(response?.datasetVersion?.isPublic));
      toast.success(response?.message || (next ? 'Version is now public.' : 'Version is now private.'));
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to update version visibility.');
    } finally {
      setIsTogglingVersionPublic(false);
    }
  };

  const allRows = useMemo(
    () => buildDisplayRows(conversionResult?.data || [], previewMode, conversionOptions.removeThinkTags ?? true),
    [conversionResult?.data, conversionOptions.removeThinkTags, previewMode]
  );

  const rowsWithClusterGroups = useMemo(
    () => allRows.map((row) => ({ ...row, groupId: rowClusterMap[row.id] ?? row.groupId })),
    [allRows, rowClusterMap]
  );

  const autoLabelFilteredRows = useMemo(() => {
    if (autoLabelFilterGroupId === null) return rowsWithClusterGroups;
    return rowsWithClusterGroups.filter((row) => row.groupId === autoLabelFilterGroupId);
  }, [rowsWithClusterGroups, autoLabelFilterGroupId]);

  const clusteredRows = useMemo(() => {
    if (!selectedClusterIds.length) return rowsWithClusterGroups;
    return rowsWithClusterGroups.filter((row) => row.groupId !== undefined && selectedClusterIds.includes(row.groupId));
  }, [rowsWithClusterGroups, selectedClusterIds]);

  const rowsWithResolvedGroup = useMemo(
    () => rowsWithClusterGroups.filter((row) => Number.isFinite(row.groupId)),
    [rowsWithClusterGroups]
  );

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

  const buildDatasetVersionPayload = (): {
    projectName: string;
    similarityThreshold: number;
    format: 'openai' | 'alpaca';
    data: Array<{ sourceKey: string; data: Record<string, any> }>;
    projectId?: string;
    parentVersionId?: string;
    operationType?: 'upload' | 'clean' | 'cluster' | 'refine_approved' | 'manual_edit' | 'legacy';
  } | null => {
    if (!conversionResult) {
      return null;
    }

    const data = rowsWithClusterGroups.map((row) => {
      if (previewMode === 'openai') {
        const messages = (row.conversationPairs || []).flatMap((pair) => ([
          { role: 'user', content: String(pair.user || '') },
          { role: 'assistant', content: String(pair.assistant || '') },
        ])).filter((message) => String(message.content || '').trim() !== '');

        return {
          sourceKey: resolveEvaluationKey(row),
          data: {
            messages,
            ...(Number.isFinite(row.groupId) ? { cluster: row.groupId } : {}),
          },
        };
      }

      return {
        sourceKey: resolveEvaluationKey(row),
        data: {
          instruction: row.instruction,
          input: row.input,
          output: row.output,
          ...(Number.isFinite(row.groupId) ? { cluster: row.groupId } : {}),
        },
      };
    });

    let operationType: 'upload' | 'clean' | 'cluster' | 'refine_approved' | 'manual_edit' | 'legacy' = 'legacy';
    if (currentStep <= 2) operationType = 'upload';
    else if (currentStep === 3) operationType = 'clean';
    else if (currentStep === 4) operationType = 'cluster';
    else if (currentStep >= 5) operationType = 'manual_edit';

    return {
      projectName: projectName.trim() || formatDefaultProjectName(),
      similarityThreshold: filterThreshold,
      format: conversionResult.format === 'openai' ? 'openai' : 'alpaca',
      data: data as Array<{ sourceKey: string; data: Record<string, any> }>,
      projectId: routeProjectId || undefined,
      parentVersionId: currentDatasetVersionId || undefined,
      operationType,
    };
  };

  const ensureSampleIdMapForKeys = async (keys: string[]): Promise<Record<string, string>> => {
    const nextMap = { ...sampleIdMap };
    const findMissing = () => keys.filter((key) => !nextMap[key] && !isMongoObjectId(key));

    let missing = findMissing();
    if (!missing.length) {
      return nextMap;
    }

    if (currentDatasetVersionId) {
      const detail = await dataprepApi.getDatasetVersionDetail(
        currentDatasetVersionId,
        false,
        isProjectLabelingRoute
      );
      detail.items.forEach((item) => {
        nextMap[item.sampleKey] = item.sampleId;
      });
      setSampleIdMap((prev) => ({ ...prev, ...nextMap }));
      missing = findMissing();
    }

    if (!missing.length) {
      return nextMap;
    }

    const payload = buildDatasetVersionPayload();
    if (!payload || !payload.data.length) {
      throw new Error('Cannot resolve sample mapping to save evaluation.');
    }

    const created = await dataprepApi.createDatasetVersion(payload);
    setCurrentDatasetVersionId(created.datasetVersion._id);
    setSampleIdMap(created.sampleIdMap || {});

    return { ...nextMap, ...(created.sampleIdMap || {}) };
  };

  const persistEvaluationsForKeys = async (
    keys: string[],
    sourceMap: Record<string, RowEvaluationEntry>
  ): Promise<number> => {
    if (!conversionResult) {
      return 0;
    }

    const targetKeys = Array.from(new Set(keys));
    const items: Array<{
      sampleId: string;
      evaluatedBy: EvaluatedBy;
      results: {
        accuracy?: number | null;
        clarity?: number | null;
        completeness?: number | null;
        socratic?: number | null;
        encouragement?: number | null;
        factuality?: number | null;
        overall: number | null;
        reason: string;
      };
      createdAt: string;
    }> = [];

    const resolvedMap = await ensureSampleIdMapForKeys(targetKeys);

    targetKeys.forEach((key) => {
      const entry = normalizeEvaluationEntry(sourceMap[key]);
      const latest = getLatestEvaluation(entry);
      if (!latest) {
        return;
      }

      const persistedSampleId = resolvedMap[key] || key;

      if (previewMode === 'openai') {
        items.push({
          sampleId: persistedSampleId,
          evaluatedBy: latest.evaluatedBy,
          results: {
            socratic: latest.scores.socratic ?? null,
            encouragement: latest.scores.encouragement ?? null,
            factuality: latest.scores.factuality ?? null,
            overall: latest.scores.overall ?? null,
            reason: latest.reason,
          },
          createdAt: latest.timestamp,
        });
        return;
      }

      items.push({
        sampleId: persistedSampleId,
        evaluatedBy: latest.evaluatedBy,
        results: {
          accuracy: latest.scores.accuracy ?? null,
          clarity: latest.scores.clarity ?? null,
          completeness: latest.scores.completeness ?? null,
          overall: latest.scores.overall ?? null,
          reason: latest.reason,
        },
        createdAt: latest.timestamp,
      });
    });

    if (!items.length) {
      return 0;
    }

    await apiService.saveEvaluationResults({
      projectName: projectName.trim() || formatDefaultProjectName(),
      datasetVersionId: currentDatasetVersionId || undefined,
      items,
    });

    return items.length;
  };

  const averagedEvaluation = useMemo(() => {
    const values = Object.values(evaluationMap)
      .map((entry) => getAveragedScores(normalizeEvaluationEntry(entry), previewMode))
      .filter((score): score is EvaluationScores => Boolean(score && Number.isFinite(score.overall) && (score.overall as number) >= 0));
    if (!values.length) return null;
    const total = values.reduce<{ accuracy: number; clarity: number; completeness: number; socratic: number; encouragement: number; factuality: number; overall: number }>(
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
  }, [evaluationMap, previewMode]);

  const convertMutation = useMutation({
    mutationFn: (mode: 'initial' | 'clean') => {
      const options = mode === 'initial' ? { ...conversionOptions, enableCleaning: false } : conversionOptions;
      return apiService.convertData(uploadedFile!.fileId, options);
    },
    onSuccess: (data, mode) => {
      setConversionResult(data);
      setActiveProjectOwnerId(currentUserId || null);
      setEvaluationMap({});
      setRefinedRowIds(new Set());
      setSystemPromptText('');
      setCurrentDatasetVersionId(null);
      setIsCurrentVersionPublic(false);
      setSampleIdMap({});
      setAutoLabelSuggestions([]);
      setAutoLabelsSaved(false);
      setAutoLabelFilterGroupId(null);
      setVisualizationResult(null);
      setClusterGroups([]);
      setRowClusterMap({});
      setSelectedClusterIds([]);
      setVisibleRowsInEvaluation([]);
      setVisibleRowsInRefinement([]);
      setRefineHistoryMap({});
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

  const createDatasetVersionMutation = useMutation({
    mutationFn: async () => {
      const payload = buildDatasetVersionPayload();
      if (!payload || !payload.data.length) {
        throw new Error('No converted rows available to version.');
      }

      return dataprepApi.createDatasetVersion(payload);
    },
    onSuccess: (response) => {
      setActiveProjectOwnerId(currentUserId || null);
      setCurrentDatasetVersionId(response.datasetVersion._id);
      setIsCurrentVersionPublic(Boolean(response?.datasetVersion?.isPublic));
      setSampleIdMap(response.sampleIdMap || {});
      setDatasetVersionPromptId('');
      setCurrentStep(5);
      toast.success(`Created ${response.datasetVersion.versionName} for ${response.datasetVersion.projectName}.`);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error.message || 'Create dataset version failed');
    },
  });

  const autoLabelPreviewMutation = useMutation({
    mutationFn: async (provider: AiProvider) => {
      if (!currentDatasetVersionId) {
        throw new Error('Create a clustered dataset version before Auto Labeling.');
      }
      if (!clusterGroups.length) {
        throw new Error('Run K-means clustering before Auto Labeling.');
      }
      return dataprepApi.previewAutoLabels(currentDatasetVersionId, provider);
    },
    onSuccess: (response) => {
      setAutoLabelSuggestions(response.suggestions || []);
      setAutoLabelsSaved(false);
      setIsAutoLabelModalOpen(false);
      toast.success(`Generated labels for ${response.suggestions?.length || 0} clusters.`);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error.message || 'Auto labeling failed');
    },
  });

  const autoLabelSaveMutation = useMutation({
    mutationFn: async () => {
      if (!currentDatasetVersionId) {
        throw new Error('Create a clustered dataset version before saving labels.');
      }
      const labels = clusterGroups.map((group) => {
        const suggestion = autoLabelSuggestions.find((item) => item.clusterId === group.groupId);
        return {
          clusterId: group.groupId,
          label: suggestion?.label as SubjectAutoLabel,
        };
      });
      if (labels.some((item) => !item.label)) {
        throw new Error('All clusters must have a subject label before saving.');
      }
      return dataprepApi.saveAutoLabels(currentDatasetVersionId, labels);
    },
    onSuccess: (response) => {
      toast.success(response.message || `Saved ${response.insertedCount} auto labels.`);
      setAutoLabelsSaved(true);
      setCurrentStep(6);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error.message || 'Save auto labels failed');
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async (params: { provider: AiProvider; rows: DisplayRow[] }) => {
      const rowsToEvaluate = params.rows;
      if (!rowsToEvaluate.length) throw new Error('No rows to evaluate.');

      const updates: Record<string, EvaluationRecord> = {};
      if (previewMode === 'openai') {
        const normalizedConvs = normalizeOpenAIConversations(conversionResult?.data || []);
        const convMessagesMap = new Map<string, Array<{ role: string; content: string }>>();
        normalizedConvs.forEach((conv) => convMessagesMap.set(String(conv.conversation_id), conv.messages));

        const convOrderedIds = Array.from(new Set(rowsToEvaluate.map((row) => row.blockId)));
        const conversationPayload = convOrderedIds.map((convId) => ({
          conversation_id: convId,
          messages: convMessagesMap.get(convId) || [],
        }));

        const evaluation = await apiService.evaluateDataChunked(conversationPayload, previewMode, params.provider);
        evaluation.samples.forEach((sample, idx) => {
          const convId = convOrderedIds[idx];
          if (!convId || !Number.isFinite(sample.scores.overall)) return;
          updates[convId] = {
            evaluatedBy: params.provider,
            scores: {
              socratic: sample.scores.socratic,
              encouragement: sample.scores.encouragement,
              factuality: sample.scores.factuality,
              overall: sample.scores.overall,
            },
            reason: sample.reason,
            timestamp: new Date().toISOString(),
          };
        });
      } else {
        const payload = rowsToEvaluate.map((row) => ({ instruction: row.instruction, input: row.input, output: row.output }));
        const evaluation = await apiService.evaluateDataChunked(payload, previewMode, params.provider);
        evaluation.samples.forEach((sample, idx) => {
          const row = rowsToEvaluate[idx];
          if (!row || !Number.isFinite(sample.scores.overall)) return;
          updates[resolveEvaluationKey(row)] = {
            evaluatedBy: params.provider,
            scores: {
              accuracy: sample.scores.accuracy,
              clarity: sample.scores.clarity,
              completeness: sample.scores.completeness,
              overall: sample.scores.overall,
            },
            reason: sample.reason,
            timestamp: new Date().toISOString(),
          };
        });
      }

      return { updates, provider: params.provider };
    },
    onSuccess: async ({ updates, provider }) => {
      const updateKeys = Object.keys(updates);
      if (!updateKeys.length) {
        toast.error('No rows were evaluated.');
        return;
      }

      const mergedMap = mergeEvaluationUpdates(evaluationMap, updates);
      setEvaluationMap(mergedMap);
      let isAutoSaved = true;

      try {
        await persistEvaluationsForKeys(updateKeys, mergedMap);
      } catch (error: any) {
        isAutoSaved = false;
        toast.error(error?.response?.data?.error || error.message || 'Auto-save failed after evaluation.');
      }

      const label = provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'Deepseek' : 'Gemini';
      if (isAutoSaved) {
        toast.success(`Evaluation completed. ${updateKeys.length} rows scored by ${label} and saved to database.`);
      }
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
        const key = resolveEvaluationKey(row);
        const entry = normalizeEvaluationEntry(evaluationMap[key] || evaluationMap[row.id]);
        const averagedScores = getAveragedScores(entry, previewMode);
        const overall = averagedScores?.overall;
        return Number.isFinite(overall) && (overall as number) >= 0 && (overall as number) <= params.scoreThreshold;
      });

      if (!candidateRows.length) {
        throw new Error(`No visible rows matched overall <= ${params.scoreThreshold.toFixed(1)}.`);
      }

      const hasMissingReason = candidateRows.some((row) => {
        const key = resolveEvaluationKey(row);
        const entry = normalizeEvaluationEntry(evaluationMap[key] || evaluationMap[row.id]);
        const latest = getLatestEvaluation(entry);
        return !String(latest?.reason || '').trim();
      });

      if (hasMissingReason) {
        throw new Error('Please ensure all targeted items have a reason before refining.');
      }

      const payload = candidateRows.map((row) => {
        let assistantData: string | Array<{ user: string; assistant: string }> = row.assistantText;
        if (previewMode === 'openai' && Array.isArray(row.conversationPairs)) {
          assistantData = row.conversationPairs;
        }
        return {
          assistant: assistantData,
          reason: getLatestEvaluation(normalizeEvaluationEntry(evaluationMap[resolveEvaluationKey(row)] || evaluationMap[row.id]))?.reason || '',
        };
      });
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
            const refinedOutput = refined.items[idx]?.refinedOutput;
            if (targetIndex === undefined || !refinedOutput) return;
            const record = nextData[targetIndex];
            if (Array.isArray(record?.messages)) {
              const newRecord = { ...record };
              newRecord.messages = [...record.messages];
              const assistantIndices = newRecord.messages
                .map((msg: any, i: number) => ({ role: String(msg?.role || ''), i }))
                .filter((m: any) => m.role === 'assistant')
                .map((m: any) => m.i);

              if (Array.isArray(refinedOutput)) {
                assistantIndices.forEach((msgIndex: number, turnIdx: number) => {
                  const newText = refinedOutput[turnIdx]?.assistant;
                  if (typeof newText === 'string') {
                    newRecord.messages[msgIndex] = {
                      ...newRecord.messages[msgIndex],
                      content: newText,
                    };
                  }
                });
              } else {
                const lastIdx = assistantIndices.pop();
                if (lastIdx !== undefined) {
                  newRecord.messages[lastIdx] = {
                    ...newRecord.messages[lastIdx],
                    content: refinedOutput as string,
                  };
                }
              }
              nextData[targetIndex] = newRecord;
            }
          });
        } else {
          candidateRows.forEach((row, idx) => {
            const rowIndex = allRows.findIndex((r) => r.id === row.id);
            const refinedOutput = refined.items[idx]?.refinedOutput || row.assistantText;
            if (rowIndex >= 0 && nextData[rowIndex]) {
              nextData[rowIndex] = {
                ...nextData[rowIndex],
                output: typeof refinedOutput === 'string' ? refinedOutput : '',
              };
            }
          });
        }

        return { ...prev, data: nextData };
      });

      const refinedIds = new Set(refinedRowIds);
      const nextRefineHistoryMap: Record<string, { original: string; refined: string }> = {};
      let actuallyRefinedCount = 0;
      candidateRows.forEach((row, idx) => {
        const refinedOutput = refined.items[idx]?.refinedOutput;
        if (!refinedOutput) return;

        let changed = false;
        if (Array.isArray(refinedOutput)) {
          if (Array.isArray(row.conversationPairs)) {
            row.conversationPairs.forEach((pair, turnIdx) => {
              const newText = refinedOutput[turnIdx]?.assistant;
              if (typeof newText === 'string' && newText !== pair.assistant) {
                changed = true;
              }
            });
          }
        } else {
          if (refinedOutput !== row.assistantText) changed = true;
        }

        if (changed) {
          refinedIds.add(row.id);
          const normalizedRefinedText = typeof refinedOutput === 'string'
            ? refinedOutput
            : (Array.isArray(refinedOutput)
              ? refinedOutput.map((t: any) => String(t.assistant || '').trim()).filter(Boolean).join('\n\n')
              : '');
          nextRefineHistoryMap[row.id] = {
            original: String(row.assistantText || ''),
            refined: normalizedRefinedText,
          };
          actuallyRefinedCount++;
        }
      });
      setRefinedRowIds(refinedIds);

      return { count: actuallyRefinedCount, provider: params.provider, nextRefineHistoryMap };
    },
    onSuccess: ({ count, provider, nextRefineHistoryMap }) => {
      const label = provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'Deepseek' : 'Gemini';
      toast.success(`Refined ${count} rows using ${label}.`);

      const historyEntries = Object.entries(nextRefineHistoryMap || {});
      if (historyEntries.length > 0) {
        setRefineHistoryMap((prev) => ({
          ...prev,
          ...Object.fromEntries(historyEntries),
        }));
      }
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Refinement failed'),
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
        normalizeOpenAIConversations(result.data).forEach((conv, idx) => {
          nextMap[String(conv.conversation_id)] = result.assignments[idx] ?? 0;
        });
      } else {
        result.data.forEach((item: any, idx: number) => {
          const rowId = String(item?.id ?? item?.sampleId ?? `alpaca-${idx}`);
          nextMap[rowId] = (item as any).cluster ?? result.assignments[idx] ?? 0;
        });
      }
      setRowClusterMap(nextMap);
      setClusterGroups(result.groups);
      setSelectedClusterIds([]);
      setAutoLabelSuggestions([]);
      setAutoLabelsSaved(false);
      setAutoLabelFilterGroupId(null);
      toast.success(`Clustered data into ${result.groups.length} groups.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Clustering failed'),
  });

  const handlePostFilterUpdate = (result: any) => {
    setConversionResult((prev) => (prev ? { ...prev, data: result.data } : null));

    // Handle missing groups by recalculating from data or preserving existing ones
    if (result.groups) {
      setClusterGroups(result.groups);
    } else if (result.data) {
      // Simple recalculation of counts if groups are missing
      const counts: Record<number, number> = {};
      result.data.forEach((item: any) => {
        const c = item.cluster ?? -1;
        if (c !== -1) counts[c] = (counts[c] || 0) + 1;
      });
      const newGroups = clusterGroups.map(g => ({
        ...g,
        count: counts[g.groupId] ?? 0
      })).filter(g => g.count > 0);
      setClusterGroups(newGroups);
    }

    setCurrentDatasetVersionId(null);
    setSampleIdMap({});
    setAutoLabelSuggestions([]);
    setAutoLabelsSaved(false);
    setAutoLabelFilterGroupId(null);
    const nextMap: Record<string, number> = {};
    if (previewMode === 'openai') {
      const convs = normalizeOpenAIConversations(result.data);
      convs.forEach((conv: any, idx: number) => {
        const convId = String(conv.conversation_id || `conv-${idx + 1}`);
        nextMap[convId] = result.assignments ? (result.assignments[idx] ?? 0) : ((conv as any).cluster ?? 0);
      });
    } else {
      result.data.forEach((item: any, idx: number) => {
        const rowId = String(item?.id || item?.sampleId || `alpaca-${idx}`);
        nextMap[rowId] = (item as any).cluster ?? (result.assignments ? (result.assignments[idx] ?? 0) : 0);
      });
    }
    setRowClusterMap(nextMap);
    setSelectedClusterIds([]);
  };

  const removeNoiseMutation = useMutation({
    mutationFn: async () => {
      // Note: Backend/GPU service now relies on internal cache from previous /cluster call
      return apiService.clusterRemoveNoise();
    },
    onSuccess: (result) => {
      handlePostFilterUpdate(result);
      toast.success(`Noise removal complete. Remaining: ${result.data.length} records.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Noise removal failed'),
  });

  const deduplicateMutation = useMutation({
    mutationFn: async () => {
      // Note: Backend/GPU service now relies on internal cache from previous /cluster call
      return apiService.clusterDeduplicate(filterThreshold);
    },
    onSuccess: (result) => {
      handlePostFilterUpdate(result);
      toast.success(`Deduplication complete. Remaining: ${result.data.length} records.`);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || error.message || 'Deduplication failed'),
  });

  const handleResetFiltering = () => {
    if (!clusteredResult) return;
    setConversionResult((prev) => (prev ? { ...prev, data: clusteredResult.data } : null));
    setClusterGroups(clusteredResult.groups);
    setCurrentDatasetVersionId(null);
    setSampleIdMap({});
    setAutoLabelSuggestions([]);
    setAutoLabelsSaved(false);
    setSelectedClusterIds([]);

    // Restore rowClusterMap from the saved cluster assignments
    const nextMap: Record<string, number> = {};
    if (previewMode === 'openai') {
      normalizeOpenAIConversations(clusteredResult.data).forEach((conv, idx) => {
        nextMap[String(conv.conversation_id)] = clusteredResult.assignments[idx] ?? 0;
      });
    } else {
      clusteredResult.data.forEach((item, idx) => {
        const rowId = String(item?.id ?? item?.sampleId ?? `alpaca-${idx}`);
        nextMap[rowId] = (item as any).cluster ?? clusteredResult.assignments[idx] ?? 0;
      });
    }
    setRowClusterMap(nextMap);

    toast.success('Reset to pre-filter clustered state.');
  };

  const handleResetCleaning = () => {
    if (!originalConvertedResult) return;
    setConversionResult(originalConvertedResult);
    setClusterGroups([]);
    setRowClusterMap({});
    setCurrentDatasetVersionId(null);
    setSampleIdMap({});
    setAutoLabelSuggestions([]);
    setAutoLabelsSaved(false);
    setEvaluationMap({});
    setRefinedRowIds(new Set());
    setRefineHistoryMap({});
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

  const resolvePersistedSampleIdForRow = async (row: DisplayRow): Promise<string | null> => {
    const key = resolveEvaluationKey(row);
    const directCandidates = [
      sampleIdMap[key],
      sampleIdMap[row.blockId],
      sampleIdMap[row.id],
      key,
      row.blockId,
      row.id,
    ].filter((value): value is string => Boolean(value));

    const directMatch = directCandidates.find((value) => isMongoObjectId(value));
    if (directMatch) {
      return directMatch;
    }

    if (!currentDatasetVersionId) {
      return null;
    }

    try {
      const detail = await dataprepApi.getDatasetVersionDetail(
        currentDatasetVersionId,
        false,
        isProjectLabelingRoute
      );
      const nextMap = detail.items.reduce<Record<string, string>>((acc, item) => {
        acc[item.sampleKey] = item.sampleId;
        return acc;
      }, {});

      setSampleIdMap((prev) => ({ ...prev, ...nextMap }));

      const hydratedCandidates = [
        nextMap[key],
        nextMap[row.blockId],
        nextMap[row.id],
      ].filter((value): value is string => Boolean(value));

      return hydratedCandidates.find((value) => isMongoObjectId(value)) || null;
    } catch {
      return null;
    }
  };

  const ensureDatasetVersionForExport = async (): Promise<string | null> => {
    if (!conversionResult?.data?.length) {
      return null;
    }

    if (!currentDatasetVersionId || (selectedPromptId && datasetVersionPromptId !== selectedPromptId)) {
      try {
        const payload = buildDatasetVersionPayload();
        if (payload && payload.data.length) {
          const effectivePromptContent = String(selectedPromptContent || systemPromptText || '').trim();
          const created = await dataprepApi.createDatasetVersion({
            projectName: payload.projectName,
            similarityThreshold: payload.similarityThreshold,
            format: payload.format,
            data: payload.data,
            promptId: selectedPromptId,
            promptContentSnapshot: effectivePromptContent || undefined,
            projectId: payload.projectId,
            parentVersionId: payload.parentVersionId,
            operationType: payload.operationType,
          });
          setCurrentDatasetVersionId(created.datasetVersion._id);
          setSampleIdMap(created.sampleIdMap || {});
          setDatasetVersionPromptId(selectedPromptId);
          return created.datasetVersion._id;
        }
      } catch (error: any) {
        toast.error(error?.response?.data?.error || error?.message || 'Failed to sync prompt linkage before download.');
        return null;
      }
    }
    return currentDatasetVersionId;
  };

  const loadExportDatasetDetail = async () => {
    const datasetVersionId = await ensureDatasetVersionForExport();
    if (!datasetVersionId) {
      throw new Error('No dataset version available for export.');
    }

    const detail = await dataprepApi.getDatasetVersionDetail(
      datasetVersionId,
      false, // showRejected = false (excludes REJECT >= 3)
      isProjectLabelingRoute
    );
    return detail;
  };

  const handleDownloadTrainTestZip = async () => {
    let exportData: any[] = [];
    try {
      const detail = await loadExportDatasetDetail();
      exportData = detail.items.map((item: any) => item.data);
    } catch (err: any) {
      console.error('Export fetch error:', err);
      // Fallback to local data if fetch fails (not ideal, but keeps current behavior)
      exportData = conversionResult?.data || [];
    }

    if (!exportData.length) {
      toast.error('No data available to export.');
      return;
    }

    const totalCount = exportData.length;
    const allIndices = Array.from({ length: totalCount }, (_, idx) => idx);
    const shuffled = shuffle(allIndices);
    const safePercentage = Math.min(100, Math.max(0, downloadTestPercentage));
    let testCount = Math.round(totalCount * (safePercentage / 100));
    if (safePercentage > 0 && testCount === 0) {
      testCount = 1;
    }
    if (safePercentage < 100 && testCount === totalCount && totalCount > 0) {
      testCount = totalCount - 1;
    }

    const testIndexSet = new Set<number>();
    shuffled.slice(0, testCount).forEach((idx) => testIndexSet.add(idx));

    const trainData: any[] = [];
    const testData: any[] = [];
    const effectivePromptContent = String(selectedPromptContent || systemPromptText || '').trim();

    exportData.forEach((record, idx) => {
      let payload = sanitizeRecordForDownload(record, previewMode, effectivePromptContent);
      if (previewMode === 'openai') {
        payload = injectSystemPromptIntoConversation(payload, effectivePromptContent);
      }
      if (testIndexSet.has(idx)) {
        testData.push(payload);
      } else {
        trainData.push(payload);
      }
    });

    const zip = new JSZip();
    zip.file('train_dataset.json', JSON.stringify(trainData, null, 2));
    zip.file('test_dataset.json', JSON.stringify(testData, null, 2));
    zip.file(
      '_metadata.json',
      JSON.stringify(
        {
          projectName: projectName.trim() || 'dataset',
          datasetVersionId: currentDatasetVersionId || null,
          systemPrompt: effectivePromptContent || null,
          systemPromptVersion: selectedSystemPromptVersion || null,
          totalTrain: trainData.length,
          totalTest: testData.length,
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${projectName.trim() || 'dataset'}_train_test.zip`);
    toast.success(`Downloaded zip with ${trainData.length} train and ${testData.length} test records (test ${safePercentage.toFixed(0)}%).`);
  };

  const handleDownloadByScore = async () => {
    let exportData: any[] = [];
    let items: any[] = [];
    try {
      const detail = await loadExportDatasetDetail();
      items = detail.items;
      exportData = items.map((item: any) => item.data);
    } catch (err: any) {
      console.error('Export fetch error:', err);
      toast.error('Failed to fetch dataset detail for scored export.');
      return;
    }

    if (!items.length) {
      toast.error('No data available to download.');
      return;
    }

    const qualifiedIndices = items
      .map((item, idx) => {
        // Use the aggregated scores from the backend if available, or fall back to evaluationMap
        const overall = item.results?.overall;
        if (Number.isFinite(overall) && (overall || 0) >= downloadScoreThreshold) {
          return idx;
        }
        return -1;
      })
      .filter((idx) => idx !== -1);

    if (!qualifiedIndices.length) {
      toast.error(`Không tìm thấy mẫu nào có overall >= ${downloadScoreThreshold.toFixed(1)}.`);
      return;
    }

    const effectivePromptContent = String(selectedPromptContent || systemPromptText || '').trim();
    const filteredData = qualifiedIndices.map((idx) => {
      let payload = sanitizeRecordForDownload(exportData[idx], previewMode, effectivePromptContent);
      if (previewMode === 'openai') {
        payload = injectSystemPromptIntoConversation(payload, effectivePromptContent);
      }
      return payload;
    });

    const thresholdLabel = downloadScoreThreshold.toFixed(1).replace('.', '_');
    const blob = new Blob([JSON.stringify(filteredData, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    saveAs(blob, `${projectName.trim() || 'dataset'}_overall_gte_${thresholdLabel}.json`);
    toast.success(`Downloaded ${filteredData.length} samples with overall >= ${downloadScoreThreshold.toFixed(1)}.`);
  };

  const handleOpenManualEvaluate = (row: DisplayRow) => {
    const key = resolveEvaluationKey(row);
    const entry = normalizeEvaluationEntry(evaluationMap[key] || evaluationMap[row.id]);
    const latest = getLatestEvaluation(entry);
    const score = latest?.scores;
    const labelA = previewMode === 'openai' ? 'socratic' : 'accuracy';
    const labelB = previewMode === 'openai' ? 'encouragement' : 'clarity';
    const labelC = previewMode === 'openai' ? 'factuality' : 'completeness';

    setManualTargetRow(row);
    setManualDraft({
      metricA: String((score as any)?.[labelA] ?? ''),
      metricB: String((score as any)?.[labelB] ?? ''),
      metricC: String((score as any)?.[labelC] ?? ''),
      reason: latest?.reason || '',
    });
    setIsManualEvalModalOpen(true);
  };

  const handleOpenScoreHistory = (row: DisplayRow) => {
    const key = resolveEvaluationKey(row);
    const entry = normalizeEvaluationEntry(evaluationMap[key] || evaluationMap[row.id]);
    setScoreHistoryItems(
      (entry.evaluations || []).map((item) => ({
        evaluatedBy: item.evaluatedBy,
        scores: item.scores,
        reason: item.reason,
        timestamp: item.timestamp,
      }))
    );
    setScoreHistoryModalTitle(`Lich su diem - ${row.blockLabel}`);
    setScoreHistoryModalOpen(true);
  };

  const handleManualDraftChange = (field: 'metricA' | 'metricB' | 'metricC' | 'reason', value: string) => {
    if (field !== 'reason' && value !== '' && !/^\d*\.?\d*$/.test(value)) {
      return;
    }
    setManualDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleConfirmManualEvaluate = async () => {
    if (!manualTargetRow) {
      return;
    }

    const metric1 = previewMode === 'openai' ? 'socratic' : 'accuracy';
    const metric2 = previewMode === 'openai' ? 'encouragement' : 'clarity';
    const metric3 = previewMode === 'openai' ? 'factuality' : 'completeness';
    const m1 = clampScore(parseOptionalScore(manualDraft.metricA) ?? 0);
    const m2 = clampScore(parseOptionalScore(manualDraft.metricB) ?? 0);
    const m3 = clampScore(parseOptionalScore(manualDraft.metricC) ?? 0);
    const key = resolveEvaluationKey(manualTargetRow);

    const update: EvaluationRecord = {
      evaluatedBy: 'manual',
      scores: {
        [metric1]: m1,
        [metric2]: m2,
        [metric3]: m3,
        overall: calculateOverallFromThree(m1, m2, m3),
      },
      reason: manualDraft.reason.trim(),
      timestamp: new Date().toISOString(),
    };

    const mergedMap = mergeEvaluationUpdates(evaluationMap, { [key]: update });
    setEvaluationMap(mergedMap);
    setIsManualSaving(true);

    try {
      await persistEvaluationsForKeys([key], mergedMap);
      toast.success('Manual evaluation saved.');
      setIsManualEvalModalOpen(false);
      setManualTargetRow(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error.message || 'Failed to auto-save manual evaluation.');
    } finally {
      setIsManualSaving(false);
    }
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
      ? Object.fromEntries(
        Object.entries(payload.evaluationMap).map(([key, value]) => [key, normalizeEvaluationEntry(value)])
      )
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
    setRefinedRowIds(new Set());
    setRefineHistoryMap({});
    setSystemPromptText('');
    setCurrentDatasetVersionId(payload.datasetVersionId || null);
    setSampleIdMap(payload.sampleIdMap || {});
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setAutoLabelSuggestions([]);
    setAutoLabelsSaved(false);
    setAutoLabelFilterGroupId(null);
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setActiveProjectOwnerId(payload.ownerId ? String(payload.ownerId) : (currentUserId || null));
    updateConversionOptions({ format: normalizedFormat });
    setProjectName(payload.projectName || formatDefaultProjectName());
    setCurrentStep((payload.startStep && payload.startStep >= 1 && payload.startStep <= 10
      ? payload.startStep
      : 7) as Step);
    loadHandledRef.current = true;

    // Clear consumed router state to avoid accidental re-processing on future renders.
    navigate(location.pathname, { replace: true, state: null });

    toast.success(payload.startStep === 6 ? 'Project loaded. Continue at Labeling.' : 'Project loaded. Continue evaluation.');
  }, [currentUserId, location.pathname, location.state, navigate, setProjectName, updateConversionOptions]);

  useEffect(() => {
    if (!isProjectLabelingRoute || !routeProjectId) {
      return;
    }

    const hasRouteProjectContext =
      currentDatasetVersionId === routeProjectId &&
      Array.isArray(conversionResult?.data) &&
      conversionResult.data.length > 0 &&
      Object.keys(sampleIdMap || {}).length > 0 &&
      Boolean(activeProjectOwnerId) &&
      communityLoadedRejectedMode === communityShowRejectedSamples;

    if (hasRouteProjectContext) {
      if (currentStep !== 6) {
        setCurrentStep(6);
      }
      loadHandledRef.current = true;
      return;
    }

    let disposed = false;

    const loadPublicProject = async () => {
      try {
        const response = await dataprepApi.getPublicProjectLabeling(routeProjectId, communityShowRejectedSamples);
        if (disposed) {
          return;
        }

        const payload = response.loadProject;
        const normalizedFormat: PreviewMode = payload.format === 'alpaca' ? 'alpaca' : 'openai';
        const safeData = Array.isArray(payload.data) ? payload.data : [];
        const resolvedOwnerId = String(payload.ownerId || response.project.ownerId || '').trim();
        const resolvedSampleIdMap = payload.sampleIdMap && typeof payload.sampleIdMap === 'object'
          ? payload.sampleIdMap
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
        setEvaluationMap({});
        setRefinedRowIds(new Set());
        setRefineHistoryMap({});
        setSystemPromptText('');
        setCurrentDatasetVersionId(payload.datasetVersionId || null);
        setIsCurrentVersionPublic(true);
        setSampleIdMap(resolvedSampleIdMap);
        setCommunityLoadedRejectedMode(Boolean(payload.showRejected));
        setCommunityCounts({
          visible: Number(payload.visibleSamples || safeData.length || 0),
          total: Number(payload.totalSamples || safeData.length || 0),
          rejected: Number(payload.rejectedSamples || 0),
        });
        setClusterGroups([]);
        setRowClusterMap({});
        setSelectedClusterIds([]);
        setAutoLabelSuggestions([]);
        setAutoLabelsSaved(false);
        setAutoLabelFilterGroupId(null);
        setVisibleRowsInEvaluation([]);
        setVisibleRowsInRefinement([]);
        setActiveProjectOwnerId(resolvedOwnerId || (currentUserId || null));
        updateConversionOptions({ format: normalizedFormat });
        setProjectName(payload.projectName || formatDefaultProjectName());
        setCurrentStep(6);
        loadHandledRef.current = true;

        if (resolvedOwnerId && currentUserId && currentUserId === resolvedOwnerId) {
          toast.success('Opened project in Data Labeling step as project owner.');
        } else {
          toast.success('Opened project in Data Labeling step. Guest mode is enforced for non-owners.');
        }
      } catch (error: any) {
        if (disposed) {
          return;
        }
        toast.error(error?.response?.data?.error || error?.message || 'Failed to load public project.');
        navigate('/community-hub');
      }
    };

    loadPublicProject();

    return () => {
      disposed = true;
    };
  }, [
    activeProjectOwnerId,
    communityLoadedRejectedMode,
    communityShowRejectedSamples,
    conversionResult?.data,
    currentDatasetVersionId,
    currentStep,
    currentUserId,
    location.pathname,
    navigate,
    routeProjectId,
    sampleIdMap,
    setProjectName,
    updateConversionOptions,
  ]);

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
    setRefinedRowIds(new Set());
    setRefineHistoryMap({});
    setSystemPromptText('');
    setSelectedPromptContent('');
    setSelectedPromptId('');
    setSelectedSystemPromptVersion('');
    setDatasetVersionPromptId('');
    setCurrentDatasetVersionId(null);
    setSampleIdMap({});
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setAutoLabelSuggestions([]);
    setAutoLabelsSaved(false);
    setAutoLabelFilterGroupId(null);
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setActiveProjectOwnerId(null);
    setCommunityShowRejectedSamples(false);
    setCommunityLoadedRejectedMode(null);
    setCommunityCounts({ visible: 0, total: 0, rejected: 0 });
    loadHandledRef.current = false;
    if (uploadedFile?.fileId) setProjectName(formatDefaultProjectName());
    else setProjectName('');
  }, [location.state, setProjectName, uploadedFile?.fileId]);

  const canMoveFromStep2 = !!conversionResult;
  const canMoveFromStep3 = true;
  const canMoveFromStep4 = clusterGroups.length > 0;
  const canMoveFromStep5 = autoLabelsSaved;
  const canMoveFromStep7 = !!conversionResult;
  const canMoveFromStep8 = !!conversionResult;
  const canMoveFromStep9 = !!conversionResult;

  useEffect(() => {
    if (isGuestMode && currentStep !== 6) {
      setCurrentStep(6);
    }
  }, [currentStep, isGuestMode]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('data-prep-step-change', { detail: { step: currentStep } }));

    return () => {
      window.dispatchEvent(new CustomEvent('data-prep-step-change', { detail: { step: null } }));
    };
  }, [currentStep]);

  const systemPromptPreviewJson = useMemo(() => {
    if (!conversionResult?.data?.length) {
      return null;
    }

    if (previewMode === 'openai') {
      return sanitizeRecordForDownload(conversionResult.data[0], previewMode, systemPromptText);
    }

    const first = conversionResult.data[0] || {};
    const userParts = [String(first?.instruction ?? first?.query ?? ''), String(first?.input ?? first?.context ?? '')]
      .map((part) => part.trim())
      .filter(Boolean);
    const assistant = String(first?.output ?? first?.answer ?? first?.response ?? '').trim();
    const baseMessages = [
      { role: 'user', content: userParts.join('\n\n') || '-' },
      { role: 'assistant', content: assistant || '-' },
    ];

    const trimmedSystemPrompt = String(systemPromptText || '').trim();
    return {
      messages: trimmedSystemPrompt
        ? [{ role: 'system', content: trimmedSystemPrompt }, ...baseMessages]
        : baseMessages,
    };
  }, [conversionResult?.data, previewMode, systemPromptText]);

  const handleProceedFromClusterStep = () => {
    if (!canMoveFromStep4 || createDatasetVersionMutation.isPending) {
      return;
    }
    createDatasetVersionMutation.mutate();
  };

  const handleChangeAutoLabelSuggestion = (clusterId: number, label: SubjectAutoLabel) => {
    setAutoLabelsSaved(false);
    setAutoLabelSuggestions((prev) => {
      const existing = prev.find((item) => item.clusterId === clusterId);
      if (existing) {
        return prev.map((item) => item.clusterId === clusterId ? { ...item, label } : item);
      }
      const group = clusterGroups.find((item) => item.groupId === clusterId);
      return [
        ...prev,
        {
          clusterId,
          label,
          reason: 'Manually selected by reviewer.',
          sampleCount: group?.count || 0,
        },
      ];
    });
  };

  const handleProceedFromSystemPromptStep = async () => {
    if (!canMoveFromStep9) {
      return;
    }

    if (selectedPromptId && (!currentDatasetVersionId || datasetVersionPromptId !== selectedPromptId)) {
      try {
        const payload = buildDatasetVersionPayload();
        if (payload && payload.data.length) {
          const effectivePromptContent = String(selectedPromptContent || systemPromptText || '').trim();
          const created = await dataprepApi.createDatasetVersion({
            projectName: payload.projectName,
            similarityThreshold: payload.similarityThreshold,
            format: payload.format,
            data: payload.data,
            promptId: selectedPromptId,
            promptContentSnapshot: effectivePromptContent || undefined,
          });

          setCurrentDatasetVersionId(created.datasetVersion._id);
          setSampleIdMap(created.sampleIdMap || {});
          setDatasetVersionPromptId(selectedPromptId);
        }
      } catch (error: any) {
        toast.error(error?.response?.data?.error || error?.message || 'Failed to save prompt linkage for dataset version.');
        return;
      }
    }

    setCurrentStep(10);
  };

  const validateRefineScoreThreshold = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Refine items with overall <= is required.';
    }

    if (!/^\d*\.?\d+$/.test(trimmed)) {
      return 'Please enter a valid number.';
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return 'Please enter a valid number.';
    }

    if (parsed < 0 || parsed > 10) {
      return 'Score threshold must be between 0 and 10.';
    }

    return '';
  };

  const handleRefineScoreThresholdInputChange = (value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) {
      return;
    }

    setRefineScoreThresholdInput(value);
    if (value.trim() === '') {
      setRefineScoreThresholdError('');
      return;
    }

    setRefineScoreThresholdError(validateRefineScoreThreshold(value));
  };

  useEffect(() => {
    if (!isRefineModalOpen) {
      return;
    }
    setRefineScoreThresholdInput(String(refineScoreThreshold));
    setRefineScoreThresholdError('');
  }, [isRefineModalOpen, refineScoreThreshold]);

  const handleOpenCompareOverlay = () => {
    setIsComparingGroups(true);
  };

  const handleCloseCompareOverlay = () => {
    setIsComparingGroups(false);
    setCompareSlot1(null);
    setCompareSlot2(null);
  };

  const refinedHighlightMap = useMemo(() => {
    const map: Record<string, 'refined'> = {};
    refinedRowIds.forEach((id) => {
      map[id] = 'refined';
    });
    return map;
  }, [refinedRowIds]);

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

  const handleOpenRefineComparison = (row: DisplayRow) => {
    const record = refineHistoryMap[row.id] || refineHistoryMap[row.blockId];
    if (!record) {
      toast.error('Khong co lich su thay doi refine cho dong nay.');
      return;
    }

    setRefineComparisonView({
      title: `Refine Comparison - ${row.blockLabel}`,
      original: record.original,
      refined: record.refined,
    });
  };

  const handleConfirmDeleteSample = async () => {
    if (!conversionResult || !itemToDelete) {
      setItemToDelete(null);
      return;
    }

    const persistedSampleId = await resolvePersistedSampleIdForRow(itemToDelete);
    if (!persistedSampleId) {
      toast.error('Khong tim thay sampleId trong database, khong the xoa.');
      return;
    }

    try {
      await apiService.deleteDatasetVersionItem(persistedSampleId);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error.message || 'Xoa mau du lieu that bai.');
      return;
    }

    let nextData = conversionResult.data || [];
    let nextEvaluationMap = { ...evaluationMap };
    let nextRefinedRowIds = new Set(refinedRowIds);
    let nextRowClusterMap = { ...rowClusterMap };
    let nextRefineHistoryMap = { ...refineHistoryMap };
    const nextSampleIdMap = { ...sampleIdMap };

    delete nextSampleIdMap[resolveEvaluationKey(itemToDelete)];
    delete nextSampleIdMap[itemToDelete.blockId];
    delete nextSampleIdMap[itemToDelete.id];

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
      nextRefinedRowIds.delete(itemToDelete.id);
      nextRefinedRowIds.delete(itemToDelete.blockId);
      delete nextRefineHistoryMap[itemToDelete.id];
      delete nextRefineHistoryMap[itemToDelete.blockId];
      delete nextRowClusterMap[itemToDelete.id];
      delete nextRowClusterMap[itemToDelete.blockId];
    } else {
      const match = /^alpaca-(\d+)$/.exec(itemToDelete.id);
      const deleteIndex = match ? Number(match[1]) : -1;
      if (deleteIndex >= 0) {
        nextData = (conversionResult.data || []).filter((_, idx) => idx !== deleteIndex);
        nextEvaluationMap = remapRecordKeysAfterAlpacaDelete(nextEvaluationMap, deleteIndex);
        nextRefinedRowIds = remapSetKeysAfterAlpacaDelete(nextRefinedRowIds, deleteIndex);
        nextRefineHistoryMap = remapRecordKeysAfterAlpacaDelete(nextRefineHistoryMap, deleteIndex);
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
    setSampleIdMap(nextSampleIdMap);
    setRefinedRowIds(nextRefinedRowIds);
    setRefineHistoryMap(nextRefineHistoryMap);
    setRowClusterMap(nextRowClusterMap);
    setClusterGroups(nextGroups);
    setSelectedClusterIds((prev) => prev.filter((id) => nextGroups.some((group) => group.groupId === id)));
    setAutoLabelSuggestions((prev) => prev.filter((item) => nextGroups.some((group) => group.groupId === item.clusterId)));
    setAutoLabelsSaved(false);
    setVisibleRowsInEvaluation([]);
    setVisibleRowsInRefinement([]);
    setItemToDelete(null);
    toast.success('Sample deleted successfully (database + UI).');
  };

  return (
    <div className="space-y-6">
      <StepperHeader currentStep={currentStep} lockedToStep={isGuestMode ? 6 : null} />

      {isGuestMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Guest Mode: only the Labeling substep is available for this project.
        </div>
      )}

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
        <VisualizationPanel
          visualizationResult={visualizationResult}
          maxK={maxK}
          setMaxK={setMaxK}
          dbscanEps={dbscanEps}
          setDbscanEps={setDbscanEps}
          dbscanMinSamples={dbscanMinSamples}
          setDbscanMinSamples={setDbscanMinSamples}
          isVisualizing={isVisualizing}
          hasData={Boolean(conversionResult?.data?.length)}
          onVisualize={handleVisualize}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
          nextDisabled={!canMoveFromStep3}
        />
      )}

      {currentStep === 4 && (
        <ClusterPanel
          table={<ConvertedDatasetTable rows={clusteredRows} mode={previewMode} />}
          clusterGroups={clusterGroups}
          clusterK={clusterK}
          setClusterK={setClusterK}
          dbscanEps={dbscanEps}
          setDbscanEps={setDbscanEps}
          dbscanMinSamples={dbscanMinSamples}
          setDbscanMinSamples={setDbscanMinSamples}
          filterThreshold={filterThreshold}
          setFilterThreshold={setFilterThreshold}
          selectedClusterIds={selectedClusterIds}
          toggleClusterSelection={toggleClusterSelection}
          onCluster={() => {
            if (!visualizationResult) {
              toast.error('Vui lòng quay lại substep Find K để thực hiện Visualization trước khi phân cụm.');
              return;
            }
            clusterMutation.mutate();
          }}
          onRemoveNoise={() => removeNoiseMutation.mutate()}
          onDeduplicate={() => deduplicateMutation.mutate()}
          onResetFiltering={handleResetFiltering}
          onOpenCompareOverlay={handleOpenCompareOverlay}
          onBack={() => setCurrentStep(3)}
          onNext={handleProceedFromClusterStep}
          hasConversionResult={Boolean(conversionResult)}
          isClustering={clusterMutation.isPending}
          isRemovingNoise={removeNoiseMutation.isPending}
          isDeduplicating={deduplicateMutation.isPending}
          nextDisabled={!canMoveFromStep4 || createDatasetVersionMutation.isPending}
        />
      )}

      {currentStep === 5 && (
        <AutoLabelingPanel
          table={<ConvertedDatasetTable rows={autoLabelFilteredRows} mode={previewMode} />}
          clusterGroups={clusterGroups}
          suggestions={autoLabelSuggestions}
          selectedGroupId={autoLabelFilterGroupId}
          onSelectGroup={setAutoLabelFilterGroupId}
          onChangeLabel={handleChangeAutoLabelSuggestion}
          onLabelWithAI={() => setIsAutoLabelModalOpen(true)}
          onSave={() => autoLabelSaveMutation.mutate()}
          onBack={() => setCurrentStep(4)}
          onNext={() => setCurrentStep(6)}
          isGenerating={autoLabelPreviewMutation.isPending}
          isSaving={autoLabelSaveMutation.isPending}
          hasDatasetVersion={Boolean(currentDatasetVersionId)}
          nextDisabled={!canMoveFromStep5}
        />
      )}

      {currentStep === 6 && (
        <LabelingWorkflowPanel
          isCommunityRoute={isProjectLabelingRoute}
          communityCounts={communityCounts}
          showRejectedSamples={communityShowRejectedSamples}
          onToggleRejectedSamples={() => setCommunityShowRejectedSamples((prev) => !prev)}
          canManageVersionVisibility={canManageVersionVisibility}
          hasCurrentDatasetVersion={Boolean(currentDatasetVersionId)}
          isCurrentVersionPublic={isCurrentVersionPublic}
          isTogglingVersionPublic={isTogglingVersionPublic}
          onToggleVersionVisibility={handleToggleVersionVisibility}
          labelingPanel={(
            <DataLabelingPanel
              samples={allRows.map((row) => ({
                key: row.id,
                title: row.blockLabel,
                sampleId: sampleIdMap[row.id] || sampleIdMap[row.blockId] || (row.id.match(/^[a-f\d]{24}$/i) ? row.id : null),
                messages: row.conversationPairs
                  ? row.conversationPairs.flatMap((pair) => [
                    { role: 'user' as const, content: pair.user },
                    { role: 'assistant' as const, content: pair.assistant },
                  ])
                  : [
                    { role: 'user' as const, content: row.userText || row.instruction },
                    { role: 'assistant' as const, content: row.assistantText || row.output },
                  ],
              }))}
              onBack={() => setCurrentStep(isGuestMode ? 6 : 5)}
              onNext={() => setCurrentStep(7)}
              showBackButton={!isGuestMode}
              showNextButton={!isGuestMode}
              nextDisabled={isGuestMode}
              fromCommunityHub={isProjectLabelingRoute}
              lockInteractions={isOwnerInCommunityHub}
              lockReason={isOwnerInCommunityHub ? 'Owner cannot add/vote from Community Hub route. Use normal workflow to vote.' : ''}
            />
          )}
        />
      )}

      {currentStep === 7 && (
        <EvaluationPanel
          table={(
            <ConvertedDatasetTable
              rows={evaluationRows}
              mode={previewMode}
              showEvaluationColumns
              evaluationMap={evaluationMap}
              onEvaluate={() => setIsEvaluateModalOpen(true)}
              isEvaluating={evaluateMutation.isPending}
              disableEvaluate={!conversionResult || visibleRowsInEvaluation.length === 0}
              onVisibleRowsChange={setVisibleRowsInEvaluation}
              onRequestViewHistory={handleOpenScoreHistory}
              onRequestManualEvaluate={handleOpenManualEvaluate}
              onRequestDeleteRow={(row) => setItemToDelete(row)}
              refineHistoryMap={refineHistoryMap}
              onRequestViewRefineChange={handleOpenRefineComparison}
            />
          )}
          averagedEvaluation={averagedEvaluation}
          mode={previewMode}
          onBack={() => setCurrentStep(6)}
          onNext={() => setCurrentStep(8)}
          nextDisabled={!canMoveFromStep7}
        />
      )}

      {currentStep === 8 && (
        <RefinementPanel
          table={(
            <ConvertedDatasetTable
              rows={evaluationRows}
              mode={previewMode}
              showEvaluationColumns
              evaluationMap={evaluationMap}
              rowHighlightMap={refinedHighlightMap}
              onEvaluate={() => setIsEvaluateModalOpen(true)}
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
              disableEvaluate={!conversionResult || visibleRowsInRefinement.length === 0}
              onVisibleRowsChange={setVisibleRowsInRefinement}
              onRequestViewHistory={handleOpenScoreHistory}
              onRequestManualEvaluate={handleOpenManualEvaluate}
              onRequestDeleteRow={(row) => setItemToDelete(row)}
              refineHistoryMap={refineHistoryMap}
              onRequestViewRefineChange={handleOpenRefineComparison}
            />
          )}
          onBack={() => setCurrentStep(7)}
          onNext={() => setCurrentStep(9)}
          nextDisabled={!canMoveFromStep8}
        />
      )}

      {currentStep === 9 && (
        <SystemPromptStepPanel
          systemPromptText={systemPromptText}
          onSystemPromptTextChange={setSystemPromptText}
          previewJson={systemPromptPreviewJson}
          projectName={projectName.trim() || formatDefaultProjectName()}
          onSelectedPromptVersionChange={(payload) => {
            setSelectedPromptContent(payload.content);
            setSelectedPromptId(payload.promptId);
            setSelectedSystemPromptVersion(payload.systemPromptVersion);
          }}
          onBack={() => setCurrentStep(8)}
          onNext={handleProceedFromSystemPromptStep}
          nextDisabled={!canMoveFromStep9}
        />
      )}

      {currentStep === 10 && (
        <div className="space-y-5">
          <ConvertedDatasetTable
            rows={evaluationRows}
            mode={previewMode}
            showEvaluationColumns
            showEvaluationActions={false}
            evaluationMap={evaluationMap}
            isFinishPreview
            systemPromptText={systemPromptText}
          />
          <ExportPanel
            conversionResult={conversionResult}
            downloadTestPercentage={downloadTestPercentage}
            setDownloadTestPercentage={setDownloadTestPercentage}
            handleDownloadTrainTestZip={handleDownloadTrainTestZip}
            downloadScoreThreshold={downloadScoreThreshold}
            setDownloadScoreThreshold={setDownloadScoreThreshold}
            handleDownloadByScore={handleDownloadByScore}
            setCurrentStep={setCurrentStep}
          />
        </div>
      )}

      <EvaluateModal
        isOpen={isEvaluateModalOpen}
        provider={evaluateProvider}
        onProviderChange={setEvaluateProvider}
        onClose={() => setIsEvaluateModalOpen(false)}
        onConfirm={() => {
          const sourceRows = currentStep === 8 ? visibleRowsInRefinement : visibleRowsInEvaluation;
          if (sourceRows.length === 0) {
            toast.error('No visible rows on this page to evaluate.');
            return;
          }
          evaluateMutation.mutate({
            provider: evaluateProvider,
            rows: sourceRows,
          });
          setIsEvaluateModalOpen(false);
        }}
        isSubmitting={evaluateMutation.isPending}
      />

      <AutoLabelModal
        isOpen={isAutoLabelModalOpen}
        provider={autoLabelProvider}
        onProviderChange={setAutoLabelProvider}
        onClose={() => setIsAutoLabelModalOpen(false)}
        onConfirm={() => autoLabelPreviewMutation.mutate(autoLabelProvider)}
        isSubmitting={autoLabelPreviewMutation.isPending}
      />

      <ManualEvaluateModal
        isOpen={isManualEvalModalOpen}
        mode={previewMode}
        metricA={manualDraft.metricA}
        metricB={manualDraft.metricB}
        metricC={manualDraft.metricC}
        reason={manualDraft.reason}
        onChange={handleManualDraftChange}
        onClose={() => {
          if (isManualSaving) {
            return;
          }
          setIsManualEvalModalOpen(false);
          setManualTargetRow(null);
        }}
        onConfirm={handleConfirmManualEvaluate}
        isSubmitting={isManualSaving}
      />

      <RefineModal
        isOpen={isRefineModalOpen}
        provider={refineProvider}
        scoreThresholdInput={refineScoreThresholdInput}
        scoreThresholdError={refineScoreThresholdError}
        onProviderChange={setRefineProvider}
        onScoreThresholdInputChange={handleRefineScoreThresholdInputChange}
        onClose={() => setIsRefineModalOpen(false)}
        onConfirm={() => {
          const error = validateRefineScoreThreshold(refineScoreThresholdInput);
          if (error) {
            setRefineScoreThresholdError(error);
            return;
          }

          const threshold = Number(refineScoreThresholdInput);
          setRefineScoreThreshold(threshold);
          refineMutation.mutate({
            provider: refineProvider,
            rows: visibleRowsInRefinement,
            scoreThreshold: threshold,
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

      <ScoreHistoryModal
        isOpen={scoreHistoryModalOpen}
        title={scoreHistoryModalTitle}
        evaluations={scoreHistoryItems}
        onClose={() => setScoreHistoryModalOpen(false)}
      />

      <CompareOverlay
        isOpen={isComparingGroups}
        compareSlot1={compareSlot1}
        compareSlot2={compareSlot2}
        clusterGroups={clusterGroups}
        rows={rowsWithResolvedGroup}
        onClose={handleCloseCompareOverlay}
        onUpdateSlot1={setCompareSlot1}
        onUpdateSlot2={setCompareSlot2}
      />

      <RefineComparisonModal
        isOpen={Boolean(refineComparisonView)}
        title={refineComparisonView?.title || 'Refine Comparison'}
        original={refineComparisonView?.original || ''}
        refined={refineComparisonView?.refined || ''}
        onClose={() => setRefineComparisonView(null)}
      />
    </div>
  );
}
