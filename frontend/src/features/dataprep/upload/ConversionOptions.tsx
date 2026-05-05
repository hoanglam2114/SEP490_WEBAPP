import React from 'react';
import { useAppStore } from '../../../hooks/useAppStore';

const formatSamples = {
  alpaca: `{
  "instruction": "Classify the student's intent",
  "input": "I need help resetting my password",
  "output": "account_support"
}`,
  openai: `{
  "messages": [
    { "role": "user", "content": "I need help resetting my password" },
    { "role": "assistant", "content": "Go to Settings > Security to reset it." }
  ]
}`,
};

export const ConversionOptions: React.FC = () => {
  const { conversionOptions, updateConversionOptions } = useAppStore();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Step 1 Options</h2>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-3">Output format</p>
        <div className="space-y-3">
          <label className="block cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                name="output-format"
                value="alpaca"
                checked={conversionOptions.format === 'alpaca'}
                onChange={() => updateConversionOptions({ format: 'alpaca' })}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">Convert to Alpaca format</p>
                <p className="text-xs text-gray-500">Each record contains instruction, input and output.</p>
                <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Sample output
                  </div>
                  <pre className="overflow-x-auto px-3 py-3 text-[11px] leading-relaxed text-slate-700">
                    {formatSamples.alpaca}
                  </pre>
                </div>
              </div>
            </div>
          </label>

          <label className="block cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                name="output-format"
                value="openai"
                checked={conversionOptions.format === 'openai'}
                onChange={() => updateConversionOptions({ format: 'openai' })}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">Convert to OpenAI Message Format</p>
                <p className="text-xs text-gray-500">Each conversation is converted to a messages array.</p>
                <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Sample output
                  </div>
                  <pre className="overflow-x-auto px-3 py-3 text-[11px] leading-relaxed text-slate-700">
                    {formatSamples.openai}
                  </pre>
                </div>
              </div>
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
