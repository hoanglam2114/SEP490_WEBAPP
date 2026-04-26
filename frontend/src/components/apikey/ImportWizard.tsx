import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload, X, ChevronRight, ChevronLeft,
  CheckCircle2, SkipForward, FileText, AlertTriangle,
} from 'lucide-react';
import { keyApi, ImportItem } from '../../services/adminApiService';
import { ConfirmDialog } from './ConfirmDialog';
import toast from 'react-hot-toast';

interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;       // gọi sau khi import xong để refresh list
}

type Step = 'upload' | 'review' | 'done';

export function ImportWizard({ open, onClose, onDone }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [added, setAdded] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reset = () => {
    setStep('upload');
    setItems([]);
    setCurrentIndex(0);
    setAdded(0);
    setSkipped(0);
    setEditName('');
    setEditValue('');
  };

  // ── Dropzone ────────────────────────────────────────────────────────────────
  const onDrop = useCallback(async (files: File[]) => {
    if (!files[0]) return;
    setParsing(true);
    try {
      const result = await keyApi.parseImport(files[0]);
      if (result.count === 0) {
        toast.error('Không tìm thấy cặp key-value nào trong file.');
        return;
      }
      setItems(result.items);
      setCurrentIndex(0);
      const first = result.items[0];
      setEditName(first.name);
      setEditValue(first.value);
      setStep('review');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Lỗi khi đọc file.');
    } finally {
      setParsing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.env'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    multiple: false,
    disabled: parsing,
  });

  if (!open) return null;

  // ── Review step ─────────────────────────────────────────────────────────────
  const current = items[currentIndex];
  const isLast = currentIndex === items.length - 1;

  const handleConfirmItem = async () => {
    setSaving(true);
    try {
      await keyApi.create(editName, editValue);
      setAdded((a) => a + 1);
      goNext();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Lỗi khi lưu key.');
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const handleSkip = () => {
    setSkipped((s) => s + 1);
    goNext();
  };

  const goNext = () => {
    if (isLast) {
      setStep('done');
    } else {
      const next = items[currentIndex + 1];
      setCurrentIndex((i) => i + 1);
      setEditName(next.name);
      setEditValue(next.value);
    }
  };

  const progress = Math.round(((currentIndex) / items.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { reset(); onClose(); }} />

      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg z-10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">
            {step === 'upload' && 'Import từ file'}
            {step === 'review' && `Review key ${currentIndex + 1} / ${items.length}`}
            {step === 'done' && 'Import hoàn tất'}
          </h3>
          <button onClick={() => { reset(); onClose(); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">

          {/* ── Upload step ─────────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div>
              <p className="text-sm text-slate-500 mb-4">
                Hỗ trợ file <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.env</code>,{' '}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.xlsx</code>,{' '}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.xls</code>,{' '}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.csv</code>.
                Với Excel/CSV: cột A = tên, cột B = giá trị.
              </p>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
                  ${isDragActive ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'}
                  ${parsing ? 'opacity-50 cursor-wait' : ''}`}
              >
                <input {...getInputProps()} />
                <Upload className={`w-8 h-8 mx-auto mb-3 ${isDragActive ? 'text-slate-800' : 'text-slate-300'}`} />
                {parsing ? (
                  <p className="text-sm text-slate-500">Đang phân tích file...</p>
                ) : isDragActive ? (
                  <p className="text-sm font-semibold text-slate-800">Thả file vào đây</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-600">Kéo thả file vào đây</p>
                    <p className="text-xs text-slate-400 mt-1">hoặc click để chọn file</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Review step ─────────────────────────────────────────────────── */}
          {step === 'review' && current && (
            <div>
              {/* Progress bar */}
              <div className="mb-5">
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>Tiến độ</span>
                  <span>{currentIndex}/{items.length}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-800 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Already exists warning */}
              {current.alreadyExists && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    Key <strong>{current.name}</strong> đã tồn tại — xác nhận sẽ ghi đè.
                  </p>
                </div>
              )}

              {/* Edit form */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tên biến</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-xl outline-none focus:border-slate-800 focus:ring-2 focus:ring-slate-200 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Giá trị</label>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-xl outline-none focus:border-slate-800 focus:ring-2 focus:ring-slate-200 transition-all"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-5">
                <button
                  onClick={handleSkip}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Bỏ qua
                </button>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={saving || !editName || !editValue}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                  {isLast ? 'Thêm và hoàn tất' : 'Thêm và tiếp theo'}
                </button>
              </div>

              {/* Remaining items preview */}
              {items.length > 1 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {items.map((item, i) => (
                    <span
                      key={i}
                      className={`text-xs font-mono px-2 py-0.5 rounded ${
                        i < currentIndex
                          ? 'bg-emerald-50 text-emerald-600'
                          : i === currentIndex
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {item.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Done step ───────────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              </div>
              <h4 className="font-bold text-slate-800 text-lg mb-1">Hoàn tất!</h4>
              <p className="text-sm text-slate-500 mb-4">
                Đã thêm <span className="font-semibold text-slate-800">{added}</span> key,{' '}
                bỏ qua <span className="font-semibold text-slate-800">{skipped}</span> key.
              </p>
              <button
                onClick={() => { reset(); onDone(); onClose(); }}
                className="px-6 py-2.5 bg-slate-800 text-white font-semibold text-sm rounded-xl hover:bg-slate-700 transition-colors"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog cho từng item */}
      <ConfirmDialog
        open={confirmOpen}
        action={current?.alreadyExists ? 'update' : 'import'}
        keyName={editName}
        message={current?.alreadyExists
          ? `Ghi đè key "${editName}" đang tồn tại?`
          : undefined}
        onConfirm={handleConfirmItem}
        onCancel={() => setConfirmOpen(false)}
        loading={saving}
      />
    </div>
  );
}
