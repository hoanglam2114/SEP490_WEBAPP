import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import { dataprepApi } from '../api/dataprepApi';
import { useAppStore } from '../../../hooks/useAppStore';
import toast from 'react-hot-toast';

export const FileUploader: React.FC = () => {
  const { uploadedFile, setUploadedFile } = useAppStore();

  const uploadMutation = useMutation({
    mutationFn: apiService.uploadFile,
    onSuccess: (data) => {
      setUploadedFile(data);
      dataprepApi.deleteClusterCache().catch((err) => {
        console.error('Failed to clear cluster cache:', err);
      });
      toast.success('Tải tệp lên thành công!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Tải tệp lên thất bại');
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        uploadMutation.mutate(acceptedFiles[0]);
      }
    },
    [uploadMutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/json': ['.json', '.jsonl'],
      'application/x-jsonlines': ['.jsonl'],
    },
    multiple: false,
    disabled: uploadMutation.isPending,
  });

  const handleRemove = () => {
    setUploadedFile(null);
  };

  if (uploadedFile) {
    return (
      <div className="bg-white rounded-lg border-2 border-green-500 p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <File className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900">
                {uploadedFile.filename}
              </h3>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                {uploadedFile.fileType === 'lesson' ? (
                  <>
                    <p>📚 {uploadedFile.lessonCount?.toLocaleString()} bài học</p>
                    <p>📝 {uploadedFile.exerciseCount?.toLocaleString()} bài tập</p>
                  </>
                ) : uploadedFile.fileType === 'openai_messages' ? (
                  <>
                    <p>🤖 Định dạng OpenAI Messages</p>
                    <p>📊 {uploadedFile.messageCount?.toLocaleString()} tin nhắn</p>
                    <p>💬 {uploadedFile.conversationCount?.toLocaleString()} hội thoại</p>
                  </>
                ) : (
                  <>
                    <p>📊 {uploadedFile.messageCount?.toLocaleString()} tin nhắn</p>
                    <p>💬 {uploadedFile.conversationCount?.toLocaleString()} hội thoại</p>
                  </>
                )}
                <p>📦 {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleRemove}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
        transition-colors duration-200
        ${isDragActive
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-300 hover:border-primary-400'
        }
        ${uploadMutation.isPending ? 'opacity-50 cursor-wait' : ''}
      `}
    >
      <input {...getInputProps()} />
      <Upload
        className={`w-16 h-16 mx-auto mb-4 ${isDragActive ? 'text-primary-500' : 'text-gray-400'
          }`}
      />
      {uploadMutation.isPending ? (
        <div>
          <p className="text-lg font-medium text-gray-700">Đang tải lên...</p>
          <p className="text-sm text-gray-500 mt-2">Vui lòng chờ trong giây lát</p>
        </div>
      ) : (
        <div>
          <p className="text-lg font-medium text-gray-700">
            {isDragActive
              ? 'Thả tệp vào đây'
              : 'Kéo & thả tệp JSON/JSONL vào đây'}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            hoặc nhấp để chọn tệp từ máy tính
          </p>
          <p className="text-xs text-gray-400 mt-4">
            Hỗ trợ định dạng MongoDB export và OpenAI messages (Tối đa: 50MB)
          </p>
        </div>
      )}
    </div>
  );
};
