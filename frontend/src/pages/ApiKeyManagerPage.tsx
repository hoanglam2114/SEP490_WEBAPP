import React, { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import {
  Plus, Upload, History, LogOut, Lock, KeyRound, RefreshCw,
} from 'lucide-react';

import { usePinSession } from '../hooks/usePinSession';
import { keyApi, ApiKey } from '../services/adminApiService';
import { PinGate } from '../components/apikey/PinGate';
import { KeyTable } from '../components/apikey/KeyTable';
import { KeyFormModal } from '../components/apikey/KeyFormModal';
import { ConfirmDialog } from '../components/apikey/ConfirmDialog';
import { ImportWizard } from '../components/apikey/ImportWizard';
import { AuditLogDrawer } from '../components/apikey/AuditLogDrawer';

export function ApiKeyManagerPage() {
  const { isUnlocked, saveToken, clearToken } = usePinSession();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);

  // Modals / drawers
  const [formOpen, setFormOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [confirmSave, setConfirmSave] = useState<{ open: boolean; data: { name: string; value: string; description: string } | null }>
    ({ open: false, data: null });
  const [importOpen, setImportOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // Auto-lock sau 10 phút không thao tác
  const [lastActivity, setLastActivity] = useState(Date.now());
  const IDLE_TIMEOUT = 10 * 60 * 1000;

  useEffect(() => {
    if (!isUnlocked) return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_TIMEOUT) {
        toast('Phiên đã hết hạn. Vui lòng nhập lại PIN.', { icon: '🔒' });
        clearToken();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [isUnlocked, lastActivity, clearToken]);

  const touch = useCallback(() => setLastActivity(Date.now()), []);

  // ── Fetch keys ──────────────────────────────────────────────────────────────
  const fetchKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const data = await keyApi.list();
      setKeys(data);
    } catch {
      toast.error('Không thể tải danh sách key.');
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    if (isUnlocked) fetchKeys();
  }, [isUnlocked, fetchKeys]);

  // ── Nếu chưa unlock → PinGate ──────────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <>
        <Toaster position="top-right" />
        <PinGate onUnlocked={saveToken} />
      </>
    );
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleOpenCreate = () => {
    touch();
    setEditKey(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (key: ApiKey) => {
    touch();
    setEditKey(key);
    setFormOpen(true);
  };

  const handleFormSubmit = (name: string, value: string, description: string) => {
    touch();
    setConfirmSave({ open: true, data: { name, value, description } });
  };

  const handleSaveConfirm = async () => {
    if (!confirmSave.data) return;
    setFormLoading(true);
    try {
      const { name, value, description } = confirmSave.data;
      const { isNew } = await keyApi.create(name, value, description);
      toast.success(isNew ? `Đã thêm key "${name}"` : `Đã cập nhật key "${name}"`);
      setFormOpen(false);
      setConfirmSave({ open: false, data: null });
      fetchKeys();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Lỗi khi lưu key.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    touch();
    await keyApi.delete(name);
    toast.success(`Đã xoá key "${name}"`);
    fetchKeys();
  };

  const handleToggle = async (name: string, currentActive: boolean) => {
    touch();
    const { isActive } = await keyApi.toggle(name);
    toast.success(`Key "${name}" ${isActive ? 'đã kích hoạt' : 'đã vô hiệu hoá'}`);
    fetchKeys();
  };

  const handleLogout = async () => {
    await clearToken();
    toast('Đã khoá màn hình.', { icon: '🔒' });
  };

  const activeCount = keys.filter((k) => k.isActive).length;

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50" onClick={touch}>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { borderRadius: '12px', fontSize: '13px' },
          success: { iconTheme: { primary: '#1e293b', secondary: '#fff' } },
        }}
      />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-slate-800 rounded-xl flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800 leading-none">API Key Manager</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeCount} active · {keys.length} total
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { touch(); setAuditOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              Lịch sử
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              Khoá màn hình
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Danh sách API Keys</h2>
            <p className="text-xs text-slate-400 mt-0.5">Giá trị được mã hoá AES-256-GCM</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { touch(); fetchKeys(); }}
              className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="Làm mới"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => { touch(); setImportOpen(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Import file
            </button>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm key
            </button>
          </div>
        </div>

        {/* Key table */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <KeyTable
            keys={keys}
            onEdit={handleOpenEdit}
            onDelete={handleDelete}
            onToggle={handleToggle}
            loading={loadingKeys}
          />
        </div>
      </main>

      {/* Key form modal */}
      <KeyFormModal
        open={formOpen}
        editKey={editKey}
        onSubmit={handleFormSubmit}
        onCancel={() => setFormOpen(false)}
        loading={formLoading}
      />

      {/* Confirm save */}
      <ConfirmDialog
        open={confirmSave.open}
        action={editKey ? 'update' : 'create'}
        keyName={confirmSave.data?.name}
        onConfirm={handleSaveConfirm}
        onCancel={() => setConfirmSave({ open: false, data: null })}
        loading={formLoading}
      />

      {/* Import wizard */}
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={fetchKeys}
      />

      {/* Audit log drawer */}
      <AuditLogDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
      />
    </div>
  );
}
