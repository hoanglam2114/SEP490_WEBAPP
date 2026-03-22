import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface CompletedJob {
  jobId: string;
  projectName: string;
  baseModel: string;
  hfRepoId: string;
  completedAt: string;
  status?: string; // thêm field status để filter chính xác
}

type EvalPhase = 'idle' | 'uploading' | 'running' | 'done' | 'error';

// Judge models cố định — thêm vào đây khi có model mới
const JUDGE_MODELS = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    note: 'Khuyên dùng',
    recommended: true,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    note: 'Chính xác cao, chậm hơn',
    recommended: false,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    note: 'Nhanh, chi phí thấp',
    recommended: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    note: 'Cân bằng tốc độ/chất lượng',
    recommended: false,
  },
];

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: 'bg-amber-50 text-amber-700 border-amber-200',
  Google: 'bg-sky-50 text-sky-700 border-sky-200',
  OpenAI: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const RunEvaluationScreen: React.FC = () => {
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [judgeModel, setJudgeModel] = useState<string>(JUDGE_MODELS[0].id);
  const [jobSearch, setJobSearch] = useState<string>('');
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [phase, setPhase] = useState<EvalPhase>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [doneEvalId, setDoneEvalId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/train/history?status=COMPLETED')
      .then(r => r.json())
      .then((data: CompletedJob[]) => {
        // FIX: filter rõ ràng theo cả status COMPLETED lẫn hfRepoId
        // Phòng trường hợp API không filter đúng hoặc trả về mixed data
        const completedWithRepo = data.filter(j =>
          j.hfRepoId &&
          (!j.status || j.status.toUpperCase() === 'COMPLETED')
        );
        setJobs(completedWithRepo);
        setLoadingJobs(false);
      })
      .catch(() => setLoadingJobs(false));
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => () => sseRef.current?.close(), []);

  const filteredJobs = jobs.filter(j => {
    const q = jobSearch.toLowerCase();
    return (
      j.projectName.toLowerCase().includes(q) ||
      j.baseModel.toLowerCase().includes(q) ||
      j.hfRepoId.toLowerCase().includes(q)
    );
  });

  const selectedJob = jobs.find(j => j.jobId === selectedJobId);

  const validateAndSetFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['json', 'jsonl'].includes(ext ?? '')) {
      setErrorMsg('Chỉ chấp nhận file .json hoặc .jsonl');
      return;
    }
    setEvalFile(file);
    setErrorMsg('');
  };

  const handleSubmit = async () => {
    if (!selectedJobId || !evalFile) return;
    setPhase('uploading');
    setLogs([]);
    setErrorMsg('');
    setDoneEvalId(null);

    try {
      const formData = new FormData();
      formData.append('eval_file', evalFile);
      formData.append('judge_model', judgeModel);

      const res = await fetch(`/api/eval/run/${selectedJobId}`, { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setPhase('error');
        setErrorMsg(data.error || 'Không thể bắt đầu đánh giá');
        return;
      }

      const newEvalJobId: string = data.eval_job_id;
      setPhase('running');
      setLogs([`[✅] Eval job bắt đầu: ${newEvalJobId}`]);

      const es = new EventSource(`/api/eval/stream/${newEvalJobId}`);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.logs?.length) {
            setLogs(prev => {
              const newLogs = payload.logs.filter((l: string) => !prev.includes(l));
              return [...prev, ...newLogs];
            });
          }
        } catch { /* ignore */ }
      };

      es.addEventListener('end', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data);
          if (payload.status === 'COMPLETED') {
            setPhase('done');
            setDoneEvalId(newEvalJobId);
            setLogs(prev => [...prev, '[🎉] Đánh giá hoàn tất!']);
          } else {
            setPhase('error');
            setErrorMsg(payload.error || 'Eval thất bại');
          }
        } catch { /* ignore */ }
        es.close();
      });

      es.addEventListener('error', (e) => {
        try { setErrorMsg(JSON.parse((e as MessageEvent).data).error || 'Lỗi kết nối'); } catch { /* ignore */ }
        setPhase('error');
        es.close();
      });

    } catch (err: any) {
      setPhase('error');
      setErrorMsg(err.message || 'Lỗi không xác định');
    }
  };

  const canSubmit = !!selectedJobId && !!evalFile && !!judgeModel && phase === 'idle';

  return (
    <div className="min-h-screen bg-slate-50 pb-16">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/models')} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Đánh giá model</h1>
            <p className="text-xs text-slate-400 mt-0.5">Chọn model cần đánh giá, model chấm điểm và upload file đánh giá</p>
          </div>
        </div>
      </div>

      {phase === 'idle' ? (
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

          {/* Row 1: Step 1 + Step 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Step 1 — Fine-tuned model */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                  <h2 className="text-sm font-bold text-slate-800">Model cần đánh giá</h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 ml-7">Chọn job đã fine-tune có trạng thái COMPLETED</p>
              </div>

              {/* Search bar */}
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Tìm project, base model, HF repo..."
                    value={jobSearch}
                    onChange={e => setJobSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 transition bg-slate-50"
                  />
                  {jobSearch && (
                    <button onClick={() => setJobSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable job list */}
              <div className="overflow-y-auto max-h-64 px-3 py-2">
                {loadingJobs ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-xs text-slate-400">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                    Đang tải...
                  </div>
                ) : filteredJobs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {jobs.length === 0 ? 'Chưa có model COMPLETED nào có HF Repo.' : 'Không tìm thấy kết quả.'}
                  </div>
                ) : (
                  filteredJobs.map(job => (
                    <button
                      key={job.jobId}
                      onClick={() => setSelectedJobId(job.jobId)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition ${selectedJobId === job.jobId ? 'bg-slate-800' : 'hover:bg-slate-50'
                        }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${selectedJobId === job.jobId ? 'border-white' : 'border-slate-300'
                        }`}>
                        {selectedJobId === job.jobId && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold truncate ${selectedJobId === job.jobId ? 'text-white' : 'text-slate-800'}`}>
                          {job.projectName}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${selectedJobId === job.jobId ? 'text-slate-400' : 'text-slate-400'}`}>
                          {job.baseModel.split('/').pop()} · {new Date(job.completedAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${selectedJobId === job.jobId ? 'bg-slate-700 border-slate-600 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-500'
                        }`}>
                        {job.hfRepoId.split('/').pop()}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {selectedJob && (
                <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                  <p className="text-[10px] text-slate-500">
                    Đã chọn: <span className="font-semibold text-slate-700">{selectedJob.projectName}</span>
                    <span className="mx-1">·</span>
                    <span className="font-mono">{selectedJob.hfRepoId}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Step 2 — Judge model */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <h2 className="text-sm font-bold text-slate-800">Model chấm điểm</h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 ml-7">AI model dùng để đánh giá chất lượng câu trả lời</p>
              </div>

              <div className="px-4 py-4 space-y-2 flex-1">
                {JUDGE_MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setJudgeModel(m.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition ${judgeModel === m.id ? 'border-slate-800 bg-slate-800' : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${judgeModel === m.id ? 'border-white' : 'border-slate-300'
                      }`}>
                      {judgeModel === m.id && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold flex items-center gap-2 ${judgeModel === m.id ? 'text-white' : 'text-slate-800'}`}>
                        {m.name}
                        {m.recommended && (
                          <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded">★ Khuyên dùng</span>
                        )}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${judgeModel === m.id ? 'text-slate-400' : 'text-slate-400'}`}>{m.note}</div>
                    </div>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${judgeModel === m.id ? 'bg-slate-700 border-slate-600 text-slate-300' : PROVIDER_COLORS[m.provider]
                      }`}>
                      {m.provider}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step 3 — Upload file */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
              <h2 className="text-sm font-bold text-slate-800">Upload file đánh giá</h2>
              <span className="text-[11px] text-slate-400">— .json hoặc .jsonl, các trường: <span className="font-mono">instruction, expected, subject</span></span>
            </div>

            <div
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) validateAndSetFile(f); }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl py-7 text-center cursor-pointer transition ${dragOver ? 'border-slate-500 bg-slate-50' : evalFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-400'
                }`}
            >
              <input ref={fileInputRef} type="file" accept=".json,.jsonl" className="hidden"
                onChange={e => e.target.files?.[0] && validateAndSetFile(e.target.files[0])} />
              {evalFile ? (
                <div className="flex items-center justify-center gap-4">
                  <svg className="w-7 h-7 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-700">{evalFile.name}</p>
                    <p className="text-xs text-slate-400">{(evalFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setEvalFile(null); }}
                    className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-1 rounded-lg">Xóa</button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-slate-400">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-medium">Kéo thả hoặc click để chọn file</p>
                  <p className="text-xs">.json / .jsonl · tối đa 50MB</p>
                </div>
              )}
            </div>
            {errorMsg && <p className="mt-2 text-xs text-red-500 font-medium">{errorMsg}</p>}
          </div>

          {/* Summary + Submit */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-500 space-y-1">
              {[
                { label: 'Model', value: selectedJob?.projectName, done: !!selectedJobId },
                { label: 'Judge', value: JUDGE_MODELS.find(m => m.id === judgeModel)?.name, done: !!judgeModel },
                { label: 'File', value: evalFile?.name, done: !!evalFile },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.done ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span>{item.label}: <span className="font-semibold text-slate-700">{item.value ?? 'Chưa chọn'}</span></span>
                </div>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0 px-8 py-3 rounded-xl font-semibold text-sm bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Bắt đầu đánh giá
            </button>
          </div>
        </div>

      ) : (
        /* Progress view */
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {phase === 'running' && <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />}
              {phase === 'done' && (
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {phase === 'error' && (
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {phase === 'uploading' && 'Đang gửi file...'}
                  {phase === 'running' && `Đang đánh giá — ${selectedJob?.projectName}`}
                  {phase === 'done' && 'Đánh giá hoàn tất'}
                  {phase === 'error' && 'Đã xảy ra lỗi'}
                </p>
                {phase === 'error' && <p className="text-xs text-red-500 mt-0.5">{errorMsg}</p>}
              </div>
            </div>
            {phase === 'done' && doneEvalId && (
              <button onClick={() => navigate(`/eval/${doneEvalId}`)}
                className="flex items-center gap-2 text-sm font-semibold bg-slate-800 text-white px-5 py-2 rounded-xl hover:bg-slate-700 transition">
                Xem kết quả
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>

          {/* Terminal log */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-800 border-b border-slate-700">
              <span className="w-3 h-3 rounded-full bg-red-400" /><span className="w-3 h-3 rounded-full bg-yellow-400" /><span className="w-3 h-3 rounded-full bg-green-400" />
              <span className="ml-2 text-xs text-slate-400 font-mono">eval log</span>
            </div>
            <div className="font-mono text-xs text-slate-300 p-4 h-96 overflow-y-auto space-y-0.5">
              {logs.length === 0 ? (
                <span className="text-slate-500">Chờ GPU service phản hồi...</span>
              ) : logs.map((line, i) => (
                <div key={i} className="leading-5">
                  <span className="text-slate-600 select-none mr-2">{String(i + 1).padStart(3, '0')}</span>
                  <span className={
                    line.includes('✅') || line.includes('🎉') ? 'text-emerald-400' :
                      line.includes('❌') || line.includes('LỖI') ? 'text-red-400' :
                        line.includes('📊') || line.includes('⚙️') ? 'text-sky-400' :
                          line.includes('💾') ? 'text-amber-400' : 'text-slate-300'
                  }>{line}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {(phase === 'done' || phase === 'error') && (
            <button
              onClick={() => { setPhase('idle'); setLogs([]); setEvalFile(null); setSelectedJobId(''); setErrorMsg(''); setDoneEvalId(null); setJobSearch(''); }}
              className="w-full py-3 rounded-xl font-semibold text-sm border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 transition bg-white"
            >
              Đánh giá model khác
            </button>
          )}
        </div>
      )}
    </div>
  );
};