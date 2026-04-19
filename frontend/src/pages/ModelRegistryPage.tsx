import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { Plus, Trash2, ExternalLink, Box, Activity, ArrowLeft } from 'lucide-react';

interface ModelRegistry {
  _id: string;
  name: string;
  description?: string;
  baseModel: string;
  createdAt: string;
  updatedAt: string;
}

export const ModelRegistryPage: React.FC = () => {
  const [registries, setRegistries] = useState<ModelRegistry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newBaseModel, setNewBaseModel] = useState('unsloth/Llama-3.2-1B-Instruct-bnb-4bit');
  const navigate = useNavigate();

  useEffect(() => {
    fetchRegistries();
  }, []);

  const fetchRegistries = async () => {
    setLoading(true);
    try {
      const data = await apiService.listModelRegistries();
      setRegistries(data);
    } catch (error) {
      console.error('Error fetching registries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createModelRegistry({
        name: newName,
        description: newDesc,
        baseModel: newBaseModel,
      });
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      fetchRegistries();
    } catch (error) {
      alert('Error creating registry: ' + (error as any).message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete registry "${name}" and all its versions?`)) {
      try {
        await apiService.deleteModelRegistry(id);
        fetchRegistries();
      } catch (error) {
        alert('Error deleting registry: ' + (error as any).message);
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Home
      </button>

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Box className="w-8 h-8 text-blue-600" />
            Model Registry
          </h1>
          <p className="text-gray-500 mt-1">Manage your models and their versions in a central place.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={20} />
          Register New Model
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : registries.length === 0 ? (
        <div className="text-center py-20 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          <Box className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No models registered yet</h3>
          <p className="text-gray-500 mt-2">Start by registering your first model to track its versions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {registries.map((reg) => (
            <div
              key={reg._id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow p-6 flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-semibold text-gray-900 truncate pr-4">{reg.name}</h2>
                <button
                  onClick={() => handleDelete(reg._id, reg.name)}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <p className="text-gray-600 text-sm mb-4 line-clamp-2 flex-grow">
                {reg.description || 'No description provided.'}
              </p>

              <div className="space-y-2 mb-6">
                <div className="flex items-center text-xs text-gray-500 gap-2">
                  <span className="font-medium text-gray-700">Base Model:</span>
                  <span className="truncate">{reg.baseModel}</span>
                </div>
                <div className="flex items-center text-xs text-gray-500 gap-2">
                  <span className="font-medium text-gray-700">Created:</span>
                  <span>{new Date(reg.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <button
                onClick={() => navigate(`/model-registry/${reg._id}/versions`)}
                className="w-full flex items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-medium py-2 rounded-lg border border-gray-200 transition-colors"
              >
                <Activity size={18} />
                View Versions
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Register New Model</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="e.g., Support-Chatbot-v1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none h-24"
                  placeholder="What is this model for?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base Model</label>
                <input
                  type="text"
                  required
                  value={newBaseModel}
                  onChange={(e) => setNewBaseModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
