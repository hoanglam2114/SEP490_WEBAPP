import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  Loader2,
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
  alignment?: number;
  factuality?: number;
  overall: number;
  reason: string;
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
  groupId?: number;
};

type ClusterGroup = {
  groupId: number;
  count: number;
};

const STEP_CONFIG: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Upload & Convert' },
  { id: 2, label: 'Clean Data' },
  { id: 3, label: 'Clustering Data' },
  { id: 4, label: 'Evaluation' },
  { id: 5, label: 'Finish' },
];

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

      pairs.forEach((pair, pairIndex) => {
        const rowId = `${conv.conversation_id}-${pairIndex}`;
        rows.push({
          id: rowId,
          blockId: String(conv.conversation_id),
          blockLabel: `Conversation ${convIndex + 1}`,
          isBlockLast: pairIndex === pairs.length - 1,
          instruction: pair.user,
          input: pair.think,
          output: pair.assistant,
          userText: pair.user,
          thinkText: pair.think,
          assistantText: pair.assistant,
        });
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
                className={`w-9 h-9 rounded-full border flex items-center justify-center text-sm font-semibold ${
                  isCompleted
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
  evaluationMap,
  onVisibleRowsChange,
}: {
  rows: DisplayRow[];
  mode: PreviewMode;
  showEvaluationColumns?: boolean;
  evaluationMap?: Record<string, EvaluationScores>;
  onVisibleRowsChange?: (rows: DisplayRow[]) => void;
}) {
  const PAGE_SIZE_STEPS = [100, 250, 500, 1000, 2000];
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

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAll((prev) => !prev)}
            disabled={totalRows === 0}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
          >
            {showAll ? 'Use Pagination' : 'Show All'}
          </button>
          <button
            onClick={handleIncreaseLimit}
            disabled={totalRows === 0 || showAll || !canIncreaseLimit}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60 text-xs font-semibold text-gray-700"
          >
            Increase Limit ({pageSize})
          </button>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
            disabled={totalRows === 0 || showAll}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-60 text-xs font-semibold text-gray-700"
          >
            {PAGE_SIZE_STEPS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-auto max-h-[680px]">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
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
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">
                    {mode === 'openai' ? 'socratic' : 'accuracy'}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">
                    {mode === 'openai' ? 'alignment' : 'clarity'}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">
                    {mode === 'openai' ? 'factuality' : 'completeness'}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">overall</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-[280px]">reason</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? (
              visibleRows.map((row, index) => {
                const score = evaluationMap?.[row.id];
                return (
                  <tr
                    key={row.id}
                    className={`align-top ${
                      row.isBlockLast ? 'border-b-4 border-b-gray-200' : 'border-b border-b-gray-100'
                    } ${index === 0 ? 'border-t border-t-gray-100' : ''}`}
                  >
                    <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{row.userText || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-pre-wrap break-words">{row.thinkText || '-'}</td>
                    <td className="px-4 py-3 text-gray-800 whitespace-pre-wrap break-words">{row.assistantText || '-'}</td>
                    {showEvaluationColumns && (
                      <>
                        <td className="px-4 py-3 text-gray-700">
                          {mode === 'openai' ? (score?.socratic ?? '') : (score?.accuracy ?? '')}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {mode === 'openai' ? (score?.alignment ?? '') : (score?.clarity ?? '')}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {mode === 'openai' ? (score?.factuality ?? '') : (score?.completeness ?? '')}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-semibold">{score?.overall ?? ''}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-pre-wrap break-words">{score?.reason ?? ''}</td>
                      </>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={showEvaluationColumns ? 8 : 3} className="px-4 py-10 text-center text-gray-500">
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
                checked={conversionOptions.deduplicate ?? true}
                onChange={(e) => updateConversionOptions({ deduplicate: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Deduplicate records</span>
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
  const { uploadedFile, conversionOptions } = useAppStore();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [originalConvertedResult, setOriginalConvertedResult] = useState<ConversionResult | null>(null);
  const [evaluationMap, setEvaluationMap] = useState<Record<string, EvaluationScores>>({});
  const [clusterGroups, setClusterGroups] = useState<ClusterGroup[]>([]);
  const [rowClusterMap, setRowClusterMap] = useState<Record<string, number>>({});
  const [selectedClusterIds, setSelectedClusterIds] = useState<number[]>([]);
  const [evaluationGroupFilter, setEvaluationGroupFilter] = useState<'all' | number>('all');
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
    () => allRows.map((row) => ({ ...row, groupId: rowClusterMap[row.id] })),
    [allRows, rowClusterMap]
  );

  const clusteredRows = useMemo(() => {
    if (currentStep === 3 && selectedClusterIds.length > 0) {
      return rowsWithGroups.filter((row) => row.groupId && selectedClusterIds.includes(row.groupId));
    }

    if (currentStep >= 4 && evaluationGroupFilter !== 'all') {
      return rowsWithGroups.filter((row) => row.groupId === evaluationGroupFilter);
    }

    return rowsWithGroups;
  }, [currentStep, rowsWithGroups, selectedClusterIds, evaluationGroupFilter]);

  const averagedEvaluation = useMemo(() => {
    const values = Object.values(evaluationMap);
    if (values.length === 0) {
      return null;
    }

    const total = values.reduce(
      (acc, item) => {
        acc.accuracy += item.accuracy || 0;
        acc.clarity += item.clarity || 0;
        acc.completeness += item.completeness || 0;
        acc.socratic += item.socratic || 0;
        acc.alignment += item.alignment || 0;
        acc.factuality += item.factuality || 0;
        acc.overall += item.overall || 0;
        return acc;
      },
      { accuracy: 0, clarity: 0, completeness: 0, socratic: 0, alignment: 0, factuality: 0, overall: 0 }
    );

    const size = values.length;
    return {
      count: size,
      accuracy: Number((total.accuracy / size).toFixed(2)),
      clarity: Number((total.clarity / size).toFixed(2)),
      completeness: Number((total.completeness / size).toFixed(2)),
      socratic: Number((total.socratic / size).toFixed(2)),
      alignment: Number((total.alignment / size).toFixed(2)),
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
      const rowsToEvaluate = visibleRowsInEvaluation;
      if (!rowsToEvaluate.length) {
        throw new Error('No visible rows to evaluate.');
      }

      const payload = rowsToEvaluate.map((row) => ({
        instruction: row.instruction,
        input: row.input,
        output: row.output,
      }));

      const evaluation = await apiService.evaluateData(payload, previewMode);

      const successfulRows: Array<{
        rowId: string;
        groupId?: number;
        instruction: string;
        output: string;
        scores: {
          accuracy?: number;
          clarity?: number;
          completeness?: number;
          socratic?: number;
          alignment?: number;
          factuality?: number;
          overall: number;
        };
        reason: string;
      }> = [];

      const newMap: Record<string, EvaluationScores> = {};
      evaluation.samples.forEach((sample, idx) => {
        const row = rowsToEvaluate[idx];
        if (!row) {
          return;
        }

        const isSuccess =
          Number.isFinite(sample.scores.overall) &&
          sample.scores.overall > 0;

        if (!isSuccess) {
          return;
        }

        newMap[row.id] = {
          accuracy: sample.scores.accuracy,
          clarity: sample.scores.clarity,
          completeness: sample.scores.completeness,
          socratic: sample.scores.socratic,
          alignment: sample.scores.alignment,
          factuality: sample.scores.factuality,
          overall: sample.scores.overall,
          reason: sample.reason,
        };

        successfulRows.push({
          rowId: row.id,
          groupId: row.groupId,
          instruction: row.instruction,
          output: row.output,
          scores: sample.scores,
          reason: sample.reason,
        });
      });

      setEvaluationMap((prev) => ({ ...prev, ...newMap }));

      if (successfulRows.length > 0 && uploadedFile) {
        await apiService.saveEvaluationResults({
          fileId: uploadedFile.fileId,
          format: previewMode,
          dataGroup: evaluationGroupFilter,
          results: successfulRows,
        });
      }

      return successfulRows.length;
    },
    onSuccess: (savedCount) => {
      toast.success(`Evaluation completed. ${savedCount} rows saved.`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Evaluation failed');
    },
  });

  useEffect(() => {
    setCurrentStep(1);
    setConversionResult(null);
    setOriginalConvertedResult(null);
    setEvaluationMap({});
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setEvaluationGroupFilter('all');
    setVisibleRowsInEvaluation([]);
  }, [uploadedFile?.fileId]);

  const canMoveFromStep2 = !!conversionResult;
  const canMoveFromStep3 = clusterGroups.length > 0;
  const canMoveFromStep4 = !!conversionResult;

  const handleDownload = () => {
    if (!conversionResult) {
      return;
    }

    const blob = new Blob([conversionResult.output], {
      type: conversionResult.filename.endsWith('.jsonl')
        ? 'application/x-ndjson'
        : 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = conversionResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('File downloaded.');
  };

  const handleResetCleaning = () => {
    if (!originalConvertedResult) {
      return;
    }

    setConversionResult(originalConvertedResult);
    setEvaluationMap({});
    setClusterGroups([]);
    setRowClusterMap({});
    setSelectedClusterIds([]);
    setEvaluationGroupFilter('all');
    toast.success('Dataset reset to original converted state.');
  };

  const handleMockCluster = () => {
    if (!rowsWithGroups.length) {
      toast.error('No records available to cluster.');
      return;
    }

    const nextMap: Record<string, number> = {};
    const statsMap = new Map<number, number>();

    rowsWithGroups.forEach((row, index) => {
      const groupId = Math.floor(index / 300) + 1;
      nextMap[row.id] = groupId;
      statsMap.set(groupId, (statsMap.get(groupId) || 0) + 1);
    });

    const groups = Array.from(statsMap.entries())
      .map(([groupId, count]) => ({ groupId, count }))
      .sort((a, b) => a.groupId - b.groupId);

    setRowClusterMap(nextMap);
    setClusterGroups(groups);
    setSelectedClusterIds([]);
    setEvaluationGroupFilter('all');
    toast.success(`Clustered ${rowsWithGroups.length} rows into ${groups.length} groups (300 rows/group).`);
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
                onClick={handleMockCluster}
                disabled={!conversionResult}
                className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold"
              >
                Cluster
              </button>

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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ConvertedDatasetTable
                rows={clusteredRows}
                mode={previewMode}
                showEvaluationColumns
                evaluationMap={evaluationMap}
                onVisibleRowsChange={setVisibleRowsInEvaluation}
              />
            </div>

            <div className="space-y-4 lg:col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <label className="block text-sm font-medium text-gray-800">Data group</label>
                <select
                  value={evaluationGroupFilter === 'all' ? 'all' : String(evaluationGroupFilter)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEvaluationGroupFilter(value === 'all' ? 'all' : Number(value));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="all">All groups</option>
                  {clusterGroups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      Group {group.groupId} ({group.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <button
                  onClick={() => evaluateMutation.mutate()}
                  disabled={!conversionResult || evaluateMutation.isPending || visibleRowsInEvaluation.length === 0}
                  className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all active:scale-[0.98]"
                >
                  {evaluateMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Evaluating visible rows...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-5 h-5" />
                      <span>Evaluate with Gemini</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-600">
                  Current request will evaluate only rows shown in preview after filters and pagination.
                </p>

                {averagedEvaluation && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
                    <p className="font-semibold">Average scores ({averagedEvaluation.count} rows)</p>
                    <p className="mt-1">
                      {previewMode === 'openai' 
                        ? `socratic: ${averagedEvaluation.socratic} | alignment: ${averagedEvaluation.alignment} | factuality: ${averagedEvaluation.factuality} | overall: ${averagedEvaluation.overall}`
                        : `accuracy: ${averagedEvaluation.accuracy} | clarity: ${averagedEvaluation.clarity} | completeness: ${averagedEvaluation.completeness} | overall: ${averagedEvaluation.overall}`
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

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
              <ConvertedDatasetTable rows={clusteredRows} mode={previewMode} showEvaluationColumns evaluationMap={evaluationMap} />
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

              {uploadedFile && <HuggingFaceUpload />}
            </div>
          </div>

          <StepNavigation showBack onBack={() => setCurrentStep(4)} />
        </div>
      )}
    </div>
  );
}
