import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { ApiKey } from '../../services/adminApiService';

interface KeyFormModalProps {
  open: boolean;
  editKey?: ApiKey | null;     // null = tạo mới
  onSubmit: (name: string, value: string, description: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function KeyFormModal({ open, editKey, onSubmit, onCancel, loading }: KeyFormModalProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});

  const isEdit = !!editKey;

  useEffect(() => {
    if (open) {
      setName(editKey?.name || '');
      setValue('');
      setDescription(editKey?.description || '');
      setShowValue(false);
      setErrors({});
    }
  }, [open, editKey]);

  if (!open) return null;

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Tên là bắt buộc.';
    else if (!/^[A-Z0-9_]+$/i.test(name)) e.name = 'Chỉ dùng chữ cái, số và dấu _.';
    if (!value.trim()) e.value = 'Giá trị là bắt buộc.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onSubmit(name.trim(), value.trim(), description.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-800 text-lg">
            {isEdit ? `Cập nhật ${editKey.name}` : 'Thêm API Key'}
          </h3>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Tên biến
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              disabled={isEdit}
              placeholder="VD: OPENAI_API_KEY"
              className={`w-full px-3.5 py-2.5 text-sm font-mono border rounded-xl outline-none transition-all
                ${errors.name ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:border-slate-800 focus:ring-slate-200'}
                focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400`}
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Value */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Giá trị {isEdit && <span className="text-slate-400 font-normal normal-case">(bỏ trống nếu không đổi)</span>}
            </label>
            <div className="relative">
              <input
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isEdit ? 'Nhập giá trị mới...' : 'sk-...'}
                className={`w-full px-3.5 py-2.5 pr-10 text-sm font-mono border rounded-xl outline-none transition-all
                  ${errors.value ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:border-slate-800 focus:ring-slate-200'}
                  focus:ring-2`}
              />
              <button
                type="button"
                onClick={() => setShowValue(!showValue)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.value && <p className="text-xs text-red-500 mt-1">{errors.value}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Mô tả <span className="text-slate-400 font-normal normal-case">(tuỳ chọn)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VD: OpenAI key cho production"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl outline-none transition-all focus:border-slate-800 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm key'}
          </button>
        </div>
      </div>
    </div>
  );
}
