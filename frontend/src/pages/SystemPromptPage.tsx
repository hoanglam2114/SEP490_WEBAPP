import React, { useEffect, useMemo, useState } from 'react';

type PromptVersionItem = {
  _id: string;
  projectName: string;
  version: number;
  content: string;
  description?: string;
  createdAt: string;
  isUsed?: boolean;
};

type SelectedPromptPayload = {
  promptId: string;
  systemPromptVersion: string;
  content: string;
};

type SystemPromptPageProps = {
  systemPromptText?: string;
  onSystemPromptTextChange?: (value: string) => void;
  onSelectedPromptVersionChange?: (payload: SelectedPromptPayload) => void;
  previewJson?: Record<string, any> | null;
  projectName?: string;
};

export const SystemPromptPage: React.FC<SystemPromptPageProps> = ({
  systemPromptText = '',
  onSystemPromptTextChange,
  onSelectedPromptVersionChange,
  previewJson,
  projectName = 'default-project',
}) => {
  const [content, setContent] = useState(systemPromptText);
  const [description, setDescription] = useState('');
  const [historyList, setHistoryList] = useState<PromptVersionItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activePreviewSource, setActivePreviewSource] = useState<'editor' | 'history'>('editor');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState<string | null>(null);
  const [confirmDeletePromptId, setConfirmDeletePromptId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const HISTORY_PAGE_SIZE = 7;

  const selectedHistory = useMemo(
    () => historyList.find((item) => item._id === selectedHistoryId) || null,
    [historyList, selectedHistoryId]
  );

  const confirmDeletePrompt = useMemo(
    () => historyList.find((item) => item._id === confirmDeletePromptId) || null,
    [confirmDeletePromptId, historyList]
  );

  const filteredHistoryList = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return historyList;
    }

    const tokens = keyword.split(/\s+/).filter(Boolean);

    return historyList.filter((item) => {
      const descriptionText = String(item.description || '').toLowerCase();
      const versionText = String(item.version || '');
      const versionLabel = `v${versionText}`;
      const searchableText = `${descriptionText} ${versionText} ${versionLabel}`;

      return tokens.every((token) => {
        if (/^v\d+$/.test(token)) {
          const numericPart = token.slice(1);
          return versionLabel.includes(token) || versionText.includes(numericPart);
        }

        if (/^\d+$/.test(token)) {
          return versionText.includes(token) || descriptionText.includes(token);
        }

        return searchableText.includes(token);
      });
    });
  }, [historyList, searchTerm]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredHistoryList.length / HISTORY_PAGE_SIZE));
  }, [filteredHistoryList.length]);

  const pagedHistoryList = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistoryList.slice(start, start + HISTORY_PAGE_SIZE);
  }, [currentPage, filteredHistoryList]);

  const activePreviewText = useMemo(() => {
    if (activePreviewSource === 'history' && selectedHistory) {
      return String(selectedHistory.content || '');
    }
    return String(content || '');
  }, [activePreviewSource, content, selectedHistory]);

  const derivedPreviewJson = useMemo(() => {
    const trimmedPrompt = activePreviewText.trim();
    if (!previewJson) {
      if (!trimmedPrompt) {
        return null;
      }
      return {
        messages: [{ role: 'system', content: trimmedPrompt }],
      };
    }

    const base = previewJson as Record<string, any>;
    const messages = Array.isArray(base.messages)
      ? base.messages.map((msg: any) => ({
          role: String(msg?.role || ''),
          content: String(msg?.content || ''),
        }))
      : [];

    if (!trimmedPrompt) {
      return {
        ...base,
        messages,
      };
    }

    const firstSystemIndex = messages.findIndex((msg: { role: string; content: string }) => msg.role === 'system');
    const nextMessages = [...messages];
    if (firstSystemIndex >= 0) {
      nextMessages[firstSystemIndex] = {
        ...nextMessages[firstSystemIndex],
        content: trimmedPrompt,
      };
    } else {
      nextMessages.unshift({ role: 'system', content: trimmedPrompt });
    }

    return {
      ...base,
      messages: nextMessages,
    };
  }, [activePreviewText, previewJson]);

  useEffect(() => {
    setContent(systemPromptText || '');
  }, [systemPromptText]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (currentPage <= totalPages) {
      return;
    }
    setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!selectedHistory || !onSelectedPromptVersionChange) {
      return;
    }

    onSelectedPromptVersionChange({
      promptId: selectedHistory._id,
      systemPromptVersion: `V${selectedHistory.version}`,
      content: selectedHistory.content || '',
    });
  }, [onSelectedPromptVersionChange, selectedHistory]);

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      setError('');

      try {
        const response = await fetch(`/api/prompts/project/${encodeURIComponent(projectName)}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch history: ${response.status}`);
        }

        const data = (await response.json()) as PromptVersionItem[];
        if (!isMounted) {
          return;
        }

        setHistoryList(data);
        setSelectedHistoryId(data[0]?._id || null);
      } catch (loadError: any) {
        if (!isMounted) {
          return;
        }
        setError(loadError?.message || 'Failed to load prompt history');
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [projectName]);

  const handleContentChange = (value: string) => {
    setActivePreviewSource('editor');
    setContent(value);
    if (onSystemPromptTextChange) {
      onSystemPromptTextChange(value);
    }
  };

  const handleSaveNewVersion = async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError('Current Prompt content is required');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName,
          content: trimmedContent,
          description: description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const message = errorPayload?.message || `Failed to save prompt: ${response.status}`;
        throw new Error(message);
      }

      const created = (await response.json()) as PromptVersionItem;
      setHistoryList((prev) => [created, ...prev]);
      setSelectedHistoryId(created._id);
      setCurrentPage(1);
      setDescription('');

      if (onSelectedPromptVersionChange) {
        onSelectedPromptVersionChange({
          promptId: created._id,
          systemPromptVersion: `V${created.version}`,
          content: created.content || '',
        });
      }
    } catch (saveError: any) {
      setError(saveError?.message || 'Failed to save new version');
    } finally {
      setIsSaving(false);
    }
  };

  const requestDeletePrompt = (promptId: string) => {
    if (deletingPromptId) {
      return;
    }

    setConfirmDeletePromptId(promptId);
  };

  const handleDeletePrompt = async () => {
    if (!confirmDeletePromptId) {
      return;
    }

    const promptId = confirmDeletePromptId;

    setDeletingPromptId(promptId);
    setError('');

    try {
      const response = await fetch(`/api/prompts/${encodeURIComponent(promptId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const message = errorPayload?.message || `Failed to delete prompt: ${response.status}`;
        throw new Error(message);
      }

      setHistoryList((prev) => {
        const next = prev.filter((item) => item._id !== promptId);
        if (selectedHistoryId === promptId) {
          setSelectedHistoryId(next[0]?._id || null);
        }
        return next;
      });
      setConfirmDeletePromptId(null);
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Failed to delete prompt');
    } finally {
      setDeletingPromptId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">System Prompt Versioning</h3>
        <p className="mt-1 text-sm text-gray-600">
          Manage prompt history on the left and draft a new prompt version on the right.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="lg:col-span-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">History</h4>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {filteredHistoryList.length} versions
            </span>
          </div>

          <div className="mb-3">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by description or version "
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="flex min-h-[520px] flex-col justify-between">
            <div className="space-y-2">
              {isLoadingHistory && <p className="text-sm text-gray-500">Loading prompt history...</p>}

              {!isLoadingHistory && historyList.length === 0 && (
                <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500">
                  No versions found for this project.
                </p>
              )}

              {!isLoadingHistory && historyList.length > 0 && filteredHistoryList.length === 0 && (
                <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500">
                  No versions match this description.
                </p>
              )}

              {!isLoadingHistory &&
                pagedHistoryList.map((item) => {
                  const isSelected = selectedHistoryId === item._id;
                  return (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => {
                        setSelectedHistoryId(item._id);
                        setActivePreviewSource('history');
                      }}
                      className={`relative w-full rounded-lg border px-3 py-2 text-left transition ${
                        isSelected
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="absolute right-2 top-2">
                        {item.isUsed ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                            Used
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDeletePrompt(item._id);
                            }}
                            disabled={deletingPromptId === item._id}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-red-600 hover:border-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Delete prompt"
                            title="Delete prompt"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900">
                        V{item.version} - {item.description?.trim() || 'No description'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
                    </button>
                  );
                })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">
                Page {totalPages === 0 ? 0 : currentPage} / {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 lg:col-span-8">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Selected Version (Read-only)</h4>
              {selectedHistory ? (
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">V{selectedHistory.version}</span>
              ) : null}
            </div>
            <textarea
              value={selectedHistory?.content || ''}
              readOnly
              rows={7}
              placeholder="Select a version from History to inspect its content."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Editor - Current Prompt</h4>

            <div>
              <label htmlFor="currentPrompt" className="mb-1 block text-sm font-medium text-gray-700">
                Current Prompt
              </label>
              <textarea
                id="currentPrompt"
                rows={8}
                value={content}
                onChange={(event) => handleContentChange(event.target.value)}
                placeholder="Write your current system prompt here..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label htmlFor="promptDescription" className="mb-1 block text-sm font-medium text-gray-700">
                Description
              </label>
              <input
                id="promptDescription"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Example: Added Socratic method"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">Project: {projectName}</p>
              <button
                type="button"
                onClick={handleSaveNewVersion}
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {isSaving ? 'Saving...' : 'Save as New Version'}
              </button>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </section>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h4 className="text-sm font-semibold text-gray-900">Live Preview</h4>
        <p className="mt-1 text-xs text-gray-500">Preview of the first sample after inserting system prompt.</p>
        <p className="mt-1 text-xs text-gray-500">
          Source: {activePreviewSource === 'history' && selectedHistory ? `History V${selectedHistory.version}` : 'Editor'}
        </p>

        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          {derivedPreviewJson ? (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-gray-800">
              {JSON.stringify(derivedPreviewJson, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">No preview data available.</p>
          )}
        </div>
      </div>

      {confirmDeletePromptId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 px-4" role="dialog" aria-modal="true" aria-labelledby="deletePromptTitle">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h5 id="deletePromptTitle" className="text-base font-semibold text-gray-900">
                  Delete prompt version?
                </h5>
                <p className="mt-1 text-sm text-gray-600">
                  This action cannot be undone. {confirmDeletePrompt ? `You are deleting V${confirmDeletePrompt.version}.` : 'Please confirm to continue.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeletePromptId(null)}
                disabled={Boolean(deletingPromptId)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePrompt}
                disabled={Boolean(deletingPromptId)}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {deletingPromptId ? 'Deleting...' : 'Delete Version'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
