import React, { useState } from 'react';
import {
  Copy, Pencil, Trash2, ToggleLeft, ToggleRight,
  Search, CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ApiKey } from '../../services/adminApiService';
import { ConfirmDialog } from './ConfirmDialog';

interface KeyTableProps {
  keys: ApiKey[];
  onEdit: (key: ApiKey) => void;
  onDelete: (name: string) => Promise<void>;
  onToggle: (name: string, currentActive: boolean) => Promise<void>;
  loading?: boolean;
}

export function KeyTable({ keys, onEdit, onDelete, onToggle, loading }: KeyTableProps) {
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{
    open: boolean;
    action: 'delete' | 'toggle-on' | 'toggle-off';
    key: ApiKey | null;
  }>({ open: false, action: 'delete', key: null });
  const [actionLoading, setActionLoading] = useState(false);

  const filtered = keys.filter(
    (k) =>
      k.name.toLowerCase().includes(search.toLowerCase()) ||
      (k.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleCopy = async (maskedValue: string, name: string) => {
    // Copy giá trị masked (không có full value ở client — cần request riêng nếu muốn)
    // Hiện tại chỉ copy tên biến vì full value không được expose ra client
    await navigator.clipboard.writeText(name);
    toast.success(`Đã copy tên "${name}"`, { duration: 2000 });
  };

  const openConfirm = (action: typeof confirm['action'], key: ApiKey) => {
    setConfirm({ open: true, action, key });
  };

  const closeConfirm = () => {
    setConfirm({ open: false, action: 'delete', key: null });
  };

  const handleConfirm = async () => {
    if (!confirm.key) return;
    setActionLoading(true);
    try {
      if (confirm.action === 'delete') {
        await onDelete(confirm.key.name);
      } else {
        await onToggle(confirm.key.name, confirm.key.isActive);
      }
      closeConfirm();
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div>
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên hoặc mô tả..."
          className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:border-slate-800 focus:ring-2 focus:ring-slate-200 transition-all"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          {search ? 'Không tìm thấy key nào.' : 'Chưa có API key nào. Thêm key đầu tiên bên trên.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tên biến</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Giá trị</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Mô tả</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cập nhật</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((key) => (
                <tr key={key.name} className={`hover:bg-slate-50 transition-colors ${!key.isActive ? 'opacity-50' : ''}`}>
                  {/* Name */}
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold text-slate-800 text-xs bg-slate-100 px-2 py-0.5 rounded">
                      {key.name}
                    </span>
                  </td>

                  {/* Masked value */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-500 tracking-widest">
                      {key.maskedValue}
                    </span>
                  </td>

                  {/* Description */}
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-500">{key.description || '—'}</span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {key.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                        <AlertCircle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </td>

                  {/* Updated at */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="w-3 h-3" />
                      {formatDate(key.updatedAt)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Copy name */}
                      <button
                        onClick={() => handleCopy(key.maskedValue, key.name)}
                        title="Copy tên biến"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => onEdit(key)}
                        title="Sửa"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {/* Toggle */}
                      <button
                        onClick={() => openConfirm(key.isActive ? 'toggle-off' : 'toggle-on', key)}
                        title={key.isActive ? 'Vô hiệu hoá' : 'Kích hoạt'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        {key.isActive
                          ? <ToggleRight className="w-3.5 h-3.5 text-emerald-500" />
                          : <ToggleLeft className="w-3.5 h-3.5" />
                        }
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => openConfirm('delete', key)}
                        title="Xoá"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Count */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-slate-400 mt-3">
          {filtered.length} / {keys.length} key{keys.length > 1 ? 's' : ''}
        </p>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirm.open}
        action={confirm.action}
        keyName={confirm.key?.name}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
        loading={actionLoading}
      />
    </div>
  );
}
