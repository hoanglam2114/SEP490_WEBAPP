import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { ModelEvaluation, IEvalResult } from '../models/Evaluation';
import { TrainingHistory } from '../models/TrainingHistory';
dotenv.config();

import { getGpuServiceUrl } from '../utils/gpuConfig';

// ---------------------------------------------------------------------------
// Helper: lấy GPU status — kiểm tra trước khi dispatch eval
// ---------------------------------------------------------------------------
async function getGpuStatus(): Promise<{
  can_create_eval: boolean;
  active_evals: number;
  max_evals: number;
  vram_free_mb: number;
  vram_total_mb: number;
  vram_used_mb: number;
  gpu_util: number;
} | null> {
  try {
    const resp = await fetch(`${getGpuServiceUrl()}/api/system-eval/resources`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    // console.log('[Backend] GPU status response:', data);

    // Ensure all required fields are present, calculate missing ones
    const result = {
      can_create_eval: data.can_create_eval ?? true,
      active_evals: data.active_evals ?? 0,
      max_evals: data.max_evals ?? 3,
      vram_free_mb: data.vram_free_mb ?? (data.vram_total_mb - data.vram_used_mb),
      vram_total_mb: data.vram_total_mb,
      vram_used_mb: data.vram_used_mb,
      gpu_util: data.gpu_util ?? 0,
    };

    return result;
  } catch (err) {
    console.error('[Backend] GPU status error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: POST multipart/form-data với Content-Length (giống trainController)
// ---------------------------------------------------------------------------
async function fetchWithForm(url: string, form: FormData): Promise<ReturnType<typeof fetch>> {
  return new Promise((resolve, reject) => {
    form.getLength((err, length) => {
      if (err) {
        reject(new Error(`Could not compute form length: ${err.message}`));
        return;
      }
      resolve(
        fetch(url, {
          method: 'POST',
          body: form,
          headers: {
            ...form.getHeaders(),
            'Content-Length': String(length),
            'ngrok-skip-browser-warning': 'true',
          },
        })
      );
    });
  });
}

function normalizePerConvResults(perConvResults: unknown): IEvalResult[] {
  if (!Array.isArray(perConvResults)) return [];
  return perConvResults
    .filter((r: any) => r !== null && r !== undefined)
    .map((r: any) => ({
      conv_index:      Number(r.conv_index ?? 0),
      num_turns:       Number(r.num_turns ?? 0),
      avg_latency_ms:  Number(r.avg_latency_ms ?? 0),
      replay_turns:     Array.isArray(r.replay_turns) ? r.replay_turns : [],
      criteria_scores: r.criteria_scores ?? {},
      criteria_reasons: r.criteria_reasons ?? {},
      group_scores:    r.group_scores ?? {},
      non_scoring:     r.non_scoring ?? {},
      confidence: r.confidence ?? null,
    }));
}

function normalizeEvalResult(result: any) {
  const normalizedResults = normalizePerConvResults(
    result.perConvResults ?? result.per_conv_results ?? result.results ?? []
  );

  // summary từ GPU đã đúng format — chỉ cần pass through + fallback
  const summary = result.summary && typeof result.summary === 'object'
    ? result.summary
    : {};

  const baseSummary = result.baseSummary && typeof result.baseSummary === 'object'
    ? result.baseSummary : null;

  return {
    totalConversations: Number(result.totalConversations ?? result.totalSamples ?? normalizedResults.length),
    validConversations: Number(result.validConversations ?? normalizedResults.length),
    evalMode:           (result.evalMode === 'paired') ? 'paired' : 'single',
    ftModelRepo:        result.ftModelRepo ?? undefined,
    baseModelRepo:      result.baseModelRepo ?? undefined,
    results:            normalizedResults,
    baseResults:        normalizePerConvResults(result.basePerConvResults ?? []),
    summary,
    baseSummary,
    delta:              result.delta ?? null,
    flags:              Array.isArray(result.flags) ? result.flags : [],
    gpuResult:          result,
  };
}

// ---------------------------------------------------------------------------
// POST /api/model-eval/run/:jobId
// FE upload file đánh giá → BE forward sang GPU service POST /api/eval/start
// GPU nhận file + hf_repo_id → load model → chạy run_auto_evaluation()
// ---------------------------------------------------------------------------
export const runEvaluation = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // 1. Lấy TrainingHistory để lấy hf_repo_id và model_max_length
    const history = await TrainingHistory.findOne({ jobId });
    if (!history) {
      return res.status(404).json({ error: 'Job không tồn tại trong database' });
    }
    if (history.status !== 'COMPLETED') {
      return res.status(400).json({
        error: `Job phải ở trạng thái COMPLETED để đánh giá (hiện tại: ${history.status})`,
      });
    }
    if (!history.hfRepoId) {
      return res.status(400).json({
        error: 'Job chưa có hfRepoId — model phải đã được push lên HuggingFace Hub',
      });
    }

    // 2. Kiểm tra file eval được upload
    const evalFile = req.file;
    if (!evalFile) {
      return res.status(400).json({ error: 'Thiếu file đánh giá (eval_file)' });
    }

    // 3. Tạo eval_job_id
    const eval_job_id = `eval_${uuidv4()}`;
    console.log(`[Backend] Starting eval ${eval_job_id} for job ${jobId} → model=${history.hfRepoId}`);
    console.log(`[Backend] base_model_hf_repo from req.body: '${req.body.base_model_hf_repo}'`);
    console.log(`[Backend] req.body keys:`, Object.keys(req.body));

    const config = {
      eval_job_id,
      job_id: jobId,
      hf_repo_id: history.hfRepoId,
      hf_token: history.hfToken || '',
      model_max_length: history.parameters?.modelMaxLength || 2048,
      judge_model:          req.body.judge_model || req.body['judge_model'] || 'claude-sonnet-4-5-20251001',
      base_model_hf_repo:   req.body.base_model_hf_repo || '',
    };

    // 4. Tạo Evaluation record trong MongoDB với status PENDING
    await ModelEvaluation.create({
      modelEvalId: eval_job_id,
      jobId,
      status: 'PENDING',
      totalConversations: 0,
      validConversations: 0,
      results: [],
      evalMode:     config.base_model_hf_repo ? 'paired' : 'single',
      ftModelRepo:  history.hfRepoId,
      baseModelRepo:config.base_model_hf_repo || undefined,
      judgeModel:   config.judge_model,
      summary: {
        overall: 0,
        group_a: 0, group_b: 0, group_c: 0, group_d: 0,
        criteria: {},
        non_scoring: {},
        max_possible: 5,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const form = new FormData();
    form.append('config', JSON.stringify(config));
    form.append('eval_file', fs.createReadStream(evalFile.path), {
      filename: evalFile.originalname,
      contentType: evalFile.mimetype || 'application/octet-stream',
      knownLength: evalFile.size,
    });

    // 6. Kiểm tra GPU trước khi dispatch
    const gpuStatus = await getGpuStatus();
    if (!gpuStatus) {
      fs.unlink(evalFile.path, () => {});
      await ModelEvaluation.deleteOne({ modelEvalId: eval_job_id });
      return res.status(503).json({ error: 'gpu_offline', message: 'GPU service không phản hồi' });
    }
    if (!gpuStatus.can_create_eval) {
      fs.unlink(evalFile.path, () => {});
      await ModelEvaluation.deleteOne({ modelEvalId: eval_job_id });
      return res.status(503).json({
        error: 'worker_busy',
        message: `GPU đang bận (${gpuStatus.active_evals}/${gpuStatus.max_evals} slots, VRAM free: ${Math.round(gpuStatus.vram_free_mb / 1024)}GB)`,
        active_evals: gpuStatus.active_evals,
        max_evals: gpuStatus.max_evals,
        vram_free_mb: gpuStatus.vram_free_mb,
      });
    }

    // 7. Forward sang GPU service
    console.log(`[Backend] Forwarding eval to GPU: /api/eval/start (slots: ${gpuStatus.active_evals}/${gpuStatus.max_evals})`);
    const gpuResponse = await fetchWithForm(`${getGpuServiceUrl()}/api/eval/start`, form);

    if (gpuResponse.status === 409) {
      // Race condition: GPU vừa nhận job khác trong khoảng thời gian ngắn
      fs.unlink(evalFile.path, () => {});
      await ModelEvaluation.deleteOne({ modelEvalId: eval_job_id });
      return res.status(503).json({ error: 'worker_busy', message: 'GPU vừa nhận job khác, vui lòng thử lại' });
    }

    const responseText = await gpuResponse.text();
    console.log(`[Backend] GPU eval response (${gpuResponse.status}): ${responseText.slice(0, 300)}`);

    let gpuData: any;
    try {
      gpuData = JSON.parse(responseText);
    } catch {
      // Dọn file tạm nếu GPU lỗi
      fs.unlink(evalFile.path, () => { });
      return res.status(502).json({
        error: 'GPU service trả về non-JSON',
        raw: responseText.slice(0, 500),
      });
    }

    if (!gpuResponse.ok) {
      fs.unlink(evalFile.path, () => { });
      await ModelEvaluation.deleteOne({ modelEvalId: eval_job_id });
      return res.status(gpuResponse.status).json(gpuData);
    }

    // 8. Xóa file tạm (GPU đã lưu bản của nó rồi)
    fs.unlink(evalFile.path, (err) => {
      if (err) console.warn(`[Backend] Could not delete eval temp file: ${evalFile.path}`);
    });

    // 9. Update TrainingHistory status → EVALUATING
    await TrainingHistory.updateOne({ jobId }, { status: 'EVALUATING' });

    return res.status(201).json({
      eval_job_id,
      message: 'Eval job started',
    });
  } catch (err: any) {
    console.error('[Backend] runEvaluation error:', err);
    return res.status(500).json({ error: err.message || 'Failed to start evaluation' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/model-eval/stream/:evalJobId
// SSE — poll GPU /api/eval/status/:evalJobId mỗi 2s
// Khi COMPLETED → gọi GPU lấy result → lưu MongoDB → update TrainingHistory
// ---------------------------------------------------------------------------
export const streamEvalStatus = async (req: Request, res: Response) => {
  const { evalJobId } = req.params;

  if (!evalJobId || evalJobId === 'null' || evalJobId === 'undefined') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid evalJobId' })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const intervalId = setInterval(async () => {
    try {
      const response = await fetch(`${getGpuServiceUrl()}/api/eval/status/${evalJobId}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        return; // bỏ qua tick này nếu GPU trả HTML/error
      }

      res.write(`data: ${JSON.stringify(data)}\n\n`);

      if (['COMPLETED', 'FAILED'].includes(data.status)) {
        clearInterval(intervalId);

        if (data.status === 'COMPLETED') {
          // Lấy kết quả từ GPU rồi lưu MongoDB
          await _fetchAndSaveResult(evalJobId);
        } else {
          // FAILED — cập nhật DB
          await ModelEvaluation.updateOne({ modelEvalId: evalJobId }, { status: 'FAILED' });
          // Tìm jobId để update TrainingHistory
          const evalDoc = await ModelEvaluation.findOne({ modelEvalId: evalJobId });
          if (evalDoc) {
            await TrainingHistory.updateOne(
              { jobId: evalDoc.jobId },
              { status: 'COMPLETED' } // rollback về COMPLETED để có thể thử lại
            );
          }
        }

        res.write(`event: end\ndata: ${JSON.stringify(data)}\n\n`);
        res.end();
      }
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      clearInterval(intervalId);
      res.end();
    }
  }, 2000);

  req.on('close', () => clearInterval(intervalId));
};

// ---------------------------------------------------------------------------
// Helper nội bộ: lấy kết quả từ GPU → lưu Evaluation MongoDB
//               → TrainingHistory: status COMPLETED (train xong), auto-pin nếu chưa có
// ---------------------------------------------------------------------------
async function _fetchAndSaveResult(evalJobId: string): Promise<void> {
  try {
    const resp = await fetch(`${getGpuServiceUrl()}/api/eval/result/${evalJobId}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });

    if (!resp.ok) {
      console.error(`[Backend] GPU /api/eval/result trả về ${resp.status}`);
      return;
    }

    const result = (await resp.json()) as Record<string, any>;

    if (!result || result.status === 'PENDING') {
      console.warn(`[Backend] Eval result chưa sẵn sàng cho ${evalJobId}`);
      return;
    }

    const normalized = normalizeEvalResult(result);

    // Lưu vào Evaluation collection
    await ModelEvaluation.findOneAndUpdate(
      { modelEvalId: evalJobId },
      {
        status:             'COMPLETED',
        evalMode:           normalized.evalMode,
        ftModelRepo:        normalized.ftModelRepo,
        baseModelRepo:      normalized.baseModelRepo,
        totalConversations: normalized.totalConversations,
        validConversations: normalized.validConversations,
        results:            normalized.results,
        baseResults:        normalized.baseResults,
        summary:            normalized.summary,
        baseSummary:        normalized.baseSummary,
        delta:              normalized.delta,
        gpuResult:          normalized.gpuResult,
        judgeModel:         result.judgeModel ?? undefined,
        startedAt:          result.startedAt ? new Date(result.startedAt) : new Date(),
        completedAt:        result.completedAt ? new Date(result.completedAt) : new Date(),
        flags:              normalized.flags,
      },
      { upsert: true }
    );

    // Training job vẫn là COMPLETED; Leaderboard dựa vào pinnedEvalId (auto-pin lần eval đầu)
    const history = await TrainingHistory.findOne({ jobId: result.jobId });
    const updateFields: Record<string, any> = { status: 'COMPLETED' };
    if (!history?.pinnedEvalId) {
      updateFields.pinnedEvalId = evalJobId;
      console.log(`[Backend] 📌 Auto-pinned first eval ${evalJobId} for job ${result.jobId}`);
    }
    await TrainingHistory.updateOne({ jobId: result.jobId }, updateFields);

    console.log(`[Backend] ✅ Eval result saved for ${evalJobId}, job ${result.jobId} → COMPLETED + pin nếu cần`);
  } catch (err: any) {
    console.error(`[Backend] _fetchAndSaveResult error for ${evalJobId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/model-eval/gpu-status
// FE gọi để hiển thị GPU status widget và quyết định có cho tạo eval mới không
// ---------------------------------------------------------------------------
export const getGpuStatusEndpoint = async (_req: Request, res: Response) => {
  const status = await getGpuStatus();
  if (!status) {
    return res.status(503).json({ error: 'gpu_offline', message: 'GPU service không phản hồi' });
  }
  return res.json(status);
};

// ---------------------------------------------------------------------------
// POST /api/model-eval/save
// Dùng cho manual trigger từ fetchAndSaveEvalResult (trainController)
// Body: kết quả eval trực tiếp từ GPU (format cũ, modelEvalId = "eval_<jobId>")
// ---------------------------------------------------------------------------
export const saveEvalResult = async (req: Request, res: Response) => {
  try {
    const result = req.body;
    if (!result || !result.modelEvalId || !result.jobId) {
      return res.status(400).json({ error: 'Missing modelEvalId or jobId in body' });
    }

    const normalized = normalizeEvalResult(result);

    await ModelEvaluation.findOneAndUpdate(
      { modelEvalId: result.modelEvalId },
      {
        modelEvalId: result.modelEvalId,
        jobId: result.jobId,
        status: result.status || 'COMPLETED',
        evalMode:           normalized.evalMode,
        ftModelRepo:        normalized.ftModelRepo,
        baseModelRepo:      normalized.baseModelRepo,
        totalConversations: normalized.totalConversations,
        validConversations: normalized.validConversations,
        results:            normalized.results,
        baseResults:        normalized.baseResults,
        summary:            normalized.summary,
        baseSummary:        normalized.baseSummary,
        delta:              normalized.delta,
        gpuResult:          normalized.gpuResult,
        startedAt: result.startedAt ? new Date(result.startedAt) : new Date(),
        completedAt: result.completedAt ? new Date(result.completedAt) : new Date(),
      },
      { upsert: true, new: true }
    );

    const history = await TrainingHistory.findOne({ jobId: result.jobId });
    const updateFields: Record<string, any> = { status: 'COMPLETED' };
    if (!history?.pinnedEvalId) {
      updateFields.pinnedEvalId = result.modelEvalId;
      console.log(`[Backend] 📌 Auto-pinned eval ${result.modelEvalId} for job ${result.jobId} (save endpoint)`);
    }
    await TrainingHistory.updateOne({ jobId: result.jobId }, updateFields);

    console.log(`[Backend] ✅ Eval saved via /api/model-eval/save for job ${result.jobId}`);
    return res.status(200).json({ message: 'Eval saved successfully' });
  } catch (err: any) {
    console.error('[Backend] saveEvalResult error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save eval result' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/model-eval/:evalId
// Trả Evaluation record cho ModelEvalResultScreen
// ---------------------------------------------------------------------------
export const getEvaluation = async (req: Request, res: Response) => {
  try {
    const { evalId } = req.params;
    const doc = await ModelEvaluation.findOne({ modelEvalId: evalId }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    // Kiểm tra xem eval này có đang được pin không
    const history = await TrainingHistory.findOne({ jobId: doc.jobId })
      .select('pinnedEvalId projectName')
      .lean();
    return res.json({
      ...doc,
      isPinned: history?.pinnedEvalId === evalId,
      projectName: history?.projectName ?? '',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get evaluation' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/model-eval/leaderboard
// Chỉ job đã có eval được chọn (pinned) — ít nhất 1 lần eval xong có pinnedEvalId
// ---------------------------------------------------------------------------
export const getEvaluatedModels = async (_req: Request, res: Response) => {
  try {
    const histories = await TrainingHistory.find({
      pinnedEvalId: { $exists: true, $ne: null },
    }).lean();

    const result = await Promise.all(
      histories.map(async (h) => {
        const latestEval = await ModelEvaluation.findOne({ jobId: h.jobId, status: 'COMPLETED' })
          .sort({ completedAt: -1 })
          .lean();

        let displayEval = latestEval;
        if (h.pinnedEvalId) {
          const pinned = await ModelEvaluation.findOne({
            jobId: h.jobId,
            modelEvalId: h.pinnedEvalId,
            status: 'COMPLETED',
          }).lean();
          if (pinned) displayEval = pinned;
        }

        const modelEvalId = displayEval?.modelEvalId ?? null;

        return {
          jobId: h.jobId,
          projectName: h.projectName,
          baseModel: h.baseModel,
          completedAt: h.completedAt,
          trainingDuration: h.trainingDuration,
          /** ID eval dùng cho điểm + nút View — ưu tiên eval Official (pinned), không có thì mới nhất */
          modelEvalId,
          pinnedEvalId: h.pinnedEvalId ?? null,
          judgeModel: displayEval?.judgeModel ?? null,
          totalConversations: displayEval?.totalConversations ?? 0,
          flags: displayEval?.flags ?? [],
          scores: {
            overall:  displayEval?.summary?.overall  ?? null,
            group_a:  displayEval?.summary?.group_a  ?? null,
            group_b:  displayEval?.summary?.group_b  ?? null,
            group_c:  displayEval?.summary?.group_c  ?? null,
            group_d:  displayEval?.summary?.group_d  ?? null,
            criteria: displayEval?.summary?.criteria ?? null,
            avg_latency_ms: displayEval?.summary?.avg_latency_ms ?? null,
            non_scoring:    displayEval?.summary?.non_scoring    ?? null,
          },
        };
      })
    );

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get evaluated models' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/model-eval/history/:jobId
// Trả tất cả Evaluation của 1 job (để xem lịch sử eval nhiều lần)
// ---------------------------------------------------------------------------
export const getEvalHistory = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Lấy pinnedEvalId từ TrainingHistory
    const history = await TrainingHistory.findOne({ jobId }).select('pinnedEvalId projectName baseModel').lean();

    const evals = await ModelEvaluation.find({ jobId, status: 'COMPLETED' })
      .sort({ completedAt: -1 })
      .select('modelEvalId jobId status totalConversations judgeModel summary startedAt completedAt')
      .lean();

    // Gắn isPinned vào từng eval
    const evalsWithPin = evals.map((e) => ({
      ...e,
      isPinned: e.modelEvalId === history?.pinnedEvalId,
    }));

    return res.json({
      jobId,
      projectName: history?.projectName ?? '',
      baseModel: history?.baseModel ?? '',
      pinnedEvalId: history?.pinnedEvalId ?? null,
      evals: evalsWithPin,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get eval history' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/model-eval/pin/:evalId
// Pin 1 eval làm "official" cho leaderboard — cập nhật TrainingHistory.pinnedEvalId
// Eval cũ được unpin tự động (chỉ 1 eval được pin tại 1 thời điểm)
// ---------------------------------------------------------------------------
export const pinEvaluation = async (req: Request, res: Response) => {
  try {
    const { evalId } = req.params;

    // Tìm eval để lấy jobId
    const evalDoc = await ModelEvaluation.findOne({ modelEvalId: evalId, status: 'COMPLETED' });
    if (!evalDoc) {
      return res.status(404).json({ error: 'Evaluation not found or not completed' });
    }

    // Update pinnedEvalId trên TrainingHistory (ghi đè eval cũ)
    const result = await TrainingHistory.findOneAndUpdate(
      { jobId: evalDoc.jobId },
      { pinnedEvalId: evalId },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    console.log(`[Backend] 📌 Pinned eval ${evalId} as official for job ${evalDoc.jobId}`);
    return res.status(200).json({
      message: 'Eval pinned successfully',
      jobId: evalDoc.jobId,
      pinnedEvalId: evalId,
    });
  } catch (err: any) {
    console.error('[Backend] pinEvaluation error:', err);
    return res.status(500).json({ error: err.message || 'Failed to pin evaluation' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/model-eval/:evalId
// Xóa eval; nếu đang pin → auto-pin eval COMPLETED mới nhất còn lại (hoặc null)
// ---------------------------------------------------------------------------
export const deleteEvaluation = async (req: Request, res: Response) => {
  try {
    const { evalId } = req.params;
    const evalDoc = await ModelEvaluation.findOne({ modelEvalId: evalId });
    if (!evalDoc) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    const { jobId } = evalDoc;
    const history = await TrainingHistory.findOne({ jobId }).select('pinnedEvalId').lean();
    const wasPinned = history?.pinnedEvalId === evalId;

    await ModelEvaluation.deleteOne({ modelEvalId: evalId });

    let newPinnedEvalId: string | null = null;
    if (wasPinned) {
      const newest = await ModelEvaluation.findOne({ jobId, status: 'COMPLETED' })
        .sort({ completedAt: -1 })
        .select('modelEvalId')
        .lean();
      newPinnedEvalId = newest?.modelEvalId ?? null;
      await TrainingHistory.updateOne({ jobId }, { $set: { pinnedEvalId: newPinnedEvalId } });
      console.log(`[Backend] After delete, repinned job ${jobId} → ${newPinnedEvalId ?? 'null'}`);
    }

    return res.json({
      message: 'Evaluation deleted',
      newPinnedEvalId: wasPinned ? newPinnedEvalId : history?.pinnedEvalId ?? null,
    });
  } catch (err: any) {
    console.error('[Backend] deleteEvaluation error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete evaluation' });
  }
};

type CompareWinner = 'a' | 'b' | 'tie';

function scoreWinner(va: number | null | undefined, vb: number | null | undefined, higherIsBetter = true): CompareWinner {
  if (va == null && vb == null) return 'tie';
  if (va == null) return 'b';
  if (vb == null) return 'a';
  const eps = 1e-6;
  if (Math.abs(va - vb) < eps) return 'tie';
  if (higherIsBetter) return va > vb ? 'a' : 'b';
  return va < vb ? 'a' : 'b';
}

// ---------------------------------------------------------------------------
// GET /api/model-eval/compare?a=&b=
// So sánh 2 eval: metadata + điểm + mẫu trùng instruction (inner join)
// ---------------------------------------------------------------------------
export const compareEvaluations = async (req: Request, res: Response) => {
  try {
    const aId = typeof req.query.a === 'string' ? req.query.a : '';
    const bId = typeof req.query.b === 'string' ? req.query.b : '';
    if (!aId || !bId) {
      return res.status(400).json({ error: 'Thiếu query a hoặc b' });
    }
    if (aId === bId) {
      return res.status(400).json({ error: 'Hai eval phải khác nhau' });
    }

    const [evalA, evalB] = await Promise.all([
      ModelEvaluation.findOne({ modelEvalId: aId }).lean(),
      ModelEvaluation.findOne({ modelEvalId: bId }).lean(),
    ]);
    if (!evalA || !evalB) {
      return res.status(404).json({ error: 'Không tìm thấy một hoặc cả hai bản đánh giá' });
    }

    const [histA, histB] = await Promise.all([
      TrainingHistory.findOne({ jobId: evalA.jobId }).select('projectName').lean(),
      TrainingHistory.findOne({ jobId: evalB.jobId }).select('projectName').lean(),
    ]);

    const mapA = new Map<number, (typeof evalA.results)[0]>();
    for (const r of evalA.results || []) {
      if (r.conv_index != null) mapA.set(r.conv_index, r);
    }

    const matchedSamples: {
      conv_index: number;
      num_turns_a: number;
      num_turns_b: number;
      overall_a: number;
      overall_b: number;
      delta_overall: number;
    }[] = [];

    for (const rowB of evalB.results || []) {
      const rowA = mapA.get(rowB.conv_index);
      if (!rowA) continue;
      matchedSamples.push({
        conv_index: rowB.conv_index,
        num_turns_a: rowA.num_turns,
        num_turns_b: rowB.num_turns,
        overall_a: rowA.group_scores?.overall ?? 0,
        overall_b: rowB.group_scores?.overall ?? 0,
        delta_overall: (rowB.group_scores?.overall ?? 0) - (rowA.group_scores?.overall ?? 0),
      });
    }

    const lenA = evalA.results?.length ?? 0;
    const lenB = evalB.results?.length ?? 0;
    const differentTestSets =
      evalA.totalConversations !== evalB.totalConversations ||
      lenA !== lenB ||
      matchedSamples.length < lenA ||
      matchedSamples.length < lenB;

    const sA = evalA.summary;
    const sB = evalB.summary;

    const scoreSummary = {
      overall: {
        a: sA?.overall ?? null,
        b: sB?.overall ?? null,
        winner: scoreWinner(sA?.overall, sB?.overall),
      },
      group_a: {
        a: sA?.group_a ?? null,
        b: sB?.group_a ?? null,
        winner: scoreWinner(sA?.group_a, sB?.group_a),
      },
      group_b: {
        a: sA?.group_b ?? null,
        b: sB?.group_b ?? null,
        winner: scoreWinner(sA?.group_b, sB?.group_b),
      },
      group_c: {
        a: sA?.group_c ?? null,
        b: sB?.group_c ?? null,
        winner: scoreWinner(sA?.group_c, sB?.group_c),
      },
      group_d: {
        a: sA?.group_d ?? null,
        b: sB?.group_d ?? null,
        winner: scoreWinner(sA?.group_d, sB?.group_d),
      },
      bleu: {
        a: sA?.non_scoring?.bleu ?? null,
        b: sB?.non_scoring?.bleu ?? null,
        winner: scoreWinner(sA?.non_scoring?.bleu, sB?.non_scoring?.bleu),
      },
      rouge_l: {
        a: sA?.non_scoring?.rouge_l ?? null,
        b: sB?.non_scoring?.rouge_l ?? null,
        winner: scoreWinner(sA?.non_scoring?.rouge_l, sB?.non_scoring?.rouge_l),
      },
    };

    const runA = {
      modelEvalId: evalA.modelEvalId,
      jobId: evalA.jobId,
      projectName: histA?.projectName ?? '',
      judgeModel: evalA.judgeModel ?? '',
      completedAt: evalA.completedAt,
      totalConversations: evalA.totalConversations,
    };
    const runB = {
      modelEvalId: evalB.modelEvalId,
      jobId: evalB.jobId,
      projectName: histB?.projectName ?? '',
      judgeModel: evalB.judgeModel ?? '',
      completedAt: evalB.completedAt,
      totalConversations: evalB.totalConversations,
    };

    return res.json({
      runA,
      runB,
      scoreSummary,
      matchedSamples,
      matchedCount: matchedSamples.length,
      differentTestSetsNote: differentTestSets,
    });
  } catch (err: any) {
    console.error('[Backend] compareEvaluations error:', err);
    return res.status(500).json({ error: err.message || 'Failed to compare evaluations' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/model-eval/:evalId/review/:convIndex
// Body: { verdict: 'agree'|'disagree'|'skip', note?: string, reviewer?: string }
// ---------------------------------------------------------------------------
export const reviewConversation = async (req: Request, res: Response) => {
  try {
    const { evalId, convIndex } = req.params;
    const { verdict, note, reviewer } = req.body;

    if (!['agree', 'disagree', 'skip'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict phải là agree | disagree | skip' });
    }

    const idx = parseInt(convIndex);
    if (isNaN(idx)) {
      return res.status(400).json({ error: 'convIndex không hợp lệ' });
    }

    const evalDoc = await ModelEvaluation.findOne({ modelEvalId: evalId });
    if (!evalDoc) return res.status(404).json({ error: 'Evaluation not found' });

    // Tìm conversation theo conv_index
    const convResult = evalDoc.results.find((r: any) => r.conv_index === idx);
    if (!convResult) return res.status(404).json({ error: `Conversation ${idx} not found` });

    // Update human_review
    convResult.human_review = {
      verdict,
      note: note?.trim() || undefined,
      reviewer: reviewer?.trim() || 'anonymous',
      reviewed_at: new Date(),
    };

    await evalDoc.save();

    // Tính lại review stats
    const reviewed = evalDoc.results.filter((r: any) => r.human_review?.verdict !== 'skip' && r.human_review);
    const agreed   = reviewed.filter((r: any) => r.human_review?.verdict === 'agree').length;
    const total    = evalDoc.results.filter((r: any) => r.human_review).length;

    return res.json({
      message: 'Review saved',
      conv_index: idx,
      verdict,
      stats: {
        total_reviewed: total,
        agreed,
        disagreed: reviewed.length - agreed,
        agreement_rate: reviewed.length > 0 ? Math.round((agreed / reviewed.length) * 100) : null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};