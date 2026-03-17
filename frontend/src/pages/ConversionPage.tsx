
import { FileUploader } from '../components/FileUploader';
import { ConversionOptions } from '../components/ConversionOptions';
import { ConvertButton } from '../components/ConvertButton';
import { Preview } from '../components/Preview';
import { HuggingFaceUpload } from '../components/HuggingFaceUpload';
import { useAppStore } from '../hooks/useAppStore';

export function ConversionPage() {
  const { uploadedFile } = useAppStore();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column - Upload & Options */}
      <div className="lg:col-span-2 space-y-6">
        <FileUploader />

        {uploadedFile && (
          <>
            <Preview />
            <ConversionOptions />
          </>
        )}
      </div>

      {/* Right Column - Convert & Stats */}
      <div className="space-y-6">
        {uploadedFile && <ConvertButton />}

        {/* Info Card
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">
            Supported Formats
          </h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div>
              <div className="font-medium text-gray-900">OpenAI (JSONL)</div>
              <p className="text-xs">For GPT-3.5 and GPT-4 fine-tuning</p>
            </div>
            <div>
              <div className="font-medium text-gray-900">Anthropic (JSONL)</div>
              <p className="text-xs">For Claude fine-tuning</p>
            </div>
            <div>
              <div className="font-medium text-gray-900">Alpaca/LLaMA (JSON)</div>
              <p className="text-xs">For open-source models</p>
            </div>
            <div>
              <div className="font-medium text-gray-900">ShareGPT (JSON)</div>
              <p className="text-xs">Universal format for various tools</p>
            </div>
          </div>
        </div> */}

        {/* Tips Card
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
          <h3 className="font-semibold text-blue-900 mb-3">💡 Tips</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>• Remove &lt;think&gt; tags for cleaner training data</li>
            <li>• Use filters to create focused datasets</li>
            <li>• Preview data before converting</li>
            <li>• Check token estimates for pricing</li>
          </ul>
        </div> */}

        {uploadedFile && <HuggingFaceUpload />}
      </div>
    </div>
  );
}
