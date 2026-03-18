import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { Evaluation } from '../models/Evaluation';
import { TrainingHistory } from '../models/TrainingHistory';
dotenv.config();

const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';

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
// POST /api/eval/run/:jobId
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

    // 4. Tạo Evaluation record trong MongoDB với status PENDING
    await Evaluation.create({
      evalId: eval_job_id,
      jobId,
      status: 'PENDING',
      totalSamples: 0,
      subjectBreakdown: {},
      skippedBySimilarity: 0,
      results: [],
      summary: {
        overall: { base_avg: 0, ft_avg: 0, improvement_pct: 0 },
        by_subject: {},
        max_possible: 5,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // 5. Build form gửi GPU service
    const config = {
      eval_job_id,
      job_id: jobId,
      hf_repo_id: history.hfRepoId,
      hf_token: history.hfToken || '',
      model_max_length: history.parameters?.modelMaxLength || 2048,
    };

    const form = new FormData();
    form.append('config', JSON.stringify(config));
    form.append('eval_file', fs.createReadStream(evalFile.path), {
      filename: evalFile.originalname,
      contentType: evalFile.mimetype || 'application/octet-stream',
      knownLength: evalFile.size,
    });

    // 6. Forward sang GPU service
    console.log(`[Backend] Forwarding eval to GPU: ${GPU_SERVICE_URL}/api/eval/start`);
    const gpuResponse = await fetchWithForm(`${GPU_SERVICE_URL}/api/eval/start`, form);

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
      await Evaluation.deleteOne({ evalId: eval_job_id });
      return res.status(gpuResponse.status).json(gpuData);
    }

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
// GET /api/eval/stream/:evalJobId
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
      const response = await fetch(`${GPU_SERVICE_URL}/api/eval/status/${evalJobId}`, {
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
          await Evaluation.updateOne({ evalId: evalJobId }, { status: 'FAILED' });
          // Tìm jobId để update TrainingHistory
          const evalDoc = await Evaluation.findOne({ evalId: evalJobId });
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
//               → update TrainingHistory status = 'evaluated'
// ---------------------------------------------------------------------------
async function _fetchAndSaveResult(evalJobId: string): Promise<void> {
  try {
    const resp = await fetch(`${GPU_SERVICE_URL}/api/eval/result/${evalJobId}`, {
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
    await Evaluation.findOneAndUpdate(
      { evalId: evalJobId },
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

    // Update TrainingHistory → evaluated
    await TrainingHistory.updateOne(
      { jobId: result.jobId },
      { status: 'evaluated' }
    );

    console.log(`[Backend] ✅ Eval result saved for ${evalJobId}, job ${result.jobId} → evaluated`);
  } catch (err: any) {
    console.error(`[Backend] _fetchAndSaveResult error for ${evalJobId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// POST /api/eval/save
// Dùng cho manual trigger từ fetchAndSaveEvalResult (trainController)
// Body: kết quả eval trực tiếp từ GPU (format cũ, evalId = "eval_<jobId>")
// ---------------------------------------------------------------------------
export const saveEvalResult = async (req: Request, res: Response) => {
  try {
    const result = req.body;
    if (!result || !result.evalId || !result.jobId) {
      return res.status(400).json({ error: 'Missing evalId or jobId in body' });
    }

    await Evaluation.findOneAndUpdate(
      { evalId: result.evalId },
      {
        evalId: result.evalId,
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

    await TrainingHistory.updateOne(
      { jobId: result.jobId },
      { status: 'evaluated' }
    );

    console.log(`[Backend] ✅ Eval saved via /api/eval/save for job ${result.jobId}`);
    return res.status(200).json({ message: 'Eval saved successfully' });
  } catch (err: any) {
    console.error('[Backend] saveEvalResult error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save eval result' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/eval/:evalId
// Trả Evaluation record cho EvaluationResultsScreen
// ---------------------------------------------------------------------------
export const getEvaluation = async (req: Request, res: Response) => {
  try {
    const { evalId } = req.params;
    const doc = await Evaluation.findOne({ evalId });
    if (!doc) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    return res.json(doc);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get evaluation' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/models
// Trả danh sách model có status = 'evaluated' (cho ModelListScreen mới)
// Join TrainingHistory với Evaluation mới nhất của mỗi job
// ---------------------------------------------------------------------------
export const getEvaluatedModels = async (_req: Request, res: Response) => {
  try {
    const histories = await TrainingHistory.find({ status: 'evaluated' }).lean();

    const result = await Promise.all(
      histories.map(async (h) => {
        // Lấy eval mới nhất theo completedAt
        const latestEval = await Evaluation.findOne({ jobId: h.jobId, status: 'COMPLETED' })
          .sort({ completedAt: -1 })
          .lean();

        return {
          jobId: h.jobId,
          projectName: h.projectName,
          baseModel: h.baseModel,
          completedAt: h.completedAt,
          trainingDuration: h.trainingDuration,
          evalId: latestEval?.evalId ?? null,
          totalSamples: latestEval?.totalSamples ?? 0,
          scores: {
            overall: latestEval?.summary?.overall ?? null,
            quality: latestEval?.summary?.quality ?? null,
            hallucination: latestEval?.summary?.hallucination ?? null,
            speed: latestEval?.summary?.speed ?? null,
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
// GET /api/eval/history/:jobId
// Trả tất cả Evaluation của 1 job (để xem lịch sử eval nhiều lần)
// ---------------------------------------------------------------------------
export const getEvalHistory = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const evals = await Evaluation.find({ jobId, status: 'COMPLETED' })
      .sort({ completedAt: -1 })
      .select('evalId jobId status totalSamples summary startedAt completedAt')
      .lean();
    return res.json(evals);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get eval history' });
  }
};
