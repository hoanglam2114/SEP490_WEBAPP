import { Loader2, Wand2 } from 'lucide-react';
import { useAppStore } from '../../../hooks/useAppStore';

const CLEANING_TOOLTIPS = {
  removeBoilerplate:
    'Xóa các câu trả lời mẫu/canned response chứa keyword Error: \n"Unknown error",\n"LLM call failed",\n"Error code:",\n"Không tìm thấy agent",\n"Status",\n"not supported by",\n"__CHUNK__"',
};

type CleaningPipelineOptionsProps = {
  onAccept: () => void;
  isLoading: boolean;
};

export function CleaningPipelineOptions({ onAccept, isLoading }: CleaningPipelineOptionsProps) {
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
              <span className="relative inline-flex items-center group cursor-help text-sm font-medium text-gray-700">
                Remove Error Keywords
                <span className="absolute left-0 top-full z-20 mt-2 hidden w-80 rounded-md border border-gray-200 bg-white p-2 text-xs font-normal text-gray-700 shadow-lg group-hover:block">
                  {CLEANING_TOOLTIPS.removeBoilerplate}
                </span>
              </span>
            </label>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={conversionOptions.removeUnclosedThink ?? true}
                onChange={(e) => updateConversionOptions({ removeUnclosedThink: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Loại bỏ những mẫu có &lt;think&gt; mà không có thẻ đóng &lt;/think&gt;</span>
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
