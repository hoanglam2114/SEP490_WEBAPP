import { Request, Response } from 'express';
import { TrainingHistory } from '../models/TrainingHistory';

// ---------------------------------------------------------------------------
// POST /api/train/history
// Lưu kết quả training vào MongoDB sau khi training hoàn tất
// ---------------------------------------------------------------------------
export const saveTrainingHistory = async (req: Request, res: Response) => {
  try {
    const {
      jobId,
      projectName,
      baseModel,
      datasetSource,
      datasetName,
      columnMapping,
      parameters,
      pushToHub,
      hfRepoId,
      status,
      finalMetrics,
      lastLogLine,
      trainingDuration,
      startedAt,
      completedAt,
    } = req.body;

    // Validation
    if (!jobId || !projectName || !baseModel) {
      return res.status(400).json({ error: 'Missing required fields: jobId, projectName, baseModel' });
    }

    // Kiểm tra nếu jobId đã tồn tại thì update, nếu chưa thì tạo mới
    const existing = await TrainingHistory.findOne({ jobId });
    if (existing) {
      // Update
      existing.projectName = projectName;
      existing.baseModel = baseModel;
      existing.datasetSource = datasetSource;
      existing.datasetName = datasetName;
      existing.columnMapping = columnMapping;
      existing.parameters = parameters;
      existing.pushToHub = pushToHub ?? false;
      existing.hfRepoId = hfRepoId ?? '';
      existing.status = status;
      existing.finalMetrics = finalMetrics;
      existing.lastLogLine = lastLogLine;
      existing.trainingDuration = trainingDuration;
      existing.startedAt = new Date(startedAt);
      existing.completedAt = new Date(completedAt);
      await existing.save();

      console.log(`[Backend] Updated training history for job ${jobId}`);
      return res.status(200).json({ message: 'Training history updated', data: existing });
    }

    // Tạo mới
    const history = new TrainingHistory({
      jobId,
      projectName,
      baseModel,
      datasetSource,
      datasetName,
      columnMapping,
      parameters,
      pushToHub: pushToHub ?? false,
      hfRepoId: hfRepoId ?? '',
      status,
      finalMetrics,
      lastLogLine,
      trainingDuration,
      startedAt: new Date(startedAt),
      completedAt: new Date(completedAt),
    });

    await history.save();
    console.log(`[Backend] Saved training history for job ${jobId}`);
    return res.status(201).json({ message: 'Training history saved', data: history });
  } catch (err: any) {
    console.error('[Backend] saveTrainingHistory error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save training history' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/train/history
// Lấy tất cả lịch sử training, sắp xếp mới nhất trước
// Hỗ trợ query param ?baseModel=... để lọc theo base model
// ---------------------------------------------------------------------------
export const getTrainingHistoryList = async (req: Request, res: Response) => {
  try {
    const { baseModel } = req.query;
    const filter: Record<string, any> = {};

    if (baseModel && typeof baseModel === 'string' && baseModel.trim()) {
      filter.baseModel = baseModel.trim();
    }

    const histories = await TrainingHistory.find(filter)
      .sort({ completedAt: -1 })
      .lean();

    return res.status(200).json(histories);
  } catch (err: any) {
    console.error('[Backend] getTrainingHistoryList error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get training history' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/train/history/models
// Lấy danh sách các base model đã từng train (distinct)
// ---------------------------------------------------------------------------
export const getDistinctBaseModels = async (_req: Request, res: Response) => {
  try {
    const models = await TrainingHistory.distinct('baseModel');
    return res.status(200).json(models);
  } catch (err: any) {
    console.error('[Backend] getDistinctBaseModels error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get distinct base models' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/train/history/:jobId
// Lấy chi tiết 1 job theo jobId
// ---------------------------------------------------------------------------
export const getTrainingHistoryDetail = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const history = await TrainingHistory.findOne({ jobId }).lean();

    if (!history) {
      return res.status(404).json({ error: 'Training history not found' });
    }

    return res.status(200).json(history);
  } catch (err: any) {
    console.error('[Backend] getTrainingHistoryDetail error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get training history detail' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/train/history/:jobId
// Xoá 1 record training history
// ---------------------------------------------------------------------------
export const deleteTrainingHistory = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const result = await TrainingHistory.findOneAndDelete({ jobId });

    if (!result) {
      return res.status(404).json({ error: 'Training history not found' });
    }

    console.log(`[Backend] Deleted training history for job ${jobId}`);
    return res.status(200).json({ message: 'Training history deleted' });
  } catch (err: any) {
    console.error('[Backend] deleteTrainingHistory error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete training history' });
  }
};