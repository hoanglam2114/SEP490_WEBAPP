import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { EvaluationSample, EvaluationService, RefinementSample } from '../services/evaluationService';
import { EvaluationHistory } from '../models/EvaluationHistory';
import { DatasetVersion } from '../models/DatasetVersion';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { GeminiProvider } from '../services/providers/GeminiProvider';
import { OpenAIProvider } from '../services/providers/OpenAIProvider';
import { DeepseekProvider } from '../services/providers/DeepseekProvider';
import { OpenRouterProvider } from '../services/providers/OpenRouterProvider';

type EvalFormat = 'openai' | 'alpaca';

type EvaluationScorePayload = {
  accuracy?: number | null;
  clarity?: number | null;
  completeness?: number | null;
  socratic?: number | null;
  encouragement?: number | null;
  factuality?: number | null;
  overall: number | null;
  reason: string;
};

function normalizeNullableScore(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeStoredResults(format: EvalFormat, results: EvaluationScorePayload) {
  if (format === 'openai') {
    return {
      socratic: normalizeNullableScore(results.socratic),
      encouragement: normalizeNullableScore(results.encouragement),
      factuality: normalizeNullableScore(results.factuality),
      overall: normalizeNullableScore(results.overall),
      reason: String(results.reason || ''),
    };
  }

  return {
    accuracy: normalizeNullableScore(results.accuracy),
    clarity: normalizeNullableScore(results.clarity),
    completeness: normalizeNullableScore(results.completeness),
    overall: normalizeNullableScore(results.overall),
    reason: String(results.reason || ''),
  };
}

function normalizeProjectName(input?: string): string {
  const value = String(input || '').trim();
  if (!value) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `Project_${dd}${mm}_${hh}${min}`;
  }
  return value;
}

function inferFormatFromRow(row: Record<string, any>): EvalFormat {
  if (Array.isArray(row?.messages)) {
    return 'openai';
  }
  return 'alpaca';
}

function resolveSampleKey(row: Record<string, any>, index: number): string {
  const keyCandidates = [row?.sourceKey, row?.sampleId, row?.blockId, row?.id, row?.conversation_id, row?.uuid];
  for (const candidate of keyCandidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return String(candidate).trim();
    }
  }
  return `sample-${index + 1}`;
}

function normalizeEvaluationData(format: EvalFormat, rawData: Record<string, any>): Record<string, any> | null {
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  if (format === 'openai') {
    const rawMessages = Array.isArray(rawData.messages) ? rawData.messages : [];

    let messages = rawMessages
      .map((message) => ({
        role: String(message?.role || '').trim(),
        content: String(message?.content || '').trim(),
      }))
      .filter((message) => !!message.role && !!message.content);

    if (!messages.length) {
      const legacyUser = String(rawData.userText ?? rawData.instruction ?? '').trim();
      const legacyAssistant = String(rawData.assistantText ?? rawData.output ?? '').trim();
      messages = [
        legacyUser ? { role: 'user', content: legacyUser } : null,
        legacyAssistant ? { role: 'assistant', content: legacyAssistant } : null,
      ].filter(Boolean) as Array<{ role: string; content: string }>;
    }

    if (!messages.length) {
      return null;
    }

    return { messages };
  }

  const instruction = String(rawData.instruction ?? rawData.userText ?? '').trim();
  const input = String(rawData.input ?? '').trim();
  const output = String(rawData.output ?? rawData.assistantText ?? '').trim();

  if (!instruction || !output) {
    return null;
  }

  return { instruction, input, output };
}

function buildEvaluationSummary(results: any) {
  const overall = Number(results?.overall);
  return Number.isFinite(overall) ? overall : null;
}

function getEvaluationTimestamp(entry: any): number {
  const ts = new Date(entry?.updatedAt || entry?.createdAt || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function getLatestEvaluationEntry(entries: any[]): any | null {
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }
  return [...entries].sort((a, b) => getEvaluationTimestamp(a) - getEvaluationTimestamp(b))[entries.length - 1] || null;
}

function buildAverageResults(entries: any[]): EvaluationScorePayload {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      overall: null,
      reason: '',
    };
  }

  const totalCount = entries.length;
  const sum = {
    accuracy: 0,
    clarity: 0,
    completeness: 0,
    socratic: 0,
    encouragement: 0,
    factuality: 0,
    overall: 0,
  };

  entries.forEach((entry) => {
    sum.accuracy += Number(entry?.results?.accuracy) || 0;
    sum.clarity += Number(entry?.results?.clarity) || 0;
    sum.completeness += Number(entry?.results?.completeness) || 0;
    sum.socratic += Number(entry?.results?.socratic) || 0;
    sum.encouragement += Number(entry?.results?.encouragement) || 0;
    sum.factuality += Number(entry?.results?.factuality) || 0;
    sum.overall += Number(entry?.results?.overall) || 0;
  });

  return {
    accuracy: sum.accuracy / totalCount,
    clarity: sum.clarity / totalCount,
    completeness: sum.completeness / totalCount,
    socratic: sum.socratic / totalCount,
    encouragement: sum.encouragement / totalCount,
    factuality: sum.factuality / totalCount,
    overall: sum.overall / totalCount,
    reason: String(getLatestEvaluationEntry(entries)?.results?.reason || ''),
  };
}

let evaluationIndexesEnsured = false;

async function ensureEvaluationHistoryIndexes(): Promise<void> {
  if (evaluationIndexesEnsured) {
    return;
  }

  try {
    await EvaluationHistory.collection.dropIndex('sampleId_1_evaluatedBy_1');
  } catch {
    // Ignore if legacy compound index does not exist.
  }

  try {
    await EvaluationHistory.collection.dropIndex('sampleId_1');
  } catch {
    // Ignore if legacy index does not exist.
  }

  await EvaluationHistory.syncIndexes();
  evaluationIndexesEnsured = true;
}

export class EvaluationController {
  private getService(provider?: string): EvaluationService {
    const normalizedProvider = String(provider || '').toLowerCase();
    if (normalizedProvider === 'openai') {
      return new EvaluationService(new OpenAIProvider());
    }
    if (normalizedProvider === 'deepseek') {
      return new EvaluationService(new DeepseekProvider());
    }
    if (normalizedProvider === 'openrouter') {
      return new EvaluationService(new OpenRouterProvider());
    }
    return new EvaluationService(new GeminiProvider());
  }

  async evaluate(req: Request, res: Response): Promise<void> {
    try {
      const { data, format, provider } = req.body as {
        data: EvaluationSample[];
        format?: string;
        provider?: 'gemini' | 'openai' | 'deepseek' | 'openrouter';
      };

      if (!data || !Array.isArray(data) || data.length === 0) {
        res.status(400).json({ error: 'Cần cung cấp mảng data không rỗng.' });
        return;
      }

      const service = this.getService(provider);
      const result = await service.evaluateBatch(data, format);

      res.json(result);
    } catch (error: any) {
      console.error('Evaluation error:', error);
      res.status(500).json({
        error: 'Đánh giá thất bại',
        details: error.message,
      });
    }
  }

  async refine(req: Request, res: Response): Promise<void> {
    try {
      const { data, provider } = req.body as {
        data: RefinementSample[];
        provider?: 'gemini' | 'openai' | 'deepseek';
      };

      if (!Array.isArray(data) || data.length === 0) {
        res.status(400).json({ error: 'Cần cung cấp mảng data để refine.' });
        return;
      }

      const service = this.getService(provider);
      const samples = data.map((item) => ({
        assistant: String(item?.assistant || ''),
        reason: String(item?.reason || ''),
      }));

      const refined = await service.refineBatch(samples);
      res.json({ items: refined, refined: refined.length });
    } catch (error: any) {
      console.error('Refine error:', error);
      res.status(500).json({
        error: 'Tinh chỉnh dữ liệu thất bại',
        details: error.message,
      });
    }
  }

  async createDatasetVersion(req: Request, res: Response): Promise<void> {
    try {
      const { projectName, similarityThreshold, format, data } = req.body as {
        projectName?: string;
        similarityThreshold?: number;
        format?: string;
        data: Array<{ sourceKey?: string; data?: Record<string, any> } | Record<string, any>>;
      };

      if (!Array.isArray(data) || data.length === 0) {
        res.status(400).json({ error: 'Cần cung cấp dữ liệu đã chuyển đổi để tạo dataset version.' });
        return;
      }

      const normalizedProjectName = normalizeProjectName(projectName);
      const normalizedFormat = format === 'openai' || format === 'alpaca'
        ? format
        : inferFormatFromRow(data[0] || {});
      const threshold = Number.isFinite(Number(similarityThreshold))
        ? Math.min(1, Math.max(0, Number(similarityThreshold)))
        : 0.9;

      const versionCount = await DatasetVersion.countDocuments({ projectName: normalizedProjectName });
      const versionName = `Version ${versionCount + 1}`;

      const datasetVersion = await DatasetVersion.create({
        projectName: normalizedProjectName,
        versionName,
        similarityThreshold: threshold,
        totalSamples: data.length,
      });

      const operations = data
        .map((row, index) => {
          const rawData = (row && typeof row === 'object' && 'data' in row && row.data) ? row.data : row;
          const sampleKey = String((row as any)?.sourceKey || resolveSampleKey(rawData as Record<string, any>, index));
          const normalizedData = normalizeEvaluationData(normalizedFormat, rawData as Record<string, any>);
          if (!normalizedData) {
            return null;
          }

          return {
            updateOne: {
              filter: {
                datasetVersionId: datasetVersion._id,
                sampleId: sampleKey,
              },
              update: {
                $set: {
                  datasetVersionId: datasetVersion._id,
                  sampleId: sampleKey,
                  data: normalizedData,
                },
                $setOnInsert: {
                  createdAt: new Date(),
                },
              },
              upsert: true,
            },
          };
        })
        .filter(Boolean);

      if (operations.length === 0) {
        res.status(400).json({ error: 'Không có mẫu hợp lệ để tạo dataset version.' });
        return;
      }

      await ProcessedDatasetItem.bulkWrite(operations as any[], { ordered: false });

      const createdItems = await ProcessedDatasetItem.find({ datasetVersionId: datasetVersion._id })
        .sort({ createdAt: 1 })
        .lean();

      const sampleIdMap = createdItems.reduce<Record<string, string>>((acc, item: any) => {
        acc[String(item.sampleId)] = String(item._id);
        return acc;
      }, {});

      res.status(201).json({
        message: 'Đã tạo dataset version thành công.',
        datasetVersion,
        sampleIdMap,
      });
    } catch (error: any) {
      console.error('Create dataset version error:', error);
      res.status(500).json({
        error: 'Tạo dataset version thất bại',
        details: error.message,
      });
    }
  }

  async saveEvaluation(req: Request, res: Response): Promise<void> {
    try {
      await ensureEvaluationHistoryIndexes();

      const { items } = req.body as {
        items: Array<{
          sampleId: string;
          evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'openrouter' | 'none';
          results: EvaluationScorePayload;
        }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Thiếu dữ liệu lưu evaluation hoặc mảng items rỗng.' });
        return;
      }

      const documents = items
        .filter((item) => {
          return (
            item &&
            mongoose.Types.ObjectId.isValid(item.sampleId) &&
            ['manual', 'gemini', 'openai', 'deepseek', 'openrouter', 'none'].includes(item.evaluatedBy) &&
            item.results
          );
        })
        .map((item) => {
          const objectId = new mongoose.Types.ObjectId(item.sampleId);
          return {
            sampleId: objectId,
            evaluatedBy: item.evaluatedBy,
            results: {
              ...normalizeStoredResults('alpaca', item.results),
              ...normalizeStoredResults('openai', item.results),
            },
          };
        });

      if (documents.length === 0) {
        res.status(400).json({ error: 'Không có evaluation item hợp lệ để lưu.' });
        return;
      }

      const created = await EvaluationHistory.insertMany(documents as any[], { ordered: false });

      res.json({
        message: 'Đã lưu kết quả evaluation thành các bản ghi độc lập trong MongoDB.',
        insertedCount: created.length,
      });
    } catch (error: any) {
      console.error('Save evaluation error:', error);
      res.status(500).json({
        error: 'Lưu kết quả đánh giá thất bại',
        details: error.message,
      });
    }
  }

  async getEvaluationHistory(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const projectSearch = String(req.query.projectSearch || '').trim().toLowerCase();

      const projectMatch: Record<string, any> = {};
      if (projectSearch) {
        projectMatch.projectName = { $regex: projectSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      }

      const [projectGroups, totalProjects] = await Promise.all([
        DatasetVersion.aggregate([
          { $match: projectMatch },
          {
            $group: {
              _id: '$projectName',
              projectName: { $first: '$projectName' },
              versionCount: { $sum: 1 },
              totalSamples: { $sum: '$totalSamples' },
              latestCreatedAt: { $max: '$createdAt' },
            },
          },
          { $sort: { latestCreatedAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ]),
        DatasetVersion.aggregate([
          { $match: projectMatch },
          { $group: { _id: '$projectName' } },
          { $count: 'total' },
        ]),
      ]);

      const projectNames = projectGroups.map((group) => String(group.projectName || 'Untitled Project'));
      const versions = projectNames.length
        ? await DatasetVersion.find({ projectName: { $in: projectNames } })
          .sort({ createdAt: -1 })
          .lean()
        : [];

      const versionIds = versions.map((version: any) => version._id);
      const versionItems = versionIds.length
        ? await ProcessedDatasetItem.aggregate([
          { $match: { datasetVersionId: { $in: versionIds } } },
          {
            $lookup: {
              from: 'evaluationhistories',
              localField: '_id',
              foreignField: 'sampleId',
              as: 'evaluations',
            },
          },
        ])
        : [];

      const itemsByVersion = new Map<string, any[]>();
      for (const item of versionItems as any[]) {
        const key = String(item.datasetVersionId);
        if (!itemsByVersion.has(key)) {
          itemsByVersion.set(key, []);
        }
        itemsByVersion.get(key)!.push(item);
      }

      const versionsByProject = new Map<string, any[]>();
      for (const version of versions as any[]) {
        const versionItemRows = itemsByVersion.get(String(version._id)) || [];
        const perSampleAvgOveralls = versionItemRows
          .map((item) => {
            const avg = buildAverageResults(Array.isArray(item.evaluations) ? item.evaluations : []);
            return buildEvaluationSummary(avg);
          })
          .filter((value) => Number.isFinite(value)) as number[];

        const evaluatedCount = versionItemRows.filter((item) => Array.isArray(item.evaluations) && item.evaluations.length > 0).length;
        const avgOverall = perSampleAvgOveralls.length
          ? perSampleAvgOveralls.reduce((sum, value) => sum + value, 0) / perSampleAvgOveralls.length
          : null;

        const summary = {
          _id: String(version._id),
          versionName: version.versionName,
          similarityThreshold: version.similarityThreshold,
          totalSamples: version.totalSamples,
          createdAt: version.createdAt,
          evaluatedCount,
          avgOverall,
        };

        const projectKey = String(version.projectName || 'Untitled Project');
        if (!versionsByProject.has(projectKey)) {
          versionsByProject.set(projectKey, []);
        }
        versionsByProject.get(projectKey)!.push(summary);
      }

      const projects = projectGroups.map((group) => ({
        projectName: String(group.projectName || 'Untitled Project'),
        versionCount: Number(group.versionCount || 0),
        totalSamples: Number(group.totalSamples || 0),
        latestCreatedAt: group.latestCreatedAt,
        versions: versionsByProject.get(String(group.projectName || 'Untitled Project')) || [],
      }));

      const total = Number(totalProjects?.[0]?.total || 0);

      res.json({
        projects,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error: any) {
      console.error('Get evaluation history error:', error);
      res.status(500).json({
        error: 'Lấy lịch sử đánh giá thất bại',
        details: error.message,
      });
    }
  }

  async getDatasetVersionDetail(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      const version = await DatasetVersion.findById(id).lean();
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      const itemsWithEvaluations = await ProcessedDatasetItem.aggregate([
        { $match: { datasetVersionId: version._id } },
        { $sort: { createdAt: 1 } },
        {
          $lookup: {
            from: 'evaluationhistories',
            localField: '_id',
            foreignField: 'sampleId',
            as: 'evaluations',
          },
        },
      ]);

      const detailItems = (itemsWithEvaluations as any[]).map((item) => {
        const history = Array.isArray(item.evaluations) ? [...item.evaluations] : [];
        history.sort((a, b) => getEvaluationTimestamp(a) - getEvaluationTimestamp(b));
        const latest = getLatestEvaluationEntry(history);
        const average = buildAverageResults(history);
        return {
          _id: String(item._id),
          sampleId: String(item._id),
          sampleKey: item.sampleId,
          data: item.data,
          evaluatedBy: latest?.evaluatedBy || 'none',
          results: history.length ? average : { overall: null, reason: '' },
          evaluations: history.map((entry: any) => ({
            evaluatedBy: entry.evaluatedBy,
            scores: entry.results || { overall: null, reason: '' },
            reason: String(entry?.results?.reason || ''),
            timestamp: entry.updatedAt || entry.createdAt,
          })),
          createdAt: item.createdAt,
          updatedAt: latest?.updatedAt || item.updatedAt || item.createdAt,
        };
      });

      res.json({
        datasetVersion: {
          _id: String(version._id),
          projectName: version.projectName,
          versionName: version.versionName,
          similarityThreshold: version.similarityThreshold,
          totalSamples: version.totalSamples,
          createdAt: version.createdAt,
        },
        items: detailItems,
      });
    } catch (error: any) {
      console.error('Get dataset version detail error:', error);
      res.status(500).json({
        error: 'Lấy chi tiết dataset version thất bại',
        details: error.message,
      });
    }
  }

  async deleteDatasetVersionSample(req: Request, res: Response): Promise<void> {
    try {
      const { sampleId } = req.params;
      if (!sampleId || !mongoose.Types.ObjectId.isValid(sampleId)) {
        res.status(400).json({ error: 'sampleId không hợp lệ.' });
        return;
      }

      const item = await ProcessedDatasetItem.findById(sampleId).lean();
      if (!item) {
        res.status(404).json({ error: 'Không tìm thấy mẫu cần xóa.' });
        return;
      }

      await Promise.all([
        ProcessedDatasetItem.deleteOne({ _id: item._id }),
        EvaluationHistory.deleteMany({ sampleId: item._id }),
      ]);

      await DatasetVersion.updateOne(
        { _id: item.datasetVersionId, totalSamples: { $gt: 0 } },
        { $inc: { totalSamples: -1 } }
      );

      res.json({
        message: 'Đã xóa vĩnh viễn mẫu dữ liệu.',
        deletedSampleId: String(item._id),
      });
    } catch (error: any) {
      console.error('Delete dataset sample error:', error);
      res.status(500).json({
        error: 'Xóa mẫu dữ liệu thất bại',
        details: error.message,
      });
    }
  }

  async updateEvaluationHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { results, evaluatedBy } = req.body as {
        results: EvaluationScorePayload;
        evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
      };

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Thiếu id bản ghi cần cập nhật.' });
        return;
      }

      if (!results || !Number.isFinite(Number(results.overall))) {
        res.status(400).json({ error: 'Thiếu hoặc sai dữ liệu results.' });
        return;
      }

      if (!['manual', 'gemini', 'openai', 'deepseek', 'none'].includes(evaluatedBy)) {
        res.status(400).json({ error: 'evaluatedBy chỉ nhận manual, gemini, openai, deepseek hoặc none.' });
        return;
      }

      const updated = await EvaluationHistory.findByIdAndUpdate(
        id,
        {
          $set: {
            evaluatedBy,
            results: normalizeStoredResults('alpaca', results),
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (!updated) {
        res.status(404).json({ error: 'Không tìm thấy bản ghi evaluation history.' });
        return;
      }

      res.json({
        message: 'Cập nhật bản ghi evaluation thành công.',
        item: updated,
      });
    } catch (error: any) {
      console.error('Update evaluation history error:', error);
      res.status(500).json({
        error: 'Cập nhật lịch sử đánh giá thất bại',
        details: error.message,
      });
    }
  }
}