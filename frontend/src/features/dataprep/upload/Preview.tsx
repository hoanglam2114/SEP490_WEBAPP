import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { useAppStore } from '../../../hooks/useAppStore';

export const Preview: React.FC = () => {
  const { uploadedFile } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['preview', uploadedFile?.fileId],
    queryFn: () => apiService.getPreview(uploadedFile!.fileId, 3),
    enabled: !!uploadedFile && isOpen,
  });

  if (!uploadedFile) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Eye className="w-5 h-5 text-gray-600" />
          <span className="font-semibold text-gray-900">Xem trước dữ liệu gốc (Raw Data Preview)</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-600" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-600" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-gray-200 p-6 bg-white">
          {isLoading ? (
            <div className="text-center py-10 text-gray-500 italic flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
              <span>Đang tải bản xem trước...</span>
            </div>
          ) : data ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4 font-medium px-1">
                Hiển thị <span className="text-blue-600">{data.showing}</span> trên tổng số <span className="text-blue-600">{data.total}</span> mẫu dữ liệu gốc dưới định dạng JSON:
              </p>
              
              <div className="space-y-6">
                {data.preview.map((item: any, idx: number) => (
                  <div key={idx} className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Original Item #{idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] text-slate-400 font-mono">raw_json</span>
                      </div>
                    </div>
                    <div className="p-4 overflow-x-auto custom-scrollbar">
                      <pre className="text-[11px] font-mono text-slate-800 whitespace-pre leading-relaxed selection:bg-blue-100">
                        {JSON.stringify(item, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-lg bg-blue-50 border border-blue-100 flex items-start gap-3">
                <div className="mt-0.5 text-blue-500">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <p className="text-[11px] text-blue-700 leading-normal">
                  Dữ liệu trên là cấu trúc nguyên bản từ tệp tin bạn vừa tải lên. 
                  Các bước tiếp theo sẽ chuyển đổi dữ liệu này sang định dạng chuẩn để xử lý.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500 italic">
              Không có dữ liệu xem trước cho tệp này.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
