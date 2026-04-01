import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { ModelEvaluation } from '../models/Evaluation';
import { TrainingHistory } from '../models/TrainingHistory';
dotenv.config();

const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
const GPU_WORKERS = process.env.GPU_WORKERS
  ? process.env.GPU_WORKERS.split(',').map((w) => w.trim())
  : [GPU_SERVICE_URL];

// evalJobId -> worker URL mapping
const workerRegistry = new Map<string, string>();

function pickAvailableWorker(): string {
  // simple random selection
  return GPU_WORKERS[Math.floor(Math.random() * GPU_WORKERS.length)];
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

    const config = {
      eval_job_id,
      job_id: jobId,
      hf_repo_id: history.hfRepoId,
      hf_token: history.hfToken || '',
      model_max_length: history.parameters?.modelMaxLength || 2048,
      judge_model: req.body.judge_model || req.body['judge_model'] || 'claude-haiku-4-5-20251001',
    };

    // 4. Tạo Evaluation record trong MongoDB với status PENDING
    await ModelEvaluation.create({
      modelEvalId: eval_job_id,
      jobId,
      status: 'PENDING',
      totalSamples: 0,
      subjectBreakdown: {},
      skippedBySimilarity: 0,
      results: [],
      judgeModel: config.judge_model,
      summary: {
        overall: { base_avg: 0, ft_avg: 0, improvement_pct: 0 },
        by_subject: {},
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

    // 6. Forward sang GPU service
    const workerUrl = pickAvailableWorker();
    console.log(`[Backend] Forwarding eval to GPU worker (${workerUrl}): /api/eval/start`);
    const gpuResponse = await fetchWithForm(`${workerUrl}/api/eval/start`, form);

    if (gpuResponse.status === 409) {
      fs.unlink(evalFile.path, () => { });
      await ModelEvaluation.deleteOne({ modelEvalId: eval_job_id });
      return res.status(503).json({ error: 'worker_busy' });
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

    // Save evalJobId to worker mapped in registry
    workerRegistry.set(eval_job_id, workerUrl);

    // 7. Xóa file tạm (GPU đã lưu bản của nó rồi)
    fs.unlink(evalFile.path, (err) => {
      if (err) console.warn(`[Backend] Could not delete eval temp file: ${evalFile.path}`);
    });

    // 8. Update TrainingHistory status → EVALUATING
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
      const workerUrl = workerRegistry.get(evalJobId) || GPU_WORKERS[0];
      const response = await fetch(`${workerUrl}/api/eval/status/${evalJobId}`, {
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
    const workerUrl = workerRegistry.get(evalJobId) || GPU_WORKERS[0];
    const resp = await fetch(`${workerUrl}/api/eval/result/${evalJobId}`, {
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

    // Lưu vào Evaluation collection
    await ModelEvaluation.findOneAndUpdate(
      { modelEvalId: evalJobId },
      {
        status: 'COMPLETED',
        totalSamples: result.totalSamples ?? 0,
        subjectBreakdown: result.subjectBreakdown ?? {},
        skippedBySimilarity: result.skippedBySimilarity ?? 0,
        results: result.results ?? [],
        summary: result.summary,
        startedAt: result.startedAt ? new Date(result.startedAt) : new Date(),
        completedAt: result.completedAt ? new Date(result.completedAt) : new Date(),
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

    await ModelEvaluation.findOneAndUpdate(
      { modelEvalId: result.modelEvalId },
      {
        modelEvalId: result.modelEvalId,
        jobId: result.jobId,
        status: result.status || 'COMPLETED',
        totalSamples: result.totalSamples ?? 0,
        subjectBreakdown: result.subjectBreakdown ?? {},
        skippedBySimilarity: result.skippedBySimilarity ?? 0,
        results: result.results ?? [],
        summary: result.summary,
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
          totalSamples: displayEval?.totalSamples ?? 0,
          scores: {
            overall: displayEval?.summary?.overall ?? null,
            quality: displayEval?.summary?.quality ?? null,
            hallucination: displayEval?.summary?.hallucination ?? null,
            speed: displayEval?.summary?.speed ?? null,
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
      .select('modelEvalId jobId status totalSamples judgeModel summary startedAt completedAt')
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

    const mapA = new Map<string, (typeof evalA.results)[0]>();
    for (const r of evalA.results || []) {
      if (!mapA.has(r.instruction)) mapA.set(r.instruction, r);
    }

    const matchedSamples: {
      instruction: string;
      subject: string;
      expected: string;
      ft_answer_a: string;
      ft_answer_b: string;
      ft_score_a: number;
      ft_score_b: number;
      delta_ft: number;
    }[] = [];

    for (const rowB of evalB.results || []) {
      const rowA = mapA.get(rowB.instruction);
      if (!rowA) continue;
      matchedSamples.push({
        instruction: rowB.instruction,
        subject: rowB.subject,
        expected: rowB.expected,
        ft_answer_a: rowA.ft_answer,
        ft_answer_b: rowB.ft_answer,
        ft_score_a: rowA.ft_score,
        ft_score_b: rowB.ft_score,
        delta_ft: rowB.ft_score - rowA.ft_score,
      });
    }

    const lenA = evalA.results?.length ?? 0;
    const lenB = evalB.results?.length ?? 0;
    const differentTestSets =
      evalA.totalSamples !== evalB.totalSamples ||
      lenA !== lenB ||
      matchedSamples.length < lenA ||
      matchedSamples.length < lenB;

    const sA = evalA.summary;
    const sB = evalB.summary;

    const bleuA = sA?.reference_metrics?.bleu?.ft ?? null;
    const bleuB = sB?.reference_metrics?.bleu?.ft ?? null;
    const rougeA = sA?.reference_metrics?.rouge_l?.ft ?? null;
    const rougeB = sB?.reference_metrics?.rouge_l?.ft ?? null;

    const scoreSummary = {
      overall: {
        a: sA?.overall?.ft_avg ?? null,
        b: sB?.overall?.ft_avg ?? null,
        winner: scoreWinner(sA?.overall?.ft_avg, sB?.overall?.ft_avg),
      },
      quality: {
        a: sA?.quality?.ft_avg ?? null,
        b: sB?.quality?.ft_avg ?? null,
        winner: scoreWinner(sA?.quality?.ft_avg, sB?.quality?.ft_avg),
      },
      hallucination: {
        a: sA?.hallucination?.ft_avg ?? null,
        b: sB?.hallucination?.ft_avg ?? null,
        winner: scoreWinner(sA?.hallucination?.ft_avg, sB?.hallucination?.ft_avg),
      },
      speed: {
        a: sA?.speed?.ft_score ?? null,
        b: sB?.speed?.ft_score ?? null,
        winner: scoreWinner(sA?.speed?.ft_score, sB?.speed?.ft_score),
      },
      bleu: {
        a: bleuA,
        b: bleuB,
        winner: scoreWinner(bleuA, bleuB),
      },
      rouge_l: {
        a: rougeA,
        b: rougeB,
        winner: scoreWinner(rougeA, rougeB),
      },
    };

    const runA = {
      modelEvalId: evalA.modelEvalId,
      jobId: evalA.jobId,
      projectName: histA?.projectName ?? '',
      judgeModel: evalA.judgeModel ?? '',
      completedAt: evalA.completedAt,
      totalSamples: evalA.totalSamples,
    };
    const runB = {
      modelEvalId: evalB.modelEvalId,
      jobId: evalB.jobId,
      projectName: histB?.projectName ?? '',
      judgeModel: evalB.judgeModel ?? '',
      completedAt: evalB.completedAt,
      totalSamples: evalB.totalSamples,
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