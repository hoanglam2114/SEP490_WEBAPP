import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiService } from "../services/api";
import {
  ArrowLeft,
  GitBranch,
  Shield,
  Zap,
  Trash2,
  Info,
  ExternalLink,
  Box,
  Activity,
  ChevronDown,
  ChevronUp,
  Download,
  MessageSquare,
  Settings,
} from "lucide-react";

interface ModelVersion {
  _id: string;
  version: string;
  status: string;
  hfRepoId?: string;
  notes?: string;
  metrics?: any;
  trainingHistoryId?: any;
  evaluationId?: any;
  configSnapshot?: any;
  datasetInfo?: {
    name: string;
    source: string;
  };
  promptVersion?: string;
  systemPrompt?: string;
  createdAt: string;
}

interface ModelRegistry {
  _id: string;
  name: string;
  baseModel: string;
  description?: string;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    Use: "bg-green-100 text-green-800 border-green-200",
    "Not Use": "bg-gray-100 text-gray-800 border-gray-200",
  };

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[status] || "bg-gray-100"}`}
    >
      {status}
    </span>
  );
};

export const ModelVersionsPage: React.FC = () => {
  const { registryId } = useParams<{ registryId: string }>();
  const [registry, setRegistry] = useState<ModelRegistry | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(
    null,
  );
  const navigate = useNavigate();

  useEffect(() => {
    if (registryId) {
      fetchData();
    }
  }, [registryId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [regData, versionsData] = await Promise.all([
        apiService.getModelRegistry(registryId!),
        apiService.listModelVersions(registryId!),
      ]);
      setRegistry(regData);
      setVersions(versionsData);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await apiService.updateModelVersionStatus(id, newStatus);
      fetchData();
    } catch (error) {
      alert("Error updating status: " + (error as any).message);
    }
  };

  const handleDelete = async (id: string, version: string) => {
    if (
      window.confirm(`Are you sure you want to delete version "${version}"?`)
    ) {
      try {
        await apiService.deleteModelVersion(id);
        fetchData();
      } catch (error) {
        alert("Error deleting version: " + (error as any).message);
      }
    }
  };

  const handleDownloadDataset = async (versionId: string, filename: string) => {
    try {
      const response = await fetch(
        `/api/model-versions/download-dataset/${versionId}`,
      );
      if (!response.ok)
        throw new Error("Dataset file not found or no longer exists on server");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "dataset.json";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      alert("Download error: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!registry) {
    return <div className="p-8 text-center">Registry not found.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={() => navigate("/model-registry")}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Registry
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {registry.name}
        </h1>
        <p className="text-gray-600">
          {registry.description || "No description provided."}
        </p>
        <div className="mt-4 flex gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
            <Shield size={14} className="text-blue-500" />
            <span className="font-medium text-gray-700">Base:</span>{" "}
            {registry.baseModel}
          </span>
          <span className="flex items-center gap-1 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
            <GitBranch size={14} className="text-purple-500" />
            <span className="font-medium text-gray-700">Versions:</span>{" "}
            {versions.length}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Version
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Prompt
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Metrics
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {versions.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-gray-500 italic"
                >
                  No versions registered for this model yet.
                </td>
              </tr>
            ) : (
              versions.map((v) => (
                <React.Fragment key={v._id}>
                  <tr
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${expandedVersionId === v._id ? "bg-blue-50/30" : ""}`}
                    onClick={() =>
                      setExpandedVersionId(
                        expandedVersionId === v._id ? null : v._id,
                      )
                    }
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {expandedVersionId === v._id ? (
                          <ChevronUp size={16} className="text-blue-500" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-400" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-bold text-gray-900">
                              {v.version}
                            </div>
                            {v.status === "Use" && (
                              <span title="Active Model">
                                <Shield size={14} className="text-green-600" />
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(v.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {v.promptVersion || "Default"}
                    </td>
                    <td className="px-6 py-4">
                      {v.metrics ? (
                        <div className="flex flex-col gap-1.5">
                          {/* Accuracy Badge */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Acc</span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              (v.metrics?.evalSummary?.group_b || (v.metrics?.accuracy && v.metrics.accuracy > 0))
                                ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                                : "bg-slate-50 text-slate-400 border border-slate-100"
                            }`}>
                              {v.metrics?.evalSummary?.group_b 
                                ? Number(v.metrics.evalSummary.group_b).toFixed(2) // Điểm từ Evaluation (thang 5)
                                : (v.metrics?.accuracy && v.metrics.accuracy > 0)
                                  ? v.metrics.accuracy.toFixed(2) + "%"
                                  : "-"}
                            </span>
                          </div>
                          
                          {/* Loss Badge */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Loss</span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              v.metrics.loss !== undefined
                                ? "bg-rose-50 text-rose-600 border border-rose-100"
                                : "bg-slate-50 text-slate-400 border border-slate-100"
                            }`}>
                              {v.metrics.loss !== undefined ? v.metrics.loss.toFixed(4) : "-"}
                            </span>
                          </div>

                          {/* Overall Score (if exists from evaluation) */}
                          {v.metrics.overallScore !== undefined && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">Score</span>
                              <span className="bg-blue-600 text-white px-2 py-0.5 rounded-md text-[10px] font-black shadow-sm shadow-blue-200">
                                {v.metrics.overallScore.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div
                        className="flex justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-blue-500"
                          value={v.status}
                          onChange={(e) =>
                            handleStatusChange(v._id, e.target.value)
                          }
                        >
                          <option value="Use">Use</option>
                          <option value="Not Use">Not Use</option>
                        </select>
                        <button
                          onClick={() => handleDelete(v._id, v.version)}
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete Version"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Detail View: FULL STORAGE */}
                  {expandedVersionId === v._id && (
                    <tr className="bg-gray-50/50">
                      <td
                        colSpan={5}
                        className="px-8 py-6 border-l-4 border-blue-500"
                      >
                        <div className="p-6 space-y-8">
                          {/* System Prompt - High Visibility Row */}
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <MessageSquare size={14} className="text-blue-500" />{" "}
                              System Prompt
                            </h4>
                            <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-5 shadow-inner">
                              {v.systemPrompt ? (
                                <div className="text-sm text-slate-700 leading-relaxed font-serif whitespace-pre-wrap">
                                  {v.systemPrompt.replace(/\\n/g, '\n')}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-400 italic">
                                  Sử dụng Prompt mặc định của hệ thống (Socratic Method)
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {/* Left Column: TRAINING & CONFIG */}
                            <div className="space-y-4">
                              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Settings size={14} className="text-blue-500" />{" "}
                                Training & Config
                              </h4>
                              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Job ID:</span>
                                  <span className="text-slate-700 font-mono text-[10px]">{v.trainingHistoryId?.jobId || "N/A"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Base Model:</span>
                                  <span className="text-slate-700 font-medium truncate max-w-[150px]">{registry.baseModel}</span>
                                </div>
                                {v.promptVersion && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Prompt Version:</span>
                                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md font-bold text-[10px] border border-indigo-100">
                                      {v.promptVersion}
                                    </span>
                                  </div>
                                )}
                                <div className="pt-3 border-t border-slate-50">
                                  <span className="text-slate-400 block mb-2 font-bold uppercase text-[9px]">Hyperparameters:</span>
                                  <pre className="bg-slate-900 text-blue-300 p-3 rounded-xl text-[10px] overflow-x-auto shadow-lg max-h-32">
                                    {JSON.stringify(v.configSnapshot || {}, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>

                            {/* Middle Column: DATASET & ARTIFACTS */}
                            <div className="space-y-4">
                              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Box size={14} className="text-blue-500" />{" "}
                                Dataset & Artifacts
                              </h4>
                              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-xs">
                                <div>
                                  <span className="text-slate-500 block mb-1">Dataset:</span>
                                  <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex flex-col truncate">
                                      <span className="text-slate-700 font-medium truncate">
                                        {v.datasetInfo?.name || "N/A"}
                                      </span>
                                      <span className="text-[9px] text-slate-400">
                                        Source: {v.datasetInfo?.source || "N/A"}
                                      </span>
                                    </div>
                                    {v.datasetInfo?.source === 'local' && (
                                      <button
                                        onClick={() => handleDownloadDataset(v._id, v.datasetInfo?.name || "")}
                                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium ml-2"
                                      >
                                        <Download size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                
                                {v.hfRepoId && (
                                  <div>
                                    <span className="text-slate-500 block mb-1">HuggingFace Repo:</span>
                                    <a 
                                      href={`https://huggingface.co/${v.hfRepoId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline flex items-center gap-1 font-medium"
                                    >
                                      {v.hfRepoId} ↗
                                    </a>
                                  </div>
                                )}

                                {v.notes && (
                                  <div className="pt-3 border-t border-slate-50">
                                    <span className="text-slate-500 block mb-1">Notes:</span>
                                    <p className="text-slate-600 italic leading-relaxed">
                                      {v.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right Column: EVALUATION */}
                            <div className="space-y-4">
                              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Activity size={14} className="text-emerald-500" />{" "}
                                Evaluation Results
                              </h4>
                              {v.metrics?.evalSummary ? (
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-xs">
                                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                                    <span className="text-xs font-bold text-emerald-700">Overall</span>
                                    <div className="flex items-baseline gap-1">
                                      <span className="text-2xl font-black text-emerald-700">
                                        {Number(v.metrics.evalSummary.overall ?? 0).toFixed(2)}
                                      </span>
                                      <span className="text-[10px] text-emerald-500">/ {v.metrics.evalSummary.max_possible ?? 5}</span>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { label: "Socratic", key: "group_a", color: "text-indigo-700 bg-indigo-50" },
                                      { label: "Accuracy", key: "group_b", color: "text-orange-700 bg-orange-50" },
                                      { label: "Pedagogy", key: "group_c", color: "text-teal-700 bg-teal-50" },
                                      { label: "Speed", key: "group_d", color: "text-sky-700 bg-sky-50" },
                                    ].map(({ label, key, color }) => {
                                      const val = v.metrics.evalSummary[key];
                                      return (
                                        <div key={key} className={`rounded-xl px-3 py-2.5 ${color} border border-white/50 shadow-sm`}>
                                          <div className="text-[8px] font-bold uppercase tracking-wider opacity-60 mb-0.5">{label}</div>
                                          <div className="text-sm font-black">
                                            {val !== undefined ? Number(val).toFixed(2) : '—'}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm min-h-[150px] flex items-center justify-center text-slate-400 italic text-xs">
                                  No evaluation data linked.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Rollback/Promote Action */}
                        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
                          {v.status !== "Use" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusChange(v._id, "Use");
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                            >
                              <Zap size={14} /> Kích hoạt model này (Active)
                            </button>
                          )}
                          {v.status === "Use" && (
                            <span className="text-xs text-green-600 font-bold flex items-center gap-1 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                              <Shield size={14} /> Đang được sử dụng
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
