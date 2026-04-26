import React, { useEffect, useState } from 'react';
import { X, Plus, Pencil, Trash2, ToggleLeft, Download } from 'lucide-react';
import { keyApi, AuditLogEntry } from '../../services/adminApiService';

interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
}

const ACTION_LABEL: Record<AuditLogEntry['action'], { label: string; color: string; icon: React.ReactNode }> = {
  CREATE: { label: 'Tạo mới', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: <Plus className="w-3 h-3" /> },
  UPDATE: { label: 'Cập nhật', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: <Pencil className="w-3 h-3" /> },
  DELETE: { label: 'Xoá', color: 'text-red-700 bg-red-50 border-red-200', icon: <Trash2 className="w-3 h-3" /> },
  TOGGLE: { label: 'Toggle', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: <ToggleLeft className="w-3 h-3" /> },
  IMPORT: { label: 'Import', color: 'text-violet-700 bg-violet-50 border-violet-200', icon: <Download className="w-3 h-3" /> },
};

export function AuditLogDrawer({ open, onClose }: AuditLogDrawerProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    keyApi.getAuditLog(200)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">Lịch sử thao tác</h3>
            <p className="text-xs text-slate-400 mt-0.5">200 bản ghi gần nhất • tự xoá sau 90 ngày</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Log list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">Đang tải...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">Chưa có lịch sử.</div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => {
                const cfg = ACTION_LABEL[log.action];
                return (
                  <div key={log._id} className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
                    {/* Action badge */}
                    <div className="flex-shrink-0 mt-0.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-semibold text-slate-700 truncate">
                        {log.keyName}
                      </p>
                      {log.detail && (
                        <p className="text-xs text-slate-400 mt-0.5">{log.detail}</p>
                      )}
                      <p className="text-xs text-slate-300 mt-0.5">{formatDate(log.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
