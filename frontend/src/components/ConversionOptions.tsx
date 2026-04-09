import React from 'react';
import { useAppStore } from '../hooks/useAppStore';

export const ConversionOptions: React.FC = () => {
  const { conversionOptions, updateConversionOptions } = useAppStore();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Step 1 Options</h2>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-3">Output format</p>
        <div className="space-y-3">
          <label className="flex items-start space-x-3 cursor-pointer rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="radio"
              name="output-format"
              value="alpaca"
              checked={conversionOptions.format === 'alpaca'}
              onChange={() => updateConversionOptions({ format: 'alpaca' })}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">Convert to Alpaca format</p>
              <p className="text-xs text-gray-500">Each record contains instruction, input and output.</p>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="radio"
              name="output-format"
              value="openai"
              checked={conversionOptions.format === 'openai'}
              onChange={() => updateConversionOptions({ format: 'openai' })}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">Convert to OpenAI Message Format</p>
              <p className="text-xs text-gray-500">Each conversation is converted to a messages array.</p>
            </div>
          </label>
        </div>

      </div>

      {conversionOptions.format === 'openai' && (
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
      )}
    </div>
  );
};