import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { ArrowLeft, GitBranch, Shield, Zap, Archive, Trash2, Info, ExternalLink, Box, Activity, ChevronDown, ChevronUp, Download } from 'lucide-react';

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
    'Production': 'bg-green-100 text-green-800 border-green-200',
    'Staging': 'bg-blue-100 text-blue-800 border-blue-200',
    'Development': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'Archived': 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
};

export const ModelVersionsPage: React.FC = () => {
  const { registryId } = useParams<{ registryId: string }>();
  const [registry, setRegistry] = useState<ModelRegistry | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
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
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await apiService.updateModelVersionStatus(id, newStatus);
      fetchData();
    } catch (error) {
      alert('Error updating status: ' + (error as any).message);
    }
  };

  const handleDelete = async (id: string, version: string) => {
    if (window.confirm(`Are you sure you want to delete version "${version}"?`)) {
      try {
        await apiService.deleteModelVersion(id);
        fetchData();
      } catch (error) {
        alert('Error deleting version: ' + (error as any).message);
      }
    }
  };

  const handleDownloadDataset = async (versionId: string, filename: string) => {
    try {
      const response = await fetch(`/api/model-versions/download-dataset/${versionId}`);
      if (!response.ok) throw new Error('Dataset file not found or no longer exists on server');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'dataset.json';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      alert('Download error: ' + error.message);
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
        onClick={() => navigate('/model-registry')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Registry
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{registry.name}</h1>
        <p className="text-gray-600">{registry.description || 'No description provided.'}</p>
        <div className="mt-4 flex gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
            <Shield size={14} className="text-blue-500" />
            <span className="font-medium text-gray-700">Base:</span> {registry.baseModel}
          </span>
          <span className="flex items-center gap-1 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
            <GitBranch size={14} className="text-purple-500" />
            <span className="font-medium text-gray-700">Versions:</span> {versions.length}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Version</th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Prompt</th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Metrics</th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {versions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">
                  No versions registered for this model yet.
                </td>
              </tr>
            ) : (
              versions.map((v) => (
                <React.Fragment key={v._id}>
                  <tr 
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${expandedVersionId === v._id ? 'bg-blue-50/30' : ''}`}
                    onClick={() => setExpandedVersionId(expandedVersionId === v._id ? null : v._id)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {expandedVersionId === v._id ? <ChevronUp size={16} className="text-blue-500" /> : <ChevronDown size={16} className="text-gray-400" />}
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-bold text-gray-900">{v.version}</div>
                            {v.status === 'Production' && <Shield size={14} className="text-green-600" title="Live in Production" />}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{new Date(v.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {v.promptVersion || 'Default'}
                    </td>
                    <td className="px-6 py-4">
                      {v.metrics ? (
                        <div className="space-y-1">
                          {v.metrics.overallScore !== undefined && (
                            <div className="text-xs font-bold text-blue-600 flex items-center gap-1">
                              <Zap size={12} />
                              {v.metrics.overallScore.toFixed(1)}%
                            </div>
                          )}
                          <div className="text-[10px] text-gray-500">
                            Acc: {v.metrics.accuracy ? (v.metrics.accuracy * 100).toFixed(1) + '%' : '-'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                        <select
                          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-blue-500"
                          value={v.status}
                          onChange={(e) => handleStatusChange(v._id, e.target.value)}
                        >
                          <option value="Development">Development</option>
                          <option value="Staging">Staging</option>
                          <option value="Production">Production</option>
                          <option value="Archived">Archived</option>
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
                      <td colSpan={5} className="px-8 py-6 border-l-4 border-blue-500">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                          {/* Config & Training */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                              <Info size={14} /> Training & Config
                            </h4>
                            <div className="bg-white p-3 rounded-lg border border-gray-200 text-xs space-y-2">
                              <div className="flex justify-between"><span className="text-gray-500">Job ID:</span> <span className="font-mono">{v.trainingHistoryId?.jobId || 'N/A'}</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Base Model:</span> <span className="truncate max-w-[150px]">{registry.baseModel}</span></div>
                              <div className="pt-2 border-t border-gray-100">
                                <span className="text-gray-500 block mb-1">Hyperparameters:</span>
                                <pre className="bg-gray-900 text-green-400 p-2 rounded text-[10px] overflow-x-auto max-h-32">
                                  {JSON.stringify(v.configSnapshot, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>

                          {/* Dataset & Artifacts */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                              <Box size={14} className="text-blue-500" /> Dataset & Artifacts
                            </h4>
                            <div className="bg-white p-3 rounded-lg border border-gray-200 text-xs space-y-3">
                              <div>
                                <span className="text-gray-500 block">Dataset:</span>
                                <div className="flex items-center justify-between mt-1">
                                  <div>
                                    <span className="font-medium text-gray-800">{v.datasetInfo?.name || 'N/A'}</span>
                                    <span className="text-[10px] text-gray-400 ml-2">({v.datasetInfo?.source})</span>
                                  </div>
                                  {v.datasetInfo?.source === 'local' && (
                                    <button
                                      onClick={() => handleDownloadDataset(v._id, v.datasetInfo?.name || '')}
                                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium transition-colors"
                                      title="Download dataset file"
                                    >
                                      <Download size={12} />
                                      Tải về
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div>
                                <span className="text-gray-500 block mb-1">HuggingFace Repo:</span>
                                {v.hfRepoId ? (
                                  <a href={`https://huggingface.co/${v.hfRepoId}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                    {v.hfRepoId} <ExternalLink size={10} />
                                  </a>
                                ) : <span className="text-gray-400">Not published</span>}
                              </div>
                              {v.notes && (
                                <div className="pt-2 border-t border-gray-100">
                                  <span className="text-gray-500 block">Notes:</span>
                                  <p className="text-gray-600 italic mt-1">{v.notes}</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Evaluation Results */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                              <Activity size={14} className="text-emerald-500" /> Evaluation Results
                            </h4>
                            <div className="bg-white p-3 rounded-lg border border-gray-200 text-xs">
                              {v.metrics?.evalSummary ? (
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center bg-emerald-50 p-2 rounded border border-emerald-100">
                                    <span className="text-emerald-700 font-bold">Overall Score:</span>
                                    <span className="text-emerald-800 font-black text-lg">{v.metrics.overallScore?.toFixed(1)}%</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {v.metrics.evalSummary.overall && Object.entries(v.metrics.evalSummary.overall).map(([k, val]: any) => (
                                      <div key={k} className="p-1.5 border border-gray-100 rounded">
                                        <div className="text-[9px] text-gray-400 uppercase">{k}</div>
                                        <div className="font-bold text-gray-700">{typeof val === 'number' ? val.toFixed(2) : val}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-gray-400 italic py-4 text-center">No evaluation data linked.</div>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Rollback/Promote Action */}
                        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
                           {v.status !== 'Production' && (
                             <button
                               onClick={(e) => { e.stopPropagation(); handleStatusChange(v._id, 'Production'); }}
                               className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                             >
                               <Zap size={14} /> Promote to Production (Rollback if older)
                             </button>
                           )}
                           {v.status === 'Production' && (
                             <span className="text-xs text-green-600 font-bold flex items-center gap-1 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                               <Shield size={14} /> Currently Live
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
