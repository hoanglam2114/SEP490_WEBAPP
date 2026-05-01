import { CheckCircle2 } from 'lucide-react';
import type { ConversionResult } from '../../../types';

type PostConversionSummaryProps = {
  result: ConversionResult | null;
};

export function PostConversionSummary({ result }: PostConversionSummaryProps) {
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
                <div className="text-xs text-gray-500">Error keywords</div>
                <div className="text-sm font-semibold text-red-600">-{result.stats.cleaning.removedBoilerplate}</div>
              </div>
              <div className="bg-gray-50 p-2 rounded-lg">
                <div className="text-xs text-gray-500">Length</div>
                <div className="text-sm font-semibold text-orange-600">
                  -{result.stats.cleaning.removedTooShort + result.stats.cleaning.removedTooLong}
                </div>
              </div>
              <div className="bg-gray-50 p-2 rounded-lg">
                <div className="text-xs text-gray-500">Unclosed &lt;think&gt;</div>
                <div className="text-sm font-semibold text-purple-600">-{result.stats.cleaning.removedUnclosedThink || 0}</div>
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
