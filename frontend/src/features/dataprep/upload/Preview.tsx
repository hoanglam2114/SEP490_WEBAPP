import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { useAppStore } from '../../../hooks/useAppStore';

export const Preview: React.FC = () => {
  const { uploadedFile } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['preview', uploadedFile?.fileId],
    queryFn: () => apiService.getPreview(uploadedFile!.fileId, 3),
    enabled: !!uploadedFile && isOpen,
  });

  if (!uploadedFile) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Eye className="w-5 h-5 text-gray-600" />
          <span className="font-semibold text-gray-900">Preview Data</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-600" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-600" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-gray-200 p-6">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading preview...</div>
          ) : data ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                Showing {data.showing} of {data.total} {uploadedFile.fileType === 'lesson' ? 'lessons' : 'conversations'}
              </p>
              {data.preview.map((conv) => (
                <div
                  key={conv.conversation_id}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedConv(
                        expandedConv === conv.conversation_id
                          ? null
                          : conv.conversation_id
                      )
                    }
                    className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-4 text-sm">
                      <span className="font-mono text-xs text-gray-500">
                        {conv.conversation_id.slice(0, 8)}...
                      </span>
                      <span className="text-gray-600">
                        {conv.message_count} {uploadedFile.fileType === 'lesson' ? 'exercises' : 'messages'}
                      </span>
                      {uploadedFile.fileType !== 'lesson' && (
                        <span className="text-gray-400">
                          {new Date(conv.start_time).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {expandedConv === conv.conversation_id ? (
                      <ChevronUp className="w-4 h-4 text-gray-600" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-600" />
                    )}
                  </button>

                  {expandedConv === conv.conversation_id && (
                    <div className="p-4 space-y-3 bg-white">
                      {conv.messages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg ${msg.role === 'user'
                              ? 'bg-blue-50 border border-blue-200'
                              : 'bg-gray-50 border border-gray-200'
                            }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className={`text-xs font-semibold uppercase ${msg.role === 'user'
                                  ? 'text-blue-700'
                                  : 'text-gray-700'
                                }`}
                            >
                              {msg.role}
                            </span>
                            <span className="text-xs text-gray-500">
                              {uploadedFile.fileType === 'lesson' ? 'Content preview' : new Date(msg.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">
                            {msg.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No preview available
            </div>
          )}
        </div>
      )}
    </div>
  );
};
