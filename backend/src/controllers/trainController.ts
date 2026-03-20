import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { TrainingHistory } from '../models/TrainingHistory';
import path from 'path';
dotenv.config();

/**
 * GPU Service URL — set GPU_SERVICE_URL in backend/.env
 * Default stays at localhost:5000 so the mock server still works without any .env change.
 */
const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const GOOGLE_DRIVE_CREDENTIALS = process.env.GOOGLE_DRIVE_CREDENTIALS || '';

// Parse Google Drive credentials once at startup
let parsedGoogleCredentials: any = null;
if (GOOGLE_DRIVE_CREDENTIALS) {
  try {
    parsedGoogleCredentials = JSON.parse(GOOGLE_DRIVE_CREDENTIALS);
  } catch (e) {
    console.error('[Backend] Lỗi: GOOGLE_DRIVE_CREDENTIALS không phải là JSON hợp lệ.');
  }
}

// ---------------------------------------------------------------------------
// Helper: forward a FormData to the GPU service with proper Content-Length.
//
// ROOT CAUSE OF THE BUG:
//   node-fetch v2 + form-data streams do NOT automatically include
//   Content-Length in the request.  Flask / Werkzeug requires Content-Length
//   to parse a multipart body; without it every field arrives as None.
//
// FIX STRATEGY:
//   • When there is NO file  → serialise the whole form into a Buffer first
//     (synchronous, cheap for small payloads) and send that.  The buffer has
//     a known length so we can set Content-Length explicitly.
//   • When there IS a file   → use form.getLength() (async) to obtain the
//     real length before streaming.  This avoids loading the entire file into
//     RAM while still giving Flask the length it needs.
// ---------------------------------------------------------------------------
async function fetchWithForm(url: string, form: FormData): Promise<ReturnType<typeof fetch>> {
  return new Promise((resolve, reject) => {
    form.getLength((err, length) => {
      if (err) {
        reject(new Error(`Could not compute form length: ${err.message}`));
        return;
      }

      const headers = {
        ...form.getHeaders(),
        'Content-Length': String(length),
        'ngrok-skip-browser-warning': 'true', // Skip ngrok free tier warning page
      };

      resolve(
        fetch(url, {
          method: 'POST',
          body: form,
          headers,
        })
      );
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/train/start
// FE sends multipart/form-data (file + params)
// BE generates job_id, forwards EVERYTHING (including the dataset file)
// to the GPU service as multipart/form-data, then returns the response to FE.
// ---------------------------------------------------------------------------
export const startTraining = async (req: Request, res: Response) => {
  try {
    const {
      model_name,
      epochs,
      batchSize,
      learningRate,
      blockSize,
      modelMaxLength,
      dataset, // HuggingFace Hub ID string (if no file uploaded)
      // New parameters
      r,
      lora_alpha,
      lora_dropout,
      random_state,
      gradient_accumulation_steps,
      warmup_steps,
      optim,
      weight_decay,
      lr_scheduler_type,
      seed,
      hf_repo_id,
      hf_token,
      // Metadata from frontend to save initial TrainingHistory
      projectName,
      datasetSource,
      columnMapping,
    } = req.body;

    const datasetFile = req.file; // populated by multer when a file is uploaded

    // ── Validation ──────────────────────────────────────────────────────────
    if (!model_name || typeof model_name !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid model_name' });
    }

    const epochsNum = parseInt(epochs as string);
    if (isNaN(epochsNum) || epochsNum < 1) {
      return res.status(400).json({ error: 'Missing or invalid epochs (must be >= 1)' });
    }

    if (!datasetFile && !dataset) {
      return res.status(400).json({
        error: "Provide either a 'dataset_file' upload or a 'dataset' HuggingFace Hub ID.",
      });
    }

    // ── Generate job ID ─────────────────────────────────────────────────────
    const job_id = `job_${uuidv4()}`;
    console.log(`[Backend] Starting job ${job_id} → model=${model_name} epochs=${epochsNum}`);

    // ── Build JSON config for GPU Service ─────────────────────────────────────
    const config: any = {
      job_id,
      model_name,
      epochs: epochsNum,
      batchSize: parseInt(batchSize as string) || 1,
      learningRate: parseFloat(learningRate as string) || 2e-4,
      blockSize: parseInt(blockSize as string) || 512,
      modelMaxLength: parseInt(modelMaxLength as string) || 2048,
      r: parseInt(r as string) || 16,
      lora_alpha: parseInt(lora_alpha as string) || 16,
      lora_dropout: parseFloat(lora_dropout as string) || 0,
      random_state: parseInt(random_state as string) || 3407,
      gradient_accumulation_steps: parseInt(gradient_accumulation_steps as string) || 4,
      warmup_steps: parseInt(warmup_steps as string) || 5,
      optim: (optim as string) || 'adamw_8bit',
      weight_decay: parseFloat(weight_decay as string) || 0.01,
      lr_scheduler_type: (lr_scheduler_type as string) || 'linear',
      seed: parseInt(seed as string) || 3407,
      push_to_hub: true, // Always true as requested
      hf_repo_id: hf_repo_id || '',
      hf_token: hf_token || '',
      // Google Drive for checkpoint saving
      drive_folder_id: GOOGLE_DRIVE_FOLDER_ID,
      service_account: parsedGoogleCredentials,
    };

    // If no file uploaded, embed HF Hub ID directly into config
    if (!datasetFile) {
      config.dataset_hf_id = dataset as string;
    }

    const form = new FormData();
    form.append('config', JSON.stringify(config));

    if (datasetFile) {
      form.append('file', fs.createReadStream(datasetFile.path), {
        filename: datasetFile.originalname,
        contentType: datasetFile.mimetype || 'application/octet-stream',
        knownLength: datasetFile.size,
      });
    }

    // ── Forward to GPU Service (with explicit Content-Length) ───────────────
    console.log(`[Backend] Forwarding to GPU service: ${GPU_SERVICE_URL}/api/train/start`);

    const gpuResponse = await fetchWithForm(`${GPU_SERVICE_URL}/api/train/start`, form);

    // Log raw response text first — helps debug if GPU service returns HTML/error pages
    const responseText = await gpuResponse.text();
    console.log(`[Backend] GPU response (${gpuResponse.status}): ${responseText.slice(0, 300)}`);

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: 'GPU service returned non-JSON response',
        raw: responseText.slice(0, 500),
      });
    }

    let savedDatasetPath: string | undefined;

    // Clean up the temporary upload file on the backend to save disk space
    if (datasetFile) {
      // Create a persistent directory for datasets if it doesn't exist
      const persistentDir = path.join(process.cwd(), 'uploads', 'persistent_datasets');
      if (!fs.existsSync(persistentDir)) {
        fs.mkdirSync(persistentDir, { recursive: true });
      }

      savedDatasetPath = path.join(persistentDir, `${job_id}_${datasetFile.originalname}`);

      // Move the file instead of deleting it
      fs.rename(datasetFile.path, savedDatasetPath, (err) => {
        if (err) {
          console.warn(`[Backend] Could not move dataset file: ${datasetFile.path}`, err);
          savedDatasetPath = undefined;
          fs.unlink(datasetFile.path, () => { }); // Fallback to delete
        } else {
          console.log(`[Backend] Dataset saved persistently for Resume: ${savedDatasetPath}`);
        }
      });
    }

    // --- CREATE INITIAL TRAINING HISTORY RECORD ---
    try {
      await TrainingHistory.create({
        jobId: job_id,
        projectName: typeof projectName === 'string' ? projectName : 'AutoTrain Job',
        baseModel: model_name,
        datasetSource: (datasetSource as string) || (datasetFile ? 'local' : 'hub'),
        datasetName: datasetFile ? datasetFile.originalname : dataset,
        columnMapping: (columnMapping as string) || 'text',
        parameters: {
          batchSize: parseInt(batchSize as string) || 1,
          epochs: epochsNum,
          learningRate: parseFloat(learningRate as string) || 2e-4,
          blockSize: parseInt(blockSize as string) || 512,
          modelMaxLength: parseInt(modelMaxLength as string) || 2048,
          r: parseInt(r as string) || 8,
          lora_alpha: parseInt(lora_alpha as string) || 8,
          lora_dropout: parseFloat(lora_dropout as string) || 0,
          random_state: parseInt(random_state as string) || 3407,
          gradient_accumulation_steps: parseInt(gradient_accumulation_steps as string) || 4,
          warmup_steps: parseInt(warmup_steps as string) || 5,
          weight_decay: parseFloat(weight_decay as string) || 0.01,
          seed: parseInt(seed as string) || 3407,
          optim: (optim as string) || 'adamw_8bit',
          lr_scheduler_type: (lr_scheduler_type as string) || 'linear',
        },
        pushToHub: true, // Always true as requested
        hfRepoId: hf_repo_id || '',
        hfToken: hf_token || '',
        status: 'RUNNING',
        trainingDuration: 0,
        startedAt: new Date(),
        config_snapshot: config, // Save the PARSED config object, not req.body (to preserve numeric types)
        datasetPath: savedDatasetPath,
      });
      console.log(`[Backend] Initial TrainingHistory created for job ${job_id}`);
    } catch (dbErr) {
      console.error('[Backend] Failed to create initial TrainingHistory:', dbErr);
    }

    return res.status(gpuResponse.status).json(data);
  } catch (err: any) {
    console.error('[Backend] startTraining error:', err);
    return res.status(500).json({ error: err.message || 'Failed to start training' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/train/status/:jobId
// Proxy to GPU Service — no changes needed
// ---------------------------------------------------------------------------
export const getTrainingStatus = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Guard: never forward obviously invalid IDs
    if (!jobId || jobId === 'null' || jobId === 'undefined') {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const response = await fetch(`${GPU_SERVICE_URL}/api/train/status/${jobId}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get training status' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/train/stream/:jobId
// SSE — polls GPU Service every 1 s and pushes data to the frontend
// ---------------------------------------------------------------------------
export const streamTrainingStatus = async (req: Request, res: Response) => {
  const { jobId } = req.params;

  // Guard: stop immediately if jobId is invalid — prevents /status/null spam
  if (!jobId || jobId === 'null' || jobId === 'undefined') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid jobId' })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const intervalId = setInterval(async () => {
    try {
      const response = await fetch(`${GPU_SERVICE_URL}/api/train/status/${jobId}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      const data: any = await response.json();

      // IF latest_checkpoint exists, update the DB so we can resume later
      if (data.latest_checkpoint) {
        TrainingHistory.updateOne(
          { jobId },
          { latest_checkpoint_file_id: data.latest_checkpoint }
        ).catch(err => console.error('[Backend] Failed to update latest_checkpoint:', err));
      }

      res.write(`data: ${JSON.stringify(data)}\n\n`);

      if (['COMPLETED', 'STOPPED', 'FAILED', 'UNKNOWN', 'ERROR'].includes(data.status)) {
        // Auto-update MongoDB so History screen shows correct status
        TrainingHistory.updateOne(
          { jobId },
          {
            status: data.status,
            completedAt: new Date(),
            ...(data.latest_checkpoint ? { latest_checkpoint_file_id: data.latest_checkpoint } : {})
          }
        ).catch(err => console.error('[Backend] Failed to update final status in DB:', err));

        clearInterval(intervalId);
        res.write(`event: end\ndata: ${JSON.stringify(data)}\n\n`);
        res.end();
      }
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      clearInterval(intervalId);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(intervalId));
};

// ---------------------------------------------------------------------------
// POST /api/train/stop/:jobId
// ---------------------------------------------------------------------------
export const stopTraining = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const response = await fetch(`${GPU_SERVICE_URL}/api/train/stop/${jobId}`, { 
      method: 'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to stop training' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/system/resources
// ---------------------------------------------------------------------------
export const getSystemResources = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${GPU_SERVICE_URL}/api/system/resources`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get system resources' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/train/resume/:jobId
// ---------------------------------------------------------------------------
export const resumeTraining = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // 1. Fetch Job from MongoDB
    const history = await TrainingHistory.findOne({ jobId });
    if (!history) {
      return res.status(404).json({ error: 'Job not found in database' });
    }

    // Determine checkpoint source:
    // Priority 1: latest_checkpoint_file_id (e.g. Google Drive file ID)
    // Priority 2: hfRepoId if pushToHub was enabled (checkpoint saved to HF Hub)
    const checkpointId = history.latest_checkpoint_file_id || history.hfRepoId || null;
    const checkpointSource = history.latest_checkpoint_file_id
      ? 'drive'
      : history.hfRepoId && history.pushToHub
        ? 'hf'
        : null;

    if (!checkpointId) {
      return res.status(400).json({
        error: 'Cannot resume: No checkpoint found. Train with Push to Hub or wait for a Drive checkpoint.'
      });
    }

    console.log(`[Backend] Resuming job ${jobId} from checkpoint [${checkpointSource}]: ${checkpointId}`);

    // 2. Reconstruct JSON config from stored snapshot
    const snapshotConfig = history.config_snapshot || {};

    const resumeConfig: any = {
      ...snapshotConfig,
      job_id: jobId,
      // Checkpoint reference: Drive file ID or HF repo ID
      checkpoint_file_id: checkpointSource === 'drive' ? checkpointId : undefined,
      checkpoint_hf_repo: checkpointSource === 'hf' ? checkpointId : undefined,
      checkpoint_source: checkpointSource,
      // Drive credentials (still included even if not used, for future saves)
      drive_folder_id: GOOGLE_DRIVE_FOLDER_ID,
      service_account: parsedGoogleCredentials,
    };

    // 3. Resolve dataset
    let datasetStream: ReturnType<typeof fs.createReadStream> | undefined;
    let datasetKnownLength = 0;
    let datasetFilename = '';

    if (history.datasetPath && fs.existsSync(history.datasetPath)) {
      const stats = fs.statSync(history.datasetPath);
      datasetStream = fs.createReadStream(history.datasetPath);
      datasetKnownLength = stats.size;
      datasetFilename = history.datasetName || path.basename(history.datasetPath);
      console.log(`[Backend] Re-attaching persistent dataset for resume: ${history.datasetPath}`);
    } else if (history.datasetSource === 'hub') {
      resumeConfig.dataset_hf_id = history.datasetName || snapshotConfig.dataset;
    } else {
      console.warn(`[Backend] Local dataset file missing for resume: ${history.datasetPath}`);
    }

    // Build form AFTER config is fully populated
    const form = new FormData();
    form.append('config', JSON.stringify(resumeConfig));

    if (datasetStream) {
      form.append('file', datasetStream, {
        filename: datasetFilename,
        knownLength: datasetKnownLength,
      });
    }

    // 4. Forward to GPU Service
    console.log(`[Backend] Forwarding to GPU service: ${GPU_SERVICE_URL}/api/train/start`);

    const gpuResponse = await fetchWithForm(`${GPU_SERVICE_URL}/api/train/start`, form);

    const responseText = await gpuResponse.text();
    console.log(`[Backend] GPU response (${gpuResponse.status}): ${responseText.slice(0, 300)}`);

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: 'GPU service returned non-JSON response on resume',
        raw: responseText.slice(0, 500),
      });
    }

    if (gpuResponse.ok) {
      await TrainingHistory.updateOne({ jobId }, { status: 'RUNNING' });
    }

    return res.status(gpuResponse.status).json(data);
  } catch (err: any) {
    console.error('[Backend] resumeTraining error:', err);
    return res.status(500).json({ error: err.message || 'Failed to resume training' });
  }
};