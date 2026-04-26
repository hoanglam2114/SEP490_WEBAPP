import React from 'react';
import { AlertTriangle, Trash2, ToggleLeft, Pencil, Plus } from 'lucide-react';

type ActionType = 'delete' | 'toggle-off' | 'toggle-on' | 'update' | 'create' | 'import';

interface ConfirmDialogProps {
  open: boolean;
  action: ActionType;
  keyName?: string;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const ACTION_CONFIG: Record<ActionType, {
  title: string;
  icon: React.ReactNode;
  confirmLabel: string;
  confirmClass: string;
}> = {
  delete: {
    title: 'Xác nhận xoá',
    icon: <Trash2 className="w-5 h-5 text-red-500" />,
    confirmLabel: 'Xoá',
    confirmClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  'toggle-off': {
    title: 'Vô hiệu hoá key',
    icon: <ToggleLeft className="w-5 h-5 text-amber-500" />,
    confirmLabel: 'Vô hiệu hoá',
    confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  'toggle-on': {
    title: 'Kích hoạt key',
    icon: <ToggleLeft className="w-5 h-5 text-emerald-500" />,
    confirmLabel: 'Kích hoạt',
    confirmClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  },
  update: {
    title: 'Xác nhận cập nhật',
    icon: <Pencil className="w-5 h-5 text-blue-500" />,
    confirmLabel: 'Cập nhật',
    confirmClass: 'bg-slate-800 hover:bg-slate-700 text-white',
  },
  create: {
    title: 'Xác nhận thêm key',
    icon: <Plus className="w-5 h-5 text-emerald-500" />,
    confirmLabel: 'Thêm',
    confirmClass: 'bg-slate-800 hover:bg-slate-700 text-white',
  },
  import: {
    title: 'Xác nhận thêm key',
    icon: <Plus className="w-5 h-5 text-emerald-500" />,
    confirmLabel: 'Thêm vào danh sách',
    confirmClass: 'bg-slate-800 hover:bg-slate-700 text-white',
  },
};

export function ConfirmDialog({
  open,
  action,
  keyName,
  message,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null;

  const cfg = ACTION_CONFIG[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-6 z-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
            {cfg.icon}
          </div>
          <h3 className="font-semibold text-slate-800">{cfg.title}</h3>
        </div>

        {action === 'delete' && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-600">
              Thao tác này không thể hoàn tác.
            </p>
          </div>
        )}

        <p className="text-sm text-slate-600 mb-5">
          {message || (keyName ? (
            <>
              {action === 'delete' && <>Bạn có chắc muốn xoá key <span className="font-mono font-semibold text-slate-800">{keyName}</span>?</>}
              {action === 'toggle-off' && <>Vô hiệu hoá key <span className="font-mono font-semibold text-slate-800">{keyName}</span>?</>}
              {action === 'toggle-on' && <>Kích hoạt lại key <span className="font-mono font-semibold text-slate-800">{keyName}</span>?</>}
              {(action === 'update' || action === 'create' || action === 'import') && <>Lưu key <span className="font-mono font-semibold text-slate-800">{keyName}</span>?</>}
            </>
          ) : 'Bạn có chắc muốn thực hiện thao tác này?')}
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${cfg.confirmClass}`}
          >
            {loading ? 'Đang xử lý...' : cfg.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
