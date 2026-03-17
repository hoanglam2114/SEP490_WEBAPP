import React, { useState } from 'react';
import { Download, Loader2, Play, ShieldCheck, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAppStore } from '../hooks/useAppStore';
import { EvaluationResult } from '../types';
import toast from 'react-hot-toast';

export const ConvertButton: React.FC = () => {
  const { uploadedFile, conversionOptions } = useAppStore();
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);

  const convertMutation = useMutation({
    mutationFn: () =>
      apiService.convertData(uploadedFile!.fileId, conversionOptions),
    onSuccess: () => {
      setEvaluationResult(null); // Reset evaluation when new conversion happens
      toast.success('Conversion completed! You can now download or evaluate the data.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Conversion failed');
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: (data: any[]) => apiService.evaluateData(data),
    onSuccess: (data) => {
      setEvaluationResult(data);
      toast.success('Evaluation completed with Gemini!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Evaluation failed');
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['stats', uploadedFile?.fileId],
    queryFn: () => apiService.getStats(uploadedFile!.fileId),
    enabled: !!uploadedFile,
  });

  const handleDownload = () => {
    if (!convertMutation.data) return;

    const data = convertMutation.data;
    const blob = new Blob([data.output], {
      type: data.filename.endsWith('.jsonl')
        ? 'application/x-ndjson'
        : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('File downloaded!');
  };

  if (!uploadedFile) {
    return null;
  }

  const isConverted = !!convertMutation.data;

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-6 border border-primary-200 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
            <Zap className="w-4 h-4 mr-2 text-primary-600" />
            File Statistics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-2xl font-bold text-primary-600">
                {stats.fileType === 'lesson' ? stats.lessonCount?.toLocaleString() : stats.conversationCount?.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 font-medium">{stats.fileType === 'lesson' ? 'Lessons' : 'Conversations'}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary-600">
                {stats.fileType === 'lesson' ? stats.exerciseCount?.toLocaleString() : stats.messageCount?.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 font-medium">{stats.fileType === 'lesson' ? 'Exercises' : 'Messages'}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary-600">
                {stats.uniqueUsers}
              </div>
              <div className="text-sm text-gray-600 font-medium">Unique Users</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary-600">
                {stats.avgMessagesPerConversation}
              </div>
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
      )}

      {/* Main Action Area */}
      {!isConverted ? (
        <button
          onClick={() => convertMutation.mutate()}
          disabled={convertMutation.isPending}
          className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-bold py-5 px-6 rounded-xl shadow-lg shadow-primary-200 transition-all active:scale-[0.98] flex items-center justify-center space-x-3 text-lg"
        >
          {convertMutation.isPending ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Processing Dataset...</span>
            </>
          ) : (
            <>
              <Play className="w-6 h-6 fill-current" />
              <span>Convert Dataset</span>
            </>
          )}
        </button>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={handleDownload}
            className="flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-xl shadow-md transition-all active:scale-[0.98]"
          >
            <Download className="w-5 h-5" />
            <span>Download Converted File</span>
          </button>

          <button
            onClick={() => evaluateMutation.mutate(convertMutation.data!.data)}
            disabled={evaluateMutation.isPending}
            className="flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-xl shadow-md transition-all active:scale-[0.98]"
          >
            {evaluateMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Evaluating...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Evaluate with Gemini</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Conversion Summary & Cleaning Report */}
      {convertMutation.data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-green-50 px-4 py-3 border-b border-green-100 flex items-center text-green-800">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            <span className="font-semibold text-sm">Conversion Successful</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-2 text-sm text-gray-700">
              <div className="flex flex-col">
                <span className="text-gray-500 text-xs">Unit Type</span>
                <span className="font-medium">{uploadedFile.fileType === 'lesson' ? 'Lessons' : 'Conversations'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-500 text-xs">Total Units</span>
                <span className="font-medium">{convertMutation.data.stats.totalConversations.toLocaleString()}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-500 text-xs">Total Messages</span>
                <span className="font-medium">{convertMutation.data.stats.totalMessages.toLocaleString()}</span>
              </div>
            </div>

            {/* Cleaning Stats */}
            {convertMutation.data.stats.cleaning && (
              <div className="mt-2 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">🧹 Cleaning Report</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 p-2 rounded-lg">
                    <div className="text-xs text-gray-500">Boilerplate</div>
                    <div className="text-sm font-semibold text-red-600">−{convertMutation.data.stats.cleaning.removedBoilerplate}</div>
                  </div>
                  <div className="bg-gray-50 p-2 rounded-lg">
                    <div className="text-xs text-gray-500">Length</div>
                    <div className="text-sm font-semibold text-orange-600">−{convertMutation.data.stats.cleaning.removedTooShort + convertMutation.data.stats.cleaning.removedTooLong}</div>
                  </div>
                  <div className="bg-gray-50 p-2 rounded-lg">
                    <div className="text-xs text-gray-500">Duplicates</div>
                    <div className="text-sm font-semibold text-yellow-600">−{convertMutation.data.stats.cleaning.removedDuplicates}</div>
                  </div>
                  <div className="bg-primary-50 p-2 rounded-lg">
                    <div className="text-xs text-primary-700">Final Count</div>
                    <div className="text-sm font-bold text-primary-700">{convertMutation.data.stats.cleaning.finalCount}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gemini Evaluation Results */}
      {evaluationResult && (
        <div className="bg-white border border-indigo-200 rounded-xl overflow-hidden shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-indigo-600 px-4 py-3 text-white flex items-center justify-between">
            <div className="flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2" />
              <span className="font-bold">Gemini Quality Assessment</span>
            </div>
            <div className="bg-indigo-500 text-xs px-2 py-1 rounded-full font-bold">
              Pass Rate: {evaluationResult.passRate}% ({evaluationResult.evaluated}/{evaluationResult.totalPopulation})
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="text-2xl font-black text-indigo-700">{evaluationResult.avgScores.overall}</div>
                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-tighter">Avg Overall</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="text-xl font-bold text-gray-700">{evaluationResult.avgScores.accuracy}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Accuracy</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="text-xl font-bold text-gray-700">{evaluationResult.avgScores.clarity}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Clarity</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="text-xl font-bold text-gray-700">{evaluationResult.avgScores.completeness}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Completeness</div>
              </div>
            </div>

            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
              <AlertCircle className="w-4 h-4 mr-1 text-gray-500" />
              Sample Details ({evaluationResult.evaluated} samples)
            </h4>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {evaluationResult.samples.map((sample, idx) => {
                const isPassed = sample.scores.overall >= 6.0;
                return (
                  <div key={idx} className={`p-3 rounded-lg border ${isPassed ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-bold py-0.5 px-2 rounded-full bg-white border border-gray-200 text-gray-500">
                        Sample #{idx + 1}
                      </span>
                      <div className="flex gap-2">
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">
                          Acc: {sample.scores.accuracy}
                        </span>
                        <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full border border-purple-100">
                          Clar: {sample.scores.clarity}
                        </span>
                        <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-100">
                          Comp: {sample.scores.completeness}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          Overall: {sample.scores.overall}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-gray-800 line-clamp-2">Q: {sample.instruction}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


