import { Request, Response } from 'express';
import { TrainingHistory } from '../models/TrainingHistory';
import { ModelEvaluation } from '../models/Evaluation';

type EvalStats = { evalCount: number; pinnedOverallPct: number | null };

/** Gắn thêm evalCount + pinnedOverallPct (%) cho danh sách job — dùng chung GET /api/train/history */
async function enrichHistoriesWithEvalStats<T extends { jobId: string; pinnedEvalId?: string | null }>(
  histories: T[]
): Promise<Array<T & EvalStats>> {
  if (!histories.length) return histories as Array<T & EvalStats>;

  const jobIds = histories.map((h) => h.jobId);

  const countAgg = await ModelEvaluation.aggregate<{ _id: string; evalCount: number }>([
    { $match: { jobId: { $in: jobIds }, status: 'COMPLETED' } },
    { $group: { _id: '$jobId', evalCount: { $sum: 1 } } },
  ]);
  const evalCountByJob = Object.fromEntries(countAgg.map((x) => [x._id, x.evalCount]));

  const pinnedIds = [
    ...new Set(
      histories
        .map((h) => h.pinnedEvalId)
        .filter((id): id is string => !!id)
    ),
  ];

  const pinnedPctByEvalId = new Map<string, number>();
  if (pinnedIds.length) {
    const pinnedEvals = await ModelEvaluation.find({
      modelEvalId: { $in: pinnedIds },
      status: 'COMPLETED',
    })
      .select('modelEvalId summary')
      .lean();

    for (const e of pinnedEvals) {
      const max = e.summary?.max_possible ?? 5;
      const ft = e.summary?.overall?.ft_avg ?? 0;
      if (max > 0) pinnedPctByEvalId.set(e.modelEvalId, (ft / max) * 100);
    }
  }

  return histories.map((h) => {
    const jobId = h.jobId;
    const evalCount = evalCountByJob[jobId] ?? 0;
    const pinId = h.pinnedEvalId;
    const pinnedOverallPct =
      pinId && pinnedPctByEvalId.has(pinId) ? pinnedPctByEvalId.get(pinId)! : null;

    return { ...h, evalCount, pinnedOverallPct };
  });
}

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
      existing.hfRepoId = hfRepoId || '';
      existing.status = status;

      // Only update finalMetrics if the incoming ones are not empty/zero,
      // or if the existing ones are empty. This prevents overwriting with 0s.
      const hasIncomingMetrics = finalMetrics && (finalMetrics.loss > 0 || finalMetrics.accuracy > 0);
      if (hasIncomingMetrics || !existing.finalMetrics || (existing.finalMetrics.loss === 0 && existing.finalMetrics.accuracy === 0)) {
        existing.finalMetrics = {
          loss: finalMetrics?.loss || 0,
          accuracy: finalMetrics?.accuracy || 0,
          vram: finalMetrics?.vram || 0,
          gpu_util: finalMetrics?.gpu_util || 0,
        };
      }

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

    const enriched = await enrichHistoriesWithEvalStats(histories);
    return res.status(200).json(enriched);
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