import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface TrainingHistoryItem {
  _id: string;
  jobId: string;
  projectName: string;
  baseModel: string;
  datasetSource: string;
  datasetName: string;
  columnMapping: string;
  parameters: {
    batchSize: number;
    epochs: number;
    learningRate: number;
    blockSize: number;
    modelMaxLength: number;
    r: number;
    lora_alpha: number;
    lora_dropout: number;
    random_state: number;
    gradient_accumulation_steps: number;
    warmup_steps: number;
    weight_decay: number;
    seed: number;
    early_stopping_loss: number;
    early_stopping_patience: number;
    optim: string;
    lr_scheduler_type: string;
  };
  pushToHub: boolean;
  hfRepoId: string;
  status: string;
  finalMetrics: {
    loss: number;
    accuracy: number;
    vram: number;
    gpu_util: number;
  };
  lastLogLine: string;
  trainingDuration: number;
  startedAt: string;
  completedAt: string;
  lossHistory?: { progress: number; loss: number }[];
  evalLossHistory?: { progress: number; loss: number }[];
  createdAt: string;
  latest_checkpoint_file_id?: string;
  workerUrl?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const TrainingHistoryScreen: React.FC = () => {
  const navigate = useNavigate();
  const [histories, setHistories] = useState<TrainingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  // Filter state
  const [baseModels, setBaseModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Fetch distinct base models for filter dropdown
  const fetchBaseModels = useCallback(async () => {
    try {
      const res = await fetch('/api/train/history/models');
      const data = await res.json();
      if (Array.isArray(data)) {
        setBaseModels(data);
      }
    } catch (err) {
      console.error('Failed to fetch base models:', err);
    }
  }, []);

  // Fetch histories with optional baseModel filter
  const fetchHistories = useCallback(async (modelFilter?: string) => {
    setLoading(true);
    try {
      const url = modelFilter
        ? `/api/train/history?baseModel=${encodeURIComponent(modelFilter)}`
        : '/api/train/history';
      const res = await fetch(url);
      const data = await res.json();
      setHistories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch training history:', err);
      setHistories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBaseModels();
    fetchHistories();
  }, [fetchBaseModels, fetchHistories]);

  // When selected model changes, fetch filtered data
  const handleModelFilterChange = (model: string) => {
    setSelectedModel(model);
    setExpandedId(null);
    fetchHistories(model || undefined);
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this training record?')) return;
    setDeleteLoading(jobId);
    try {
      await fetch(`/api/train/history/${jobId}`, { method: 'DELETE' });
      setHistories(prev => prev.filter(h => h.jobId !== jobId));
      if (expandedId === jobId) setExpandedId(null);
      // Refresh base models list in case we deleted the last record for a model
      fetchBaseModels();
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleteLoading(null);
    }
  };

  const [resumeLoading, setResumeLoading] = useState<string | null>(null);

  const handleResume = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    setResumeLoading(jobId);
    try {
      const res = await fetch(`/api/train/resume/${jobId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resume training');
      }
      // Navigate to AutoTrain with state
      navigate('/autotrain', { state: { resumeJobId: jobId } });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setResumeLoading(null);
    }
  };

  const statusStyle = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'STOPPED':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'FAILED':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const statusDot = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-emerald-500';
      case 'STOPPED': return 'bg-red-400';
      case 'FAILED': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/autotrain')}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
              title="Back to AutoTrain"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="text-2xl">📋</span> Training History
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">View all past training runs</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/model-eval/run")}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-xl text-sm font-semibold transition-all"
              title="Go to Model Evaluation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Evaluation
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                {histories.length} record{histories.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => fetchHistories(selectedModel || undefined)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Filter Bar */}
        <div className="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-sm font-semibold text-slate-700">Filter by Base Model</span>
            </div>
            <select
              value={selectedModel}
              onChange={(e) => handleModelFilterChange(e.target.value)}
              className="flex-1 max-w-md border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 appearance-none bg-white transition-all"
            >
              <option value="">All Models</option>
              {baseModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            {selectedModel && (
              <button
                onClick={() => handleModelFilterChange('')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear Filter
              </button>
            )}
          </div>
          {selectedModel && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-slate-400">Showing results for:</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                {selectedModel}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <svg className="w-8 h-8 animate-spin text-blue-500 mb-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-slate-500">Loading training history...</p>
          </div>
        ) : histories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">
              {selectedModel ? `No training history for "${selectedModel}"` : 'No training history yet'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {selectedModel ? 'Try a different model or clear the filter' : 'Complete a training run to see results here'}
            </p>
            {!selectedModel && (
              <button
                onClick={() => navigate('/autotrain')}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-all"
              >
                Start Training
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {histories.map((item) => {
              const isExpanded = expandedId === item.jobId;
              return (
                <div
                  key={item.jobId}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md"
                >
                  {/* Summary Row */}
                  <div
                    className="px-6 py-4 cursor-pointer flex items-center justify-between gap-4"
                    onClick={() => setExpandedId(isExpanded ? null : item.jobId)}
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      {/* Status Badge */}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border flex-shrink-0 ${statusStyle(item.status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot(item.status)}`} />
                        {item.status}
                      </span>

                      {/* Project Name + Model */}
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-800 truncate">{item.projectName}</h3>
                        <p className="text-xs text-slate-400 truncate">{item.baseModel}</p>
                      </div>
                    </div>

                    {/* Metrics Preview */}
                    {/* <div className="hidden md:flex items-center gap-6 flex-shrink-0">
                      <div className="text-center">
                        <div className="text-[10px] text-blue-500 font-medium">Loss</div>
                        <div className="text-sm font-bold text-blue-700">{item.finalMetrics?.loss ?? '-'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-emerald-500 font-medium">Accuracy</div>
                        <div className="text-sm font-bold text-emerald-700">{item.finalMetrics?.accuracy ?? '-'}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-slate-400 font-medium">Duration</div>
                        <div className="text-sm font-bold text-slate-700">{formatDuration(item.trainingDuration)}</div>
                      </div>
                    </div> */}

                    {/* Date + Expand Arrow */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-slate-400 hidden sm:block">{formatDate(item.completedAt)}</span>
                      <svg
                        className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-6 py-5 bg-slate-50/50 space-y-5">
                      {/* Metrics Grid */}
                      {/* <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-100 rounded-xl p-3 text-center">
                          <div className="text-[10px] text-blue-500 font-medium mb-0.5">Loss</div>
                          <div className="text-xl font-bold text-blue-700">{item.finalMetrics?.loss ?? '-'}</div>
                        </div>
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100 rounded-xl p-3 text-center">
                          <div className="text-[10px] text-emerald-500 font-medium mb-0.5">Accuracy</div>
                          <div className="text-xl font-bold text-emerald-700">{item.finalMetrics?.accuracy ?? '-'}%</div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 border border-purple-100 rounded-xl p-3 text-center">
                          <div className="text-[10px] text-purple-500 font-medium mb-0.5">VRAM</div>
                          <div className="text-xl font-bold text-purple-700">{item.finalMetrics?.vram ?? '-'} <span className="text-xs font-normal">MB</span></div>
                        </div>
                        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-100 rounded-xl p-3 text-center">
                          <div className="text-[10px] text-amber-500 font-medium mb-0.5">GPU Util</div>
                          <div className="text-xl font-bold text-amber-700">{item.finalMetrics?.gpu_util ?? '-'}%</div>
                        </div>
                      </div> */}

                      {/* Info Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Parameters */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Parameters</h4>
                          <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
                            <pre className="text-green-400 text-xs font-mono leading-relaxed">
                              {JSON.stringify(item.parameters, null, 2)}
                            </pre>
                          </div>
                        </div>

                        {/* Chart or Details */}
                        <div className="space-y-4">
                          {item.lossHistory && item.lossHistory.length > 0 ? (
                            <div className="bg-white border border-slate-200 rounded-xl p-4 h-64 shadow-inner">
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Loss Curve</h4>
                              <ResponsiveContainer width="100%" height="85%">
                                <LineChart data={item.lossHistory}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                  <XAxis 
                                    dataKey="progress" 
                                    tick={{ fontSize: 10, fill: '#94a3b8' }} 
                                    tickFormatter={(v) => `${v}%`}
                                  />
                                  <YAxis 
                                    tick={{ fontSize: 10, fill: '#94a3b8' }} 
                                    domain={['auto', 'auto']}
                                  />
                                  <Tooltip 
                                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    labelFormatter={(v) => `Progress: ${v}%`}
                                  />
                                  <Line 
                                    type="monotone" 
                                    dataKey="loss" 
                                    stroke="#3b82f6" 
                                    strokeWidth={2} 
                                    dot={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          ) : (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Details</h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Job ID</span>
                                  <span className="text-slate-700 font-mono text-xs">{item.jobId}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Base Model</span>
                                  <span className="text-slate-700 text-xs font-medium">{item.baseModel}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Dataset</span>
                                  <span className="text-slate-700">{item.datasetName} ({item.datasetSource})</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Training Duration</span>
                                  <span className="text-slate-700 font-semibold">{formatDuration(item.trainingDuration)}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Full Info Details if Chart was shown */}
                      {item.lossHistory && item.lossHistory.length > 0 && (
                        <div className="bg-white/50 border border-slate-100 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Job ID</span>
                            <span className="text-slate-700 font-mono text-xs">{item.jobId}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Dataset</span>
                            <span className="text-slate-700">{item.datasetName}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Duration</span>
                            <span className="text-slate-700 font-semibold">{formatDuration(item.trainingDuration)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Started</span>
                            <span className="text-slate-700">{formatDate(item.startedAt)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Completed</span>
                            <span className="text-slate-700">{formatDate(item.completedAt)}</span>
                          </div>
                        </div>
                      )}

                      {/* Last Log Line */}
                      {item.lastLogLine && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Last Log Line</h4>
                          <div className="bg-slate-900 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 border-b border-slate-700">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                              <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                            </div>
                            <pre className="text-yellow-300 p-4 text-xs font-mono">{item.lastLogLine}</pre>
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex justify-end pt-2 gap-3">
                        {(item.status === 'STOPPED' || item.status === 'FAILED' || item.status === 'RUNNING') && (
                          <button
                            onClick={(e) => handleResume(e, item.jobId)}
                            disabled={!(item.latest_checkpoint_file_id || (item.pushToHub && item.hfRepoId)) || resumeLoading === item.jobId}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                              !(item.latest_checkpoint_file_id || (item.pushToHub && item.hfRepoId))
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200'
                            }`}
                            title={
                              item.latest_checkpoint_file_id
                                ? 'Resume from Drive checkpoint'
                                : item.pushToHub && item.hfRepoId
                                  ? `Resume from HuggingFace: ${item.hfRepoId}`
                                  : 'No checkpoint available to resume'
                            }
                          >
                            {resumeLoading === item.jobId ? (
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            Resume
                            {item.pushToHub && item.hfRepoId && !item.latest_checkpoint_file_id && (
                              <span className="text-[10px] bg-orange-100 text-orange-600 px-1 rounded">HF</span>
                            )}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(item.jobId); }}
                          disabled={deleteLoading === item.jobId}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-all disabled:opacity-50"
                        >
                          {deleteLoading === item.jobId ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
