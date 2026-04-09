import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FileUploader } from '../components/FileUploader';
import { ConversionOptions } from '../components/ConversionOptions';
import { Preview } from '../components/Preview';
import { HuggingFaceUpload } from '../components/HuggingFaceUpload';
import { useAppStore } from '../hooks/useAppStore';
import { apiService } from '../services/api';
import type { ConversionResult } from '../types';

type Step = 1 | 2 | 3 | 4 | 5;
type PreviewMode = 'alpaca' | 'openai';

type EvaluationScores = {
  accuracy?: number;
  clarity?: number;
  completeness?: number;
  socratic?: number;
  encouragement?: number;
  factuality?: number;
  overall: number;
  reason: string;
};

type EvaluatedBy = 'manual' | 'gemini';

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
  { id: 3, label: 'Clustering Data' },
  { id: 4, label: 'Evaluation' },
  { id: 5, label: 'Finish' },
];

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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {STEP_CONFIG.map((step) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full border flex items-center justify-center text-sm font-semibold ${isCompleted
                  ? 'bg-green-600 border-green-600 text-white'
                  : isActive
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600'
                  }`}
              >
                {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </div>
              <div>
                <p className="text-xs text-gray-500">Step {step.id}</p>
                <p className={`text-sm font-semibold ${isActive ? 'text-primary-700' : 'text-gray-800'}`}>
                  {step.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConvertedDatasetTable({
  rows,
  mode,
  showEvaluationColumns,
  showEvaluationActions = true,
  evaluationMap,
  selectedManualRows,
  clusterGroups,
  evaluationGroupFilter,
  onEvaluationGroupFilterChange,
  onEvaluate,
  onAccept,
  onReset,
  onToggleManualRow,
  onManualFieldChange,
  isEvaluating,
  disableEvaluate,
  isAccepting,
  onVisibleRowsChange,
}: {
  rows: DisplayRow[];
  mode: PreviewMode;
  showEvaluationColumns?: boolean;
  showEvaluationActions?: boolean;
  evaluationMap?: Record<string, RowEvaluationEntry>;
  selectedManualRows?: Set<string>;
  clusterGroups?: ClusterGroup[];
  evaluationGroupFilter?: 'all' | number;
  onEvaluationGroupFilterChange?: (value: 'all' | number) => void;
  onEvaluate?: () => void;
  onAccept?: () => void;
  onReset?: () => void;
  onToggleManualRow?: (row: DisplayRow, checked: boolean) => void;
  onManualFieldChange?: (row: DisplayRow, field: string, value: string) => void;
  isEvaluating?: boolean;
  disableEvaluate?: boolean;
  isAccepting?: boolean;
  onVisibleRowsChange?: (rows: DisplayRow[]) => void;
}) {
  const PAGE_SIZE_STEPS = [10, 20, 100, 250, 500];
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_STEPS[0]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showAll, setShowAll] = useState<boolean>(false);

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
    onVisibleRowsChange?.(visibleRows);
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

            {showEvaluationColumns && (
              <select
                value={evaluationGroupFilter === 'all' ? 'all' : String(evaluationGroupFilter)}
                onChange={(e) => {
                  const value = e.target.value;
                  onEvaluationGroupFilterChange?.(value === 'all' ? 'all' : Number(value));
                }}
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700"
              >
                <option value="all">All groups</option>
                {(clusterGroups || []).map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    Group {group.groupId} - {group.label} ({group.count})
                  </option>
                ))}
              </select>
            )}
          </div>

          {showEvaluationColumns && showEvaluationActions && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onEvaluate}
                disabled={!hasRows || disableEvaluate || isEvaluating}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white text-xs font-semibold"
              >
                {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Evaluate with Gemini</span>
              </button>

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
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {showEvaluationColumns && <th className="px-4 py-3 w-[48px]" />}
              <th className="text-left px-4 py-3 font-semibold text-gray-700 w-[26%]">
                {mode === 'openai' ? 'User' : 'Instruction'}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 w-[18%]">
                {mode === 'openai' ? '<think>' : 'Input'}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 w-[26%]">
                {mode === 'openai' ? 'Assistant' : 'Output'}
              </th>
              {showEvaluationColumns && (
                <>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricA)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricB)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">{renderMetricHeader(metricC)}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">overall</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-[280px]">reason</th>
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
                  const isManual = selectedManualRows?.has(row.id) || selectedManualRows?.has(row.blockId) || false;
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
                        }`}
                    >
                      {pairIndex === 0 && (
                        <td className="px-4 py-3 align-top" rowSpan={pairs.length}>
                          <input
                            type="checkbox"
                            checked={isManual}
                            onChange={(e) => onToggleManualRow?.(row, e.target.checked)}
                          />
                        </td>
                      )}

                      <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{pair.user || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{pair.think || '-'}</td>
                      <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{pair.assistant || '-'}</td>

                      {pairIndex === 0 && (
                        <>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual ? (
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
                              score?.socratic ?? ''
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual ? (
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
                              score?.encouragement ?? ''
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 align-top" rowSpan={pairs.length}>
                            {isManual ? (
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
                              score?.factuality ?? ''
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 font-semibold align-top" rowSpan={pairs.length}>{score?.overall ?? ''}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words align-top" rowSpan={pairs.length}>
                            {isManual ? (
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
                        <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{pair.user || '-'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{pair.think || '-'}</td>
                        <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{pair.assistant || '-'}</td>
                      </tr>
                    ));
                  })
                  : visibleRows.map((row, index) => {
                    const entry = evaluationMap?.[row.id] || evaluationMap?.[row.blockId];
                    const score = entry?.scores;
                    const isManual = selectedManualRows?.has(row.id) || selectedManualRows?.has(row.blockId) || false;
                    const metricInputClass =
                      'w-20 px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';
                    const reasonInputClass =
                      'w-full min-w-[220px] px-2 py-1 rounded border border-gray-300 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';

                    return (
                      <tr
                        key={row.id}
                        className={`align-top ${row.isBlockLast ? 'border-b-4 border-b-gray-200' : 'border-b border-b-gray-100'
                          } ${index === 0 ? 'border-t border-t-gray-100' : ''} ${isManual ? 'bg-emerald-50' : ''}`}
                      >
                        {showEvaluationColumns && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isManual}
                              onChange={(e) => onToggleManualRow?.(row, e.target.checked)}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{row.userText || '-'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{row.thinkText || '-'}</td>
                        <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{row.assistantText || '-'}</td>
                        {showEvaluationColumns && (
                          <>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual ? (
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
                                score?.accuracy ?? ''
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual ? (
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
                                score?.clarity ?? ''
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {isManual ? (
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
                                score?.completeness ?? ''
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-semibold">{score?.overall ?? ''}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words">
                              {isManual ? (
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
                          </>
                        )}
                      </tr>
                    );
                  })
            ) : (
              <tr>
                <td colSpan={showEvaluationColumns ? 9 : 3} className="px-4 py-10 text-center text-gray-500">
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
  const { uploadedFile, conversionOptions, projectName, setProjectName } = useAppStore();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [originalConvertedResult, setOriginalConvertedResult] = useState<ConversionResult | null>(null);
  const [minOverallScore, setMinOverallScore] = useState<number>(0);
  const [evaluationMap, setEvaluationMap] = useState<Record<string, RowEvaluationEntry>>({});
  const [manualRowIds, setManualRowIds] = useState<Set<string>>(new Set());
  const [clusterGroups, setClusterGroups] = useState<ClusterGroup[]>([]);
  const [rowClusterMap, setRowClusterMap] = useState<Record<string, number>>({});
  const [selectedClusterIds, setSelectedClusterIds] = useState<number[]>([]);
  const [evaluationGroupFilter, setEvaluationGroupFilter] = useState<'all' | number>('all');
  const [filterThreshold, setFilterThreshold] = useState<number>(0.9);
  const [clusteredResult, setClusteredResult] = useState<{
    data: any[];
    assignments: number[];
    groups: ClusterGroup[];
  } | null>(null);
  const [visibleRowsInEvaluation, setVisibleRowsInEvaluation] = useState<DisplayRow[]>([]);

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

  const rowsWithGroups = useMemo(
    () =>
      allRows.map((row) => ({
        ...row,
        groupId: rowClusterMap[row.id] !== undefined ? rowClusterMap[row.id] : row.groupId,
      })),
    [allRows, rowClusterMap]
  );

  const clusteredRows = useMemo(() => {
    if (currentStep === 3 && selectedClusterIds.length > 0) {
      return rowsWithGroups.filter((row) => row.groupId !== undefined && selectedClusterIds.includes(row.groupId));
    }

    if (currentStep >= 4 && evaluationGroupFilter !== 'all') {
      return rowsWithGroups.filter((row) => row.groupId === evaluationGroupFilter);
    }

    return rowsWithGroups;
  }, [currentStep, rowsWithGroups, selectedClusterIds, evaluationGroupFilter]);

  const evaluationRows = useMemo(() => {
    if (currentStep !== 4 || previewMode !== 'openai') {
      return clusteredRows;
    }

    const conversations = normalizeOpenAIConversations(conversionResult?.data || []);
    const groupByConversation = new Map<string, number | undefined>();

    rowsWithGroups.forEach((row) => {
      if (!groupByConversation.has(row.blockId)) {
        groupByConversation.set(row.blockId, row.groupId);
      }
    });

    const filteredConversations = conversations.filter((conv) => {
      if (evaluationGroupFilter === 'all') {
        return true;
      }
      return groupByConversation.get(String(conv.conversation_id)) === evaluationGroupFilter;
    });

    return filteredConversations.map((conv, index) => {
      const pairs: Array<{ user: string; assistant: string }> = [];

      for (let i = 0; i < conv.messages.length; i += 1) {
        const current = conv.messages[i];
        if (current.role !== 'user') {
          continue;
        }

        const nextAssistant = conv.messages.slice(i + 1).find((msg) => msg.role === 'assistant');
        pairs.push({
          user: String(current.content || '').trim(),
          assistant: String(nextAssistant?.content || '').trim(),
        });
      }

      const users = pairs.map((pair) => pair.user).filter(Boolean).join('\n\n');
      const assistants = pairs.map((pair) => pair.assistant || '-').join('\n\n');

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
        userText: users || firstUser || '-',
        thinkText: '-',
        assistantText: assistants || lastAssistant || '-',
        conversationPairs: pairs.length ? pairs : [{ user: firstUser || '-', assistant: lastAssistant || '-' }],
        groupId: groupByConversation.get(String(conv.conversation_id)),
      } as DisplayRow;
    });
  }, [
    clusteredRows,
    conversionResult?.data,
    currentStep,
    evaluationGroupFilter,
    previewMode,
    rowsWithGroups,
  ]);

  const averagedEvaluation = useMemo(() => {
    const values = Object.values(evaluationMap).map((entry) => entry.scores);
    if (values.length === 0) {
      return null;
    }

    const total = values.reduce(
      (acc, item) => {
        acc.accuracy += item.accuracy || 0;
        acc.clarity += item.clarity || 0;
        acc.completeness += item.completeness || 0;
        acc.socratic += item.socratic || 0;
        acc.encouragement += item.encouragement || 0;
        acc.factuality += item.factuality || 0;
        acc.overall += item.overall || 0;
        return acc;
      },
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
      const options =
        mode === 'initial'
          ? { ...conversionOptions, enableCleaning: false }
          : conversionOptions;
      return apiService.convertData(uploadedFile!.fileId, options);
    },
    onSuccess: (data, mode) => {
      setConversionResult(data);
      setEvaluationMap({});
      setManualRowIds(new Set());
      setClusterGroups([]);
      setRowClusterMap({});
      setSelectedClusterIds([]);
      setEvaluationGroupFilter('all');

      if (mode === 'initial') {
        setOriginalConvertedResult(data);
        setCurrentStep(2);
        toast.success('Conversion completed. Continue to cleaning.');
        return;
      }

      toast.success('Cleaning rules applied to the converted dataset.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Conversion failed');
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const rowsToEvaluate = visibleRowsInEvaluation.filter((row) => !manualRowIds.has(row.id));
      if (!rowsToEvaluate.length) {
        throw new Error('No visible rows to evaluate.');
      }

      const newMap: Record<string, RowEvaluationEntry> = {};

      if (previewMode === 'openai') {
        const convOrderedIds: string[] = [];
        const rowsByConv = new Map<string, DisplayRow[]>();
        for (const row of rowsToEvaluate) {
          if (!rowsByConv.has(row.blockId)) {
            rowsByConv.set(row.blockId, []);
            convOrderedIds.push(row.blockId);
          }
          rowsByConv.get(row.blockId)!.push(row);
        }

        // Look up the full messages array from conversionResult.data for each conv
        const normalizedConvs = normalizeOpenAIConversations(conversionResult?.data || []);
        const convMessagesMap = new Map<string, Array<{ role: string; content: string }>>();
        normalizedConvs.forEach((conv) => {
          convMessagesMap.set(String(conv.conversation_id), conv.messages);
        });

        const conversationPayload = convOrderedIds.map((convId) => ({
          conversation_id: convId,
          messages: convMessagesMap.get(convId) || [],
        }));

        const evaluation = await apiService.evaluateData(conversationPayload, previewMode);

        evaluation.samples.forEach((sample, idx) => {
          const convId = convOrderedIds[idx];
          if (!convId) return;

          const isSuccess =
            Number.isFinite(sample.scores.overall) &&
            sample.scores.overall > 0;

          if (!isSuccess) return;

          const score: EvaluationScores = {
            socratic: sample.scores.socratic,
            encouragement: sample.scores.encouragement,
            factuality: sample.scores.factuality,
            overall: sample.scores.overall,
            reason: sample.reason,
          };

          const convRows = rowsByConv.get(convId) || [];
          for (const row of convRows) {
            newMap[row.id] = {
              scores: score,
              evaluatedBy: 'gemini',
            };
          }
        });

      } else {
        const payload = rowsToEvaluate.map((row) => ({
          instruction: row.instruction,
          input: row.input,
          output: row.output,
        }));

        const evaluation = await apiService.evaluateData(payload, previewMode);

        evaluation.samples.forEach((sample, idx) => {
          const row = rowsToEvaluate[idx];
          if (!row) return;

          const isSuccess =
            Number.isFinite(sample.scores.overall) &&
            sample.scores.overall > 0;

          if (!isSuccess) return;

          newMap[row.id] = {
            scores: {
              accuracy: sample.scores.accuracy,
              clarity: sample.scores.clarity,
              completeness: sample.scores.completeness,
              overall: sample.scores.overall,
              reason: sample.reason,
            },
            evaluatedBy: 'gemini',
          };
        });
      }

      setEvaluationMap((prev) => ({ ...prev, ...newMap }));
      return Object.keys(newMap).length;
    },
    onSuccess: (evaluatedCount) => {
      toast.success(`Evaluation completed. ${evaluatedCount} rows scored by Gemini.`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Evaluation failed');
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!uploadedFile) {
        throw new Error('No uploaded file found.');
      }

      if (!conversionResult) {
        throw new Error('No converted data available to save.');
      }

      const createdAt = new Date().toISOString();

      const toResultPayload = (entry: RowEvaluationEntry) => ({
        accuracy: entry.scores.accuracy,
        clarity: entry.scores.clarity,
        completeness: entry.scores.completeness,
        socratic: entry.scores.socratic,
        encouragement: entry.scores.encouragement,
        factuality: entry.scores.factuality,
        overall: entry.scores.overall,
        reason: entry.scores.reason,
      });

      let records: Array<{
        format: string;
        data: Record<string, any>;
        evaluatedBy: EvaluatedBy;
        results: {
          accuracy?: number;
          clarity?: number;
          completeness?: number;
          socratic?: number;
          encouragement?: number;
          factuality?: number;
          overall: number;
          reason: string;
        };
        createdAt: string;
      }> = [];

      if (previewMode === 'openai') {
        const conversations = normalizeOpenAIConversations(conversionResult.data || []);
        const messagesByConversation = new Map<string, Array<{ role: string; content: string }>>();
        conversations.forEach((conv) => {
          messagesByConversation.set(String(conv.conversation_id), conv.messages);
        });

        const rowsByConversation = new Map<string, DisplayRow[]>();
        rowsWithGroups.forEach((row) => {
          if (!rowsByConversation.has(row.blockId)) {
            rowsByConversation.set(row.blockId, []);
          }
          rowsByConversation.get(row.blockId)!.push(row);
        });

        records = Array.from(rowsByConversation.entries())
          .map(([conversationId, rows]) => {
            const conversationEntry = evaluationMap[conversationId];
            const evaluatedRows = rows.filter((row) => !!evaluationMap[row.id] || !!evaluationMap[row.blockId]);
            if (!conversationEntry && evaluatedRows.length === 0) {
              return null;
            }

            const preferredRow =
              evaluatedRows.find((row) => {
                const rowEntry = evaluationMap[row.id] || evaluationMap[row.blockId];
                return rowEntry?.evaluatedBy === 'manual';
              }) || evaluatedRows[0];

            const entry = conversationEntry || (preferredRow
              ? (evaluationMap[preferredRow.id] || evaluationMap[preferredRow.blockId])
              : undefined);
            if (!entry) {
              return null;
            }

            const fallbackMessages = rows
              .flatMap((row) => [
                { role: 'user', content: row.userText || row.instruction || '' },
                { role: 'assistant', content: row.assistantText || row.output || '' },
              ])
              .filter((msg) => msg.content.trim() !== '');

            const messages = (messagesByConversation.get(conversationId) || fallbackMessages).map((msg) => ({
              role: String(msg.role || ''),
              content: String(msg.content || ''),
            }));

            return {
              format: 'openai',
              data: {
                messages,
              },
              evaluatedBy: entry.evaluatedBy,
              results: toResultPayload(entry),
              createdAt,
            };
          })
          .filter(Boolean) as typeof records;
      } else {
        records = rowsWithGroups
          .map((row) => {
            const entry = evaluationMap[row.id];
            if (!entry) {
              return null;
            }

            return {
              format: 'alpaca',
              data: {
                instruction: row.instruction,
                input: row.input,
                output: row.output,
              },
              evaluatedBy: entry.evaluatedBy,
              results: toResultPayload(entry),
              createdAt,
            };
          })
          .filter(Boolean) as typeof records;
      }

      if (!records.length) {
        throw new Error('No evaluated rows to save.');
      }

      await apiService.saveEvaluationResults({
        fileId: uploadedFile.fileId,
        projectName: projectName.trim() || formatDefaultProjectName(),
        items: records,
      });

      return records.length;
    },
    onSuccess: (savedCount) => {
      toast.success(`Accepted and saved ${savedCount} records to MongoDB.`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Accept failed');
    },
  });

  const handleToggleManualRow = (row: DisplayRow, checked: boolean) => {
    const metric1 = previewMode === 'openai' ? 'socratic' : 'accuracy';
    const metric2 = previewMode === 'openai' ? 'encouragement' : 'clarity';
    const metric3 = previewMode === 'openai' ? 'factuality' : 'completeness';

    if (checked) {
      setManualRowIds((prev) => {
        const next = new Set(prev);
        next.add(row.id);
        return next;
      });

      setEvaluationMap((prev) => {
        const existing = prev[row.id]?.scores;

        // Keep the latest visible score if it already exists; only initialize when missing.
        if (existing) {
          return {
            ...prev,
            [row.id]: {
              ...prev[row.id],
              evaluatedBy: 'manual',
            },
          };
        }

        const m1 = clampScore((existing as any)?.[metric1] ?? 0);
        const m2 = clampScore((existing as any)?.[metric2] ?? 0);
        const m3 = clampScore((existing as any)?.[metric3] ?? 0);
        const overall = calculateOverallFromThree(m1, m2, m3);

        return {
          ...prev,
          [row.id]: {
            scores: {
              [metric1]: m1,
              [metric2]: m2,
              [metric3]: m3,
              overall,
              reason: '',
            },
            evaluatedBy: 'manual',
          },
        };
      });
      return;
    }

    setManualRowIds((prev) => {
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
  };

  const handleManualFieldChange = (row: DisplayRow, field: string, value: string) => {
    if (!manualRowIds.has(row.id)) {
      return;
    }

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

      return {
        ...prev,
        [row.id]: {
          scores: nextScores,
          evaluatedBy: 'manual',
        },
      };
    });
  };

  const handleResetEvaluation = () => {
    setEvaluationMap({});
    setManualRowIds(new Set());
    toast.success('Evaluation results have been reset.');
  };

  useEffect(() => {
    setCurrentStep(1);
    setConversionResult(null);
    setOriginalConvertedResult(null);
    setEvaluationMap({});
    setManualRowIds(new Set());
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setClusteredResult(null);
    setEvaluationGroupFilter('all');
    setVisibleRowsInEvaluation([]);
    if (uploadedFile?.fileId) {
      setProjectName(formatDefaultProjectName());
    } else {
      setProjectName('');
    }
  }, [uploadedFile?.fileId]);

  const canMoveFromStep2 = !!conversionResult;
  const canMoveFromStep3 = clusterGroups.length > 0;
  const canMoveFromStep4 = !!conversionResult;

  const handleDownload = () => {
    if (!conversionResult) {
      return;
    }

    const { data, filename } = conversionResult;
    const isJsonl = filename.endsWith('.jsonl');

    let output: string;
    const cleanData = data.map(({ cluster, assignments, clusterLabel, groupId, ...rest }: any) => rest);

    if (isJsonl) {
      // JSONL format: mỗi dòng là một JSON object
      output = cleanData.map((item: any) => JSON.stringify(item)).join('\n');
    } else {
      // JSON format: array of objects
      output = JSON.stringify(cleanData, null, 2);
    }

    const blob = new Blob([output], {
      type: isJsonl ? 'application/x-ndjson' : 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('File downloaded.');
  };

  const handleDownloadFilteredByScore = () => {
    if (!conversionResult) {
      return;
    }

    const threshold = Math.round(minOverallScore * 10) / 10;
    let filtered: any[] = [];

    if (previewMode === 'openai') {
      const conversations = normalizeOpenAIConversations(conversionResult.data || []);

      filtered = conversations
        .map((conv) => {
          const conversationId = String(conv.conversation_id);
          const fromConversation = evaluationMap[conversationId];
          const fromRows = rowsWithGroups.find(
            (row) => row.blockId === conversationId && !!evaluationMap[row.id]
          );
          const entry = fromConversation || (fromRows ? evaluationMap[fromRows.id] : undefined);

          if (!entry || !Number.isFinite(entry.scores.overall) || entry.scores.overall < threshold) {
            return null;
          }

          return {
            messages: conv.messages,
          };
        })
        .filter(Boolean) as any[];
    } else {
      filtered = rowsWithGroups
        .map((row) => {
          const entry = evaluationMap[row.id] || evaluationMap[row.blockId];
          if (!entry || !Number.isFinite(entry.scores.overall) || entry.scores.overall < threshold) {
            return null;
          }

          return {
            instruction: row.instruction,
            input: row.input,
            output: row.output,
          };
        })
        .filter(Boolean) as any[];
    }

    if (filtered.length === 0) {
      toast.error('No evaluated samples match the selected overall score.');
      return;
    }

    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `filtered_${previewMode}_overall_gte_${threshold.toFixed(1)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Downloaded ${filtered.length} samples with overall >= ${threshold.toFixed(1)}.`);
  };

  const handleResetCleaning = () => {
    if (!originalConvertedResult) {
      return;
    }

    setConversionResult(originalConvertedResult);
    setEvaluationMap({});
    setManualRowIds(new Set());
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setEvaluationGroupFilter('all');
    setClusteredResult(null);
    toast.success('Dataset reset to original converted state.');
  };

  const clusterMutation = useMutation({
    mutationFn: async () => {
      if (!conversionResult?.data || conversionResult.data.length === 0) {
        throw new Error('No converted data to cluster.');
      }
      return apiService.clusterData(conversionResult.data);
    },
    onSuccess: (result) => {
      setConversionResult((prev) => (prev ? { ...prev, data: result.data } : null));
      setClusteredResult(result);
      setClusterGroups(result.groups);

      // Restore old mapping method for UI
      const nextMap: Record<string, number> = {};
      if (previewMode === 'openai') {
        // Map assignments từ Python (theo index conversation) sang row IDs
        const conversations = normalizeOpenAIConversations(conversionResult!.data);
        let assignmentIdx = 0;
        conversations.forEach((conv) => {
          const groupId = result.assignments[assignmentIdx] ?? 0;
          // Tìm tất cả rows thuộc conversation này
          rowsWithGroups.forEach((row) => {
            if (row.blockId === String(conv.conversation_id)) {
              nextMap[row.id] = groupId;
            }
          });
          assignmentIdx++;
        });
      } else {
        // Alpaca mode: 1 dataset item = 1 row
        allRows.forEach((row, index) => {
          nextMap[row.id] = result.assignments[index] ?? 0;
        });
      }

      // Recompute group counts dựa trên display rows (QA pairs) thay vì conversations
      const rowCountByGroup = new Map<number, number>();
      Object.values(nextMap).forEach((gId) => {
        rowCountByGroup.set(gId, (rowCountByGroup.get(gId) || 0) + 1);
      });

      const groupsWithRowCounts = result.groups.map((g: any) => ({
        ...g,
        count: rowCountByGroup.get(g.groupId) ?? g.count,
      }));

      setRowClusterMap(nextMap);
      setClusterGroups(groupsWithRowCounts);
      setSelectedClusterIds([]);
      setEvaluationGroupFilter('all');

      const countLabel = previewMode === 'openai' ? 'conversations' : 'records';
      const itemsCount = previewMode === 'openai'
        ? normalizeOpenAIConversations(conversionResult!.data).length
        : conversionResult!.data.length;
      toast.success(`Clustered ${itemsCount} ${countLabel} into ${result.groups.length} groups.`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Clustering failed');
    },
  });

  const filterMutation = useMutation({
    mutationFn: async () => {
      if (!conversionResult?.data || conversionResult.data.length === 0) {
        throw new Error('No clustered data to filter.');
      }
      return apiService.clusterFilter(conversionResult.data, filterThreshold);
    },
    onSuccess: (result) => {
      setConversionResult((prev) => (prev ? { ...prev, data: result.data } : null));
      setClusterGroups(result.groups);

      // Synchronize mapping for filtered data
      const nextMap: Record<string, number> = {};
      if (previewMode === 'openai') {
        const conversations = normalizeOpenAIConversations(result.data);
        conversations.forEach((conv, idx) => {
          const groupId = result.assignments[idx] ?? 0;
          // Note: Since allRows will refresh after setConversionResult,
          // we use nextMap keys that match the conversation IDs used as row IDs.
          nextMap[String(conv.conversation_id)] = groupId;
        });
      } else {
        // Alpaca uses indices directly
        result.data.forEach((item, idx) => {
          nextMap[`alpaca-${idx}`] = (item as any).cluster ?? result.assignments[idx] ?? 0;
        });
      }

      setRowClusterMap(nextMap);
      setSelectedClusterIds([]);
      setEvaluationGroupFilter('all');

      const countLabel = previewMode === 'openai' ? 'conversations' : 'records';
      toast.success(`Filtered dataset down to ${result.data.length} ${countLabel}.`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Filtering failed');
    },
  });

  const handleResetFiltering = () => {
    if (!clusteredResult) return;

    setConversionResult((prev) => prev ? { ...prev, data: clusteredResult.data } : null);
    setClusterGroups(clusteredResult.groups);

    const nextMap: Record<string, number> = {};
    if (previewMode === 'openai') {
      const conversations = normalizeOpenAIConversations(clusteredResult.data);
      conversations.forEach((conv, idx) => {
        const groupId = clusteredResult.assignments[idx] ?? 0;
        allRows.forEach((row) => {
          if (row.blockId === String(conv.conversation_id)) {
            nextMap[row.id] = groupId;
          }
        });
      });
    } else {
      allRows.forEach((row, idx) => {
        nextMap[row.id] = clusteredResult.assignments[idx] ?? 0;
      });
    }

    setRowClusterMap(nextMap);
    setSelectedClusterIds([]);
    setEvaluationGroupFilter('all');
    toast.success('Reset to pre-filter clustered state.');
  };

  const toggleClusterSelection = (groupId: number) => {
    setSelectedClusterIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
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
                <label htmlFor="projectName" className="block text-sm font-semibold text-gray-800">
                  Project Name
                </label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={formatDefaultProjectName()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <p className="text-xs text-gray-500">
                  Gợi ý: {formatDefaultProjectName()}.
                </p>
              </div>
              <FileStatisticsCard stats={stats} />
              <Preview />
              <ConversionOptions />

              <button
                onClick={() => convertMutation.mutate('initial')}
                disabled={convertMutation.isPending}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-xl shadow-lg shadow-primary-200 transition-all active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
              >
                {convertMutation.isPending ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Processing Dataset...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-6 h-6" />
                    <span>Convert Dataset</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {currentStep === 2 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable rows={clusteredRows} mode={previewMode} />
            </div>

            <div className="space-y-4 lg:col-span-1">
              <PostConversionSummary result={conversionResult} />
              <CleaningPipelineOptions
                onAccept={() => convertMutation.mutate('clean')}
                isLoading={convertMutation.isPending}
              />

              <div className="flex justify-end mt-2">
                <button
                  onClick={handleResetCleaning}
                  disabled={!originalConvertedResult || convertMutation.isPending}
                  className="px-4 py-2 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60 font-semibold text-gray-700"
                >
                  Reset to Original
                </button>
              </div>
            </div>
          </div>

          <StepNavigation
            showBack
            showNext
            onBack={() => setCurrentStep(1)}
            onNext={() => setCurrentStep(3)}
            nextDisabled={!canMoveFromStep2}
          />
        </div>
      )}

      {currentStep === 3 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable rows={clusteredRows} mode={previewMode} />
            </div>

            <div className="space-y-4 lg:col-span-1">
              <button
                onClick={() => clusterMutation.mutate()}
                disabled={!conversionResult || clusterMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold transition-colors"
              >
                {clusterMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Clustering...</span>
                  </>
                ) : (
                  <span>Cluster</span>
                )}
              </button>

              {clusterGroups.length > 0 && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700">Similarity Threshold</label>
                    <span className="text-sm font-mono bg-white px-2 py-0.5 rounded border border-gray-200">{filterThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterThreshold}
                    onChange={(e) => setFilterThreshold(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                  />
                  <p className="text-[10px] text-gray-500 leading-tight">
                    Higher threshold (e.g. 0.95) keeps more samples. Lower threshold filters more aggressively.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => filterMutation.mutate()}
                      disabled={filterMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold transition-colors"
                    >
                      {filterMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Filtering Noise...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Filter Noise</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleResetFiltering}
                      disabled={filterMutation.isPending}
                      className="px-4 py-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-semibold transition-colors flex items-center gap-2"
                      title="Reset noise filter"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Reset Filter</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Removed restrictive OpenAI-only message */}

              {clusterGroups.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-900">Cluster Statistics</h3>
                    <p className="text-xs text-gray-600 mt-1">Select groups to filter preview table.</p>
                  </div>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Select</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Group</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Label</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-700">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusterGroups.map((group) => (
                          <tr key={group.groupId} className="border-t border-gray-100">
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={selectedClusterIds.includes(group.groupId)}
                                onChange={() => toggleClusterSelection(group.groupId)}
                              />
                            </td>
                            <td className="px-4 py-2 font-medium text-gray-800">Group {group.groupId}</td>
                            <td className="px-4 py-2 text-gray-700">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${group.label === 'Chuyên môn'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-green-100 text-green-800'
                                }`}>
                                {group.label === 'Chuyên môn' ? '📘' : '💬'} {group.label}
                              </span>
                            </td>
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

          <StepNavigation
            showBack
            showNext
            onBack={() => setCurrentStep(2)}
            onNext={() => setCurrentStep(4)}
            nextDisabled={!canMoveFromStep3}
          />
        </div>
      )}

      {currentStep === 4 && (
        <div className="space-y-5">
          <ConvertedDatasetTable
            rows={evaluationRows}
            mode={previewMode}
            showEvaluationColumns
            evaluationMap={evaluationMap}
            selectedManualRows={manualRowIds}
            clusterGroups={clusterGroups}
            evaluationGroupFilter={evaluationGroupFilter}
            onEvaluationGroupFilterChange={setEvaluationGroupFilter}
            onEvaluate={() => evaluateMutation.mutate()}
            onAccept={() => acceptMutation.mutate()}
            onReset={handleResetEvaluation}
            onToggleManualRow={handleToggleManualRow}
            onManualFieldChange={handleManualFieldChange}
            isEvaluating={evaluateMutation.isPending}
            disableEvaluate={!conversionResult || visibleRowsInEvaluation.length === 0}
            isAccepting={acceptMutation.isPending}
            onVisibleRowsChange={setVisibleRowsInEvaluation}
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

          <StepNavigation
            showBack
            showNext
            onBack={() => setCurrentStep(3)}
            onNext={() => setCurrentStep(5)}
            nextDisabled={!canMoveFromStep4}
          />
        </div>
      )}

      {currentStep === 5 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable
                rows={clusteredRows}
                mode={previewMode}
                showEvaluationColumns
                showEvaluationActions={false}
                evaluationMap={evaluationMap}
              />
            </div>

            <div className="space-y-4 lg:col-span-1">
              <button
                onClick={handleDownload}
                disabled={!conversionResult}
                className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-4 px-6 rounded-xl shadow-md transition-all active:scale-[0.98]"
              >
                <Download className="w-5 h-5" />
                <span>Download Converted File</span>
              </button>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 flex gap-2">
                <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Use the form below to push your final dataset to Hugging Face Hub.
                </p>
              </div>

              {uploadedFile && conversionResult && (
                <HuggingFaceUpload conversionResult={conversionResult} />
              )}

              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Filter by overall score</h3>
                <p className="text-xs text-gray-600">
                  Download only evaluated samples with overall score greater than or equal to the selected value.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>Threshold</span>
                    <span className="font-semibold text-gray-900">{minOverallScore.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={minOverallScore}
                    onChange={(e) => setMinOverallScore(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>0.0</span>
                    <span>10.0</span>
                  </div>
                </div>

                <button
                  onClick={handleDownloadFilteredByScore}
                  disabled={!conversionResult}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-4 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  <span>Download filtered file</span>
                </button>
              </div>
            </div>
          </div>

          <StepNavigation showBack onBack={() => setCurrentStep(4)} />
        </div>
      )}
    </div>
  );
}
