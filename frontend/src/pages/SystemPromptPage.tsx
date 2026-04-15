import React from 'react';

type SystemPromptPageProps = {
  systemPromptText: string;
  onSystemPromptTextChange: (value: string) => void;
  previewJson: Record<string, any> | null;
};

export const SystemPromptPage: React.FC<SystemPromptPageProps> = ({
  systemPromptText,
  onSystemPromptTextChange,
  previewJson,
}) => {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Step 7 - System Prompt</h3>
          <p className="mt-1 text-sm text-gray-600">
            Nhap system prompt dung chung de chen vao dau moi mau khi xuat file fine-tuning.
          </p>
        </div>

        <div>
          <label htmlFor="systemPromptInput" className="mb-2 block text-sm font-medium text-gray-700">
            System Prompt
          </label>
          <textarea
            id="systemPromptInput"
            rows={5}
            value={systemPromptText}
            onChange={(event) => onSystemPromptTextChange(event.target.value)}
            placeholder="Ban la mot tro ly AI huu ich..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-semibold text-gray-900">Live Preview</h4>
        <p className="mt-1 text-xs text-gray-500">
          Xem truoc mau dau tien sau khi chen system message vao mang messages.
        </p>

        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          {previewJson ? (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-gray-800">
              {JSON.stringify(previewJson, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">Chua co du lieu de preview.</p>
          )}
        </div>
      </div>
    </div>
  );
};
