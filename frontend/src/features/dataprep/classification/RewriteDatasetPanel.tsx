import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Maximize2, Sparkles, X } from 'lucide-react';
import { StepNavigation } from '../../../components/StepNavigation';

type AiProvider = 'gemini' | 'openai' | 'deepseek';
type RewriteTurnDecision = 'original' | 'ai' | 'edited';

export type RewriteTurn = {
  userMessageIndex: number;
  assistantMessageIndex: number;
  user: string;
  assistant: string;
  userLabels: string[];
  assistantLabels: string[];
  expectedActions: string[];
  matched: boolean;
};

export type RewriteTurnDraft = {
  proposal: string;
  editedText: string;
  decision: RewriteTurnDecision;
};

export type RewriteSampleView = {
  rowId: string;
  blockLabel: string;
  turns: RewriteTurn[];
};

type RewriteDatasetPanelProps = {
  rows: RewriteSampleView[];
  provider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
  drafts: Record<string, Record<number, RewriteTurnDraft>>;
  isGenerating: boolean;
  onGenerate: () => void;
  onTurnDecisionChange: (rowId: string, assistantMessageIndex: number, decision: RewriteTurnDecision) => void;
  onTurnEditChange: (rowId: string, assistantMessageIndex: number, value: string) => void;
  onApply: () => void;
  hasApplied: boolean;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

const PROVIDERS: AiProvider[] = ['gemini', 'openai', 'deepseek'];

function summarizeTurn(text: string, maxLength = 140): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized || '-';
  }
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

export function RewriteDatasetPanel({
  rows,
  provider,
  onProviderChange,
  drafts,
  isGenerating,
  onGenerate,
  onTurnDecisionChange,
  onTurnEditChange,
  onApply,
  hasApplied,
  onBack,
  onNext,
  nextDisabled,
}: RewriteDatasetPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedContextTurns, setExpandedContextTurns] = useState<Record<string, boolean>>({});
  const [contentModal, setContentModal] = useState<{
    title: string;
    user: string;
    assistant: string;
  } | null>(null);
  const totalFlaggedTurns = rows.reduce((sum, row) => sum + row.turns.filter((turn) => !turn.matched).length, 0);
  const generatedCount = rows.reduce((sum, row) => {
    const rowDrafts = drafts[row.rowId] || {};
    return sum + row.turns.filter((turn) => !turn.matched && Boolean(rowDrafts[turn.assistantMessageIndex]?.proposal)).length;
  }, 0);
  const selectedCount = rows.reduce((sum, row) => {
    const rowDrafts = drafts[row.rowId] || {};
    return sum + row.turns.filter((turn) => {
      const draft = rowDrafts[turn.assistantMessageIndex];
      return !turn.matched && draft && (draft.decision === 'ai' || draft.decision === 'edited');
    }).length;
  }, 0);
  const currentSample = rows[currentIndex] || null;
  const canGoPrevSample = currentIndex > 0;
  const canGoNextSample = currentIndex < rows.length - 1;
  const currentSampleCounter = rows.length ? `${currentIndex + 1} / ${rows.length}` : '0 / 0';
  const currentSampleDrafts = currentSample ? (drafts[currentSample.rowId] || {}) : {};
  const currentSampleFlaggedCount = currentSample?.turns.filter((turn) => !turn.matched).length || 0;
  const currentSampleSelectedCount = currentSample?.turns.filter((turn) => {
    const draft = currentSampleDrafts[turn.assistantMessageIndex];
    return !turn.matched && draft && (draft.decision === 'ai' || draft.decision === 'edited');
  }).length || 0;

  useEffect(() => {
    if (!rows.length) {
      if (currentIndex !== 0) {
        setCurrentIndex(0);
      }
      return;
    }

    if (currentIndex > rows.length - 1) {
      setCurrentIndex(rows.length - 1);
    }
  }, [currentIndex, rows.length]);

  const currentSampleTurns = useMemo(() => currentSample?.turns || [], [currentSample]);

  const toggleExpandedContextTurn = (key: string) => {
    setExpandedContextTurns((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">Rewrite Review</h3>
            <p className="text-xs text-gray-500">Review mismatched Intent-Action turns. Only assistant messages can be rewritten; user context stays fixed.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as AiProvider)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
            >
              {PROVIDERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <button
              onClick={onGenerate}
              disabled={isGenerating || totalFlaggedTurns === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:bg-gray-300"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate rewrite proposals
            </button>

            <button
              onClick={onApply}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <CheckCircle2 className="h-4 w-4" />
              {hasApplied ? 'Re-apply selected rewrites' : 'Apply selected rewrites'}
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Rewrite samples</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{rows.length}</p>
          </div>
          <div className="rounded-lg bg-indigo-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">Flagged turns with AI draft</p>
            <p className="mt-1 text-xl font-bold text-indigo-700">{generatedCount} / {totalFlaggedTurns}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Selected to apply</p>
            <p className="mt-1 text-xl font-bold text-emerald-700">{selectedCount}</p>
          </div>
        </div>

        {rows.length === 0 || !currentSample ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
            No samples were classified into the Rewrite bucket. You can continue to Evaluation.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">{currentSample.blockLabel}</p>
                  <p className="text-xs text-gray-500">Rewrite sample #{currentIndex + 1}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    {currentSampleFlaggedCount} flagged turn(s)
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    {currentSampleSelectedCount} selected
                  </span>
                </div>
              </div>

              <div className="space-y-4 p-4">
                {currentSampleTurns.map((turn, turnIndex) => {
                  const draft = currentSampleDrafts[turn.assistantMessageIndex];
                  const decision = draft?.decision || 'original';
                  const editedValue = draft?.editedText ?? draft?.proposal ?? '';
                  const turnKey = `${currentSample.rowId}:${turn.userMessageIndex}:${turn.assistantMessageIndex}`;
                  const isExpanded = Boolean(expandedContextTurns[turnKey]);

                  if (turn.matched) {
                    return (
                      <div
                        key={turnKey}
                        className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-gray-600">
                            Turn {turnIndex + 1} • User #{turn.userMessageIndex} {'->'} Assistant #{turn.assistantMessageIndex}
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">
                            Context only
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <div className="rounded-lg border border-blue-100 bg-white px-3 py-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">User summary</p>
                              {(turn.user || '').trim().length > 140 && (
                                <button
                                  type="button"
                                  onClick={() => setContentModal({
                                    title: `Turn ${turnIndex + 1} • User #${turn.userMessageIndex}`,
                                    user: turn.user,
                                    assistant: '',
                                  })}
                                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  Full
                                </button>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-gray-700">
                              {isExpanded ? (turn.user || '-') : summarizeTurn(turn.user)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600">Assistant summary</p>
                              <div className="flex items-center gap-1">
                                {(((turn.user || '').trim().length > 140) || ((turn.assistant || '').trim().length > 140)) && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandedContextTurn(turnKey)}
                                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-100"
                                  >
                                    {isExpanded ? 'Collapse' : 'Expand'}
                                  </button>
                                )}
                                {(turn.assistant || '').trim().length > 140 && (
                                  <button
                                    type="button"
                                    onClick={() => setContentModal({
                                      title: `Turn ${turnIndex + 1} • User #${turn.userMessageIndex} -> Assistant #${turn.assistantMessageIndex}`,
                                      user: turn.user,
                                      assistant: turn.assistant,
                                    })}
                                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-100"
                                  >
                                    <Maximize2 className="h-3 w-3" />
                                    Full
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-gray-700">
                              {isExpanded ? (turn.assistant || '-') : summarizeTurn(turn.assistant)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={`${currentSample.rowId}:${turn.userMessageIndex}:${turn.assistantMessageIndex}`} className="rounded-xl border border-amber-200 bg-amber-50/40">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-3">
                        <div className="text-xs text-gray-600">
                          Turn {turnIndex + 1} • User #{turn.userMessageIndex} {'->'} Assistant #{turn.assistantMessageIndex}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Rewrite required</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                            Intent: {turn.userLabels.join(', ') || '-'}
                          </span>
                          <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">
                            Action: {turn.assistantLabels.join(', ') || '-'}
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                            Expected: {turn.expectedActions.join(', ') || '-'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-3">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-700">User</p>
                          <div className="whitespace-pre-wrap text-sm text-gray-800">{turn.user || '-'}</div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Original assistant</p>
                          <div className="whitespace-pre-wrap text-sm text-gray-800">{turn.assistant || '-'}</div>
                        </div>

                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-700">Assistant rewrite</p>

                          {!draft?.proposal ? (
                            <div className="rounded-lg border border-dashed border-indigo-200 bg-white p-4 text-sm text-gray-500">
                              Generate proposals to review this assistant turn.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => onTurnDecisionChange(currentSample.rowId, turn.assistantMessageIndex, 'original')}
                                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${decision === 'original' ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                  Keep original
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onTurnDecisionChange(currentSample.rowId, turn.assistantMessageIndex, 'ai')}
                                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${decision === 'ai' ? 'bg-emerald-600 text-white' : 'border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'}`}
                                >
                                  Use AI rewrite
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onTurnDecisionChange(currentSample.rowId, turn.assistantMessageIndex, 'edited')}
                                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${decision === 'edited' ? 'bg-amber-500 text-white' : 'border border-amber-300 bg-white text-amber-700 hover:bg-amber-50'}`}
                                >
                                  Edit rewrite
                                </button>
                              </div>

                              {decision === 'edited' ? (
                                <textarea
                                  value={editedValue}
                                  onChange={(event) => onTurnEditChange(currentSample.rowId, turn.assistantMessageIndex, event.target.value)}
                                  rows={7}
                                  className="w-full rounded-lg border border-amber-200 bg-white p-3 text-sm text-gray-800 outline-none focus:border-amber-400"
                                />
                              ) : (
                                <div className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800">
                                  {draft.proposal}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-700">Sample Navigation</h3>
                <span className="text-xs text-gray-500 font-medium bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                  {currentSampleCounter}
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
                  onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, rows.length - 1))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled || isGenerating} />

      {contentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-base font-bold text-gray-900">{contentModal.title}</h3>
              <button
                type="button"
                onClick={() => setContentModal(null)}
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid max-h-[calc(85vh-72px)] grid-cols-1 gap-4 overflow-auto p-5 lg:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-700">User</p>
                <div className="whitespace-pre-wrap text-sm text-gray-800">{contentModal.user || '-'}</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Assistant</p>
                <div className="whitespace-pre-wrap text-sm text-gray-800">{contentModal.assistant || '-'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
