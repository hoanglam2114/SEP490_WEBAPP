import React from 'react';
import { useAppStore } from '../hooks/useAppStore';

export const ConversionOptions: React.FC = () => {
  const { conversionOptions, updateConversionOptions, uploadedFile } = useAppStore();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Conversion Options</h2>

      {/* Remove Think Tags */}
      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={conversionOptions.removeThinkTags}
            onChange={(e) =>
              updateConversionOptions({ removeThinkTags: e.target.checked })
            }
            className="rounded"
          />
          <span className="text-sm font-medium text-gray-700">
            Remove &lt;think&gt; tags from content
          </span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          Automatically strips thinking process tags from assistant responses
        </p>
      </div>

      {/* Max Messages Per Conversation */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Max Messages Per Conversation
        </label>
        <input
          type="number"
          value={conversionOptions.maxMessagesPerConversation || ''}
          onChange={(e) =>
            updateConversionOptions({
              maxMessagesPerConversation: e.target.value
                ? parseInt(e.target.value)
                : undefined,
            })
          }
          placeholder="No limit"
          min="1"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500 mt-1">
          Leave empty for no limit
        </p>
      </div>

      {/* Filters (only for chat type) */}
      {uploadedFile?.fileType !== 'lesson' && (
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <h3 className="font-medium text-gray-900">Filters (Optional)</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by User ID
            </label>
            <input
              type="text"
              value={conversionOptions.filterByUser || ''}
              onChange={(e) =>
                updateConversionOptions({ filterByUser: e.target.value || undefined })
              }
              placeholder="Enter user ID..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Conversation ID
            </label>
            <input
              type="text"
              value={conversionOptions.filterByConversation || ''}
              onChange={(e) =>
                updateConversionOptions({
                  filterByConversation: e.target.value || undefined,
                })
              }
              placeholder="Enter conversation ID..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={conversionOptions.startDate || ''}
                onChange={(e) =>
                  updateConversionOptions({
                    startDate: e.target.value || undefined,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={conversionOptions.endDate || ''}
                onChange={(e) =>
                  updateConversionOptions({ endDate: e.target.value || undefined })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      )}

      {/* === DATA CLEANING PIPELINE === */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900">🧹 Data Cleaning Pipeline</h3>
          <label className="flex items-center space-x-2 cursor-pointer">
            <span className="text-sm text-gray-600">Enable</span>
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={conversionOptions.enableCleaning ?? false}
                onChange={(e) =>
                  updateConversionOptions({ enableCleaning: e.target.checked })
                }
              />
              <div
                className={`w-10 h-6 rounded-full transition-colors ${conversionOptions.enableCleaning ? 'bg-green-500' : 'bg-gray-300'
                  }`}
              />
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${conversionOptions.enableCleaning ? 'translate-x-5' : 'translate-x-1'
                  }`}
              />
            </div>
          </label>
        </div>

        {conversionOptions.enableCleaning && (
          <div className="space-y-4 pl-0 pt-2">

            {/* Boilerplate & Dedup */}
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={conversionOptions.removeBoilerplate ?? true}
                  onChange={(e) =>
                    updateConversionOptions({ removeBoilerplate: e.target.checked })
                  }
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">
                  Remove AI boilerplate phrases
                </span>
              </label>
              <p className="text-xs text-gray-500 ml-6">
                Filters "As an AI…", "Xin lỗi, tôi không thể…" and similar unhelpful patterns.
              </p>

              <label className="flex items-center space-x-2 mt-1">
                <input
                  type="checkbox"
                  checked={conversionOptions.deduplicate ?? true}
                  onChange={(e) =>
                    updateConversionOptions({ deduplicate: e.target.checked })
                  }
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">
                  Deduplicate by instruction prefix
                </span>
              </label>
              <p className="text-xs text-gray-500 ml-6">
                Removes records with near-identical instruction prefixes (first 60 chars).
              </p>
            </div>

            {/* Length filters */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">Length constraints (characters)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min instruction</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsInstruction ?? 10}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsInstruction: parseInt(e.target.value) || 10 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max instruction</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsInstruction ?? 2000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsInstruction: parseInt(e.target.value) || 2000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min output</label>
                  <input
                    type="number"
                    value={conversionOptions.minCharsOutput ?? 5}
                    onChange={(e) =>
                      updateConversionOptions({ minCharsOutput: parseInt(e.target.value) || 5 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max output</label>
                  <input
                    type="number"
                    value={conversionOptions.maxCharsOutput ?? 4000}
                    onChange={(e) =>
                      updateConversionOptions({ maxCharsOutput: parseInt(e.target.value) || 4000 })
                    }
                    min="1"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};