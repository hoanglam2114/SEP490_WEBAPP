import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { EvaluationSample, EvaluationService, RefinementSample } from '../services/evaluationService';
import { EvaluationHistory } from '../models/EvaluationHistory';
import { DataPrepProject } from '../models/DataPrepProject';
import { DatasetVersion } from '../models/DatasetVersion';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { User } from '../models/User';
import { Label } from '../models/Label';
import { DatasetSampleAssignment } from '../models/DatasetSampleAssignment';
import { GeminiProvider } from '../services/providers/GeminiProvider';
import { OpenAIProvider } from '../services/providers/OpenAIProvider';
import { DeepseekProvider } from '../services/providers/DeepseekProvider';
import { getAuthUserId } from '../utils/auth';
import { getHardRejectedSampleIds } from '../utils/labelFilters';
import { EvalFormat, inferFormatFromRow, resolveSampleKey, normalizeEvaluationData } from '../utils/evalUtils';

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

function getSharedUserIds(version: any): string[] {
  return Array.isArray(version?.sharedWithUserIds)
    ? version.sharedWithUserIds.map((id: any) => String(id)).filter(Boolean)
    : [];
}

function isVersionSharedWithUser(version: any, userId: string): boolean {
  return getSharedUserIds(version).includes(String(userId));
}

async function buildSharedUserDtos(version: any): Promise<Array<{ id: string; name: string; email: string }>> {
  const sharedUserIds = getSharedUserIds(version);
  if (!sharedUserIds.length) {
    return [];
  }

  const users = await User.find({ _id: { $in: sharedUserIds } })
    .select('_id name email')
    .lean();

  const byId = new Map(users.map((user: any) => [String(user._id), user]));
  return sharedUserIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((user: any) => ({
      id: String(user._id),
      name: String(user.name || ''),
      email: String(user.email || ''),
    }));
}

async function getAssignedSampleIdsForUser(
  datasetVersionId: mongoose.Types.ObjectId,
  userId: string
): Promise<{ hasAssignments: boolean; sampleIds: Set<string> }> {
  const [assignmentCount, assignments] = await Promise.all([
    DatasetSampleAssignment.countDocuments({ datasetVersionId }),
    DatasetSampleAssignment.find({
      datasetVersionId,
      assigneeId: new mongoose.Types.ObjectId(userId),
    })
      .select('sampleId')
      .lean(),
  ]);

  return {
    hasAssignments: assignmentCount > 0,
    sampleIds: new Set(assignments.map((item: any) => String(item.sampleId))),
  };
}

function filterItemsByAssignedSampleIds<T extends { _id: unknown }>(items: T[], sampleIds: Set<string>): T[] {
  return items.filter((item) => sampleIds.has(String(item._id)));
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

    return new EvaluationService(new GeminiProvider());
  }

  async evaluate(req: Request, res: Response): Promise<void> {
    try {
      const { data, format, provider } = req.body as {
        data: EvaluationSample[];
        format?: string;
        provider?: 'gemini' | 'openai' | 'deepseek';
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
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { projectName, similarityThreshold, format, data, promptId, promptContentSnapshot } = req.body as {
        projectId?: string;
        parentVersionId?: string;
        operationType?: 'upload' | 'clean' | 'cluster' | 'refine_approved' | 'manual_edit' | 'legacy';
        operationParams?: Record<string, unknown>;
        sourceType?: 'chat' | 'lesson';
        projectName?: string;
        similarityThreshold?: number;
        format?: string;
        promptId?: string;
        promptContentSnapshot?: string;
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
      const requestedProjectId =
        typeof req.body?.projectId === 'string' && mongoose.Types.ObjectId.isValid(req.body.projectId)
          ? new mongoose.Types.ObjectId(req.body.projectId)
          : undefined;
      const requestedParentVersionId =
        typeof req.body?.parentVersionId === 'string' && mongoose.Types.ObjectId.isValid(req.body.parentVersionId)
          ? new mongoose.Types.ObjectId(req.body.parentVersionId)
          : undefined;
      const requestedOperationType = (req.body?.operationType || 'legacy') as
        | 'upload'
        | 'clean'
        | 'cluster'
        | 'refine_approved'
        | 'manual_edit'
        | 'legacy';
      const normalizedSourceType = req.body?.sourceType === 'lesson' ? 'lesson' : 'chat';

      const existingProject = requestedProjectId
        ? await DataPrepProject.findOne({ _id: requestedProjectId, ownerId }).lean()
        : await DataPrepProject.findOne({ ownerId, name: normalizedProjectName, isArchived: { $ne: true } })
            .sort({ createdAt: -1 })
            .lean();

      const project = existingProject
        ? existingProject
        : await DataPrepProject.create({
            ownerId,
            name: normalizedProjectName,
            sourceType: normalizedSourceType,
          });

      const versionCount = project?._id
        ? await DatasetVersion.countDocuments({ projectId: project._id })
        : await DatasetVersion.countDocuments({ ownerId, projectName: normalizedProjectName });
      const nextVersionNo = versionCount + 1;
      const versionName = `Version ${nextVersionNo}`;

      const normalizedPromptId =
        typeof promptId === 'string' && mongoose.Types.ObjectId.isValid(promptId)
          ? new mongoose.Types.ObjectId(promptId)
          : undefined;
      const normalizedPromptSnapshot = String(promptContentSnapshot || '').trim();

      const datasetVersion = await DatasetVersion.create({
        projectId: project._id,
        ownerId,
        projectName: normalizedProjectName,
        parentVersionId: requestedParentVersionId,
        createdFromVersionId: requestedParentVersionId,
        versionNo: nextVersionNo,
        versionName,
        operationType: requestedOperationType,
        operationParams: req.body?.operationParams,
        similarityThreshold: threshold,
        totalSamples: data.length,
        promptId: normalizedPromptId,
        promptContentSnapshot: normalizedPromptSnapshot || undefined,
      });

      await DataPrepProject.updateOne(
        { _id: project._id },
        {
          $set: {
            latestVersionId: datasetVersion._id,
          },
          $setOnInsert: {
            rootVersionId: datasetVersion._id,
          },
        }
      );

      if (!project.rootVersionId) {
        await DataPrepProject.updateOne(
          { _id: project._id, rootVersionId: { $exists: false } },
          { $set: { rootVersionId: datasetVersion._id } }
        );
      }

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
        project: {
          _id: String(project._id),
          name: project.name,
          sourceType: project.sourceType,
        },
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
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await ensureEvaluationHistoryIndexes();

      const { items } = req.body as {
        items: Array<{
          sampleId: string;
          evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
          results: EvaluationScorePayload;
        }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Thiếu dữ liệu lưu evaluation hoặc mảng items rỗng.' });
        return;
      }

      const candidateItems = items
        .filter((item) => {
          return (
            item &&
            mongoose.Types.ObjectId.isValid(item.sampleId) &&
            ['manual', 'gemini', 'openai', 'deepseek', 'none'].includes(item.evaluatedBy) &&
            item.results
          );
        });

      const sampleIds = candidateItems.map((item) => new mongoose.Types.ObjectId(item.sampleId));
      const ownedSamples = sampleIds.length
        ? await ProcessedDatasetItem.aggregate([
          { $match: { _id: { $in: sampleIds } } },
          {
            $lookup: {
              from: 'datasetversions',
              localField: 'datasetVersionId',
              foreignField: '_id',
              as: 'datasetVersion',
            },
          },
          { $unwind: '$datasetVersion' },
          { $match: { 'datasetVersion.ownerId': new mongoose.Types.ObjectId(ownerId) } },
          { $project: { _id: 1 } },
        ])
        : [];

      const ownedSampleSet = new Set(ownedSamples.map((sample: any) => String(sample._id)));

      const documents = candidateItems
        .filter((item) => ownedSampleSet.has(String(item.sampleId)))
        .map((item) => {
          const objectId = new mongoose.Types.ObjectId(item.sampleId);
          return {
            ownerId,
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
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const projectSearch = String(req.query.projectSearch || '').trim().toLowerCase();

      const projectMatch: Record<string, any> = { ownerId: new mongoose.Types.ObjectId(ownerId) };
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
        ? await DatasetVersion.find({ ownerId, projectName: { $in: projectNames } })
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

      // ── Hard-REJECT community filter ─────────────────────────────────────
      // showRejected=true  → show ONLY samples with hard REJECT >= 3 upvotes
      // showRejected=false → exclude those samples (default)
      const showRejected = String(req.query.showRejected || '').toLowerCase() === 'true';
      let filteredVersionItems: typeof versionItems = versionItems;

      if (versionItems.length > 0) {
        const scopedIds = (versionItems as any[]).map((item) => new mongoose.Types.ObjectId(String(item._id)));
        const rejectedIds = await getHardRejectedSampleIds(scopedIds);

        if (rejectedIds.size > 0) {
          filteredVersionItems = (versionItems as any[]).filter((item) => {
            const isRejected = rejectedIds.has(String(item._id));
            return showRejected ? isRejected : !isRejected;
          });
        } else if (showRejected) {
          // showRejected=true but no rejected samples exist → return empty
          filteredVersionItems = [];
        }
      }

      const itemsByVersion = new Map<string, any[]>();
      for (const item of filteredVersionItems as any[]) {
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
            const scopedEvaluations = Array.isArray(item.evaluations)
              ? item.evaluations.filter((entry: any) => String(entry.ownerId) === ownerId)
              : [];
            const avg = buildAverageResults(scopedEvaluations);
            return buildEvaluationSummary(avg);
          })
          .filter((value) => Number.isFinite(value)) as number[];

        const evaluatedCount = versionItemRows.filter((item) => {
          const scopedEvaluations = Array.isArray(item.evaluations)
            ? item.evaluations.filter((entry: any) => String(entry.ownerId) === ownerId)
            : [];
          return scopedEvaluations.length > 0;
        }).length;
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

  async getPublicProjectsHub(req: Request, res: Response): Promise<void> {
    try {
      const viewerId = getAuthUserId(req);
      if (!viewerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const viewerObjectId = new mongoose.Types.ObjectId(viewerId);
      const assignedVersionRows = await DatasetSampleAssignment.find({ assigneeId: viewerObjectId })
        .select('datasetVersionId')
        .lean();
      const assignedVersionIds = Array.from(
        new Set(assignedVersionRows.map((row: any) => String(row.datasetVersionId)).filter(Boolean))
      ).map((id) => new mongoose.Types.ObjectId(id));
      const assignedVersionIdSet = new Set(assignedVersionIds.map(String));

      const versionRows = await DatasetVersion.find({
        $or: [
          { isPublic: true },
          { sharedWithUserIds: viewerObjectId },
          ...(assignedVersionIds.length ? [{ _id: { $in: assignedVersionIds } }] : []),
        ],
      })
        .sort({ createdAt: -1 })
        .lean();

      const ownerIds = Array.from(
        new Set(versionRows.map((row: any) => String(row.ownerId)).filter(Boolean))
      );

      const owners = ownerIds.length
        ? await User.find({ _id: { $in: ownerIds } }).select('_id name').lean()
        : [];
      const ownerNameMap = new Map<string, string>(
        owners.map((owner: any) => [String(owner._id), String(owner.name || 'Unknown')])
      );

      const projects = await Promise.all(
        versionRows.map(async (row: any) => {
          const ownerId = String(row.ownerId);
          const projectName = String(row.projectName || 'Untitled Project');
          const datasetVersionId = String(row._id);

          const topLabelRows = await Label.aggregate([
            {
              $lookup: {
                from: 'processeddatasetitems',
                localField: 'sampleId',
                foreignField: '_id',
                as: 'sample',
              },
            },
            { $unwind: '$sample' },
            {
              $lookup: {
                from: 'datasetversions',
                localField: 'sample.datasetVersionId',
                foreignField: '_id',
                as: 'version',
              },
            },
            { $unwind: '$version' },
            {
              $match: {
                'version._id': new mongoose.Types.ObjectId(datasetVersionId),
                $or: [
                  { targetScope: 'sample' },
                  { targetScope: { $exists: false } },
                  { targetScope: null },
                ],
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                type: 1,
                upvoteCount: { $size: '$upvotes' },
                createdAt: 1,
              },
            },
            { $sort: { upvoteCount: -1, createdAt: -1 } },
            { $limit: 1 },
          ]);

          const topLabel = topLabelRows[0]
            ? {
                _id: String(topLabelRows[0]._id),
                name: String(topLabelRows[0].name || ''),
                type: topLabelRows[0].type === 'hard' ? 'hard' : 'soft',
                upvoteCount: Number(topLabelRows[0].upvoteCount || 0),
              }
            : null;

          return {
            id: datasetVersionId,
            projectName,
            versionName: String(row.versionName || 'Version'),
            ownerId,
            ownerName: ownerNameMap.get(ownerId) || 'Unknown',
            updatedAt: row.createdAt,
            accessType: Boolean(row.isPublic)
              ? 'public'
              : assignedVersionIdSet.has(datasetVersionId)
                ? 'assigned'
                : 'shared',
            topLabel,
          };
        })
      );

      res.json({ projects });
    } catch (error: any) {
      console.error('Get public projects hub error:', error);
      res.status(500).json({
        error: 'Lấy danh sách public projects thất bại',
        details: error.message,
      });
    }
  }

  async getPublicProjectLabeling(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'project id không hợp lệ.' });
        return;
      }

      const datasetVersion = await DatasetVersion.findById(id).lean();
      if (!datasetVersion) {
        res.status(404).json({ error: 'Không tìm thấy project.' });
        return;
      }

      const viewerId = getAuthUserId(req);
      if (!viewerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const isOwner = String(datasetVersion.ownerId) === String(viewerId);
      const hasSharedAccess = isVersionSharedWithUser(datasetVersion, viewerId);
      const assignedAccess = await getAssignedSampleIdsForUser(datasetVersion._id, viewerId);
      const hasAssignedAccess = assignedAccess.sampleIds.size > 0;
      if (!datasetVersion.isPublic && !hasSharedAccess && !hasAssignedAccess && !isOwner) {
        res.status(403).json({ error: 'Bạn chưa được cấp quyền truy cập project này.' });
        return;
      }

      const showRejected = String(req.query.showRejected || '').toLowerCase() === 'true';

      const items = await ProcessedDatasetItem.find({ datasetVersionId: datasetVersion._id })
        .sort({ createdAt: 1 })
        .lean();

      let filteredItems: typeof items = !isOwner && assignedAccess.hasAssignments
        ? filterItemsByAssignedSampleIds(items as any[], assignedAccess.sampleIds)
        : items;
      let rejectedSamples = 0;

      if (filteredItems.length > 0) {
        const scopedIds = (filteredItems as any[]).map((item) => new mongoose.Types.ObjectId(String(item._id)));
        const rejectedIds = await getHardRejectedSampleIds(scopedIds);
        rejectedSamples = rejectedIds.size;

        if (rejectedIds.size > 0) {
          filteredItems = (filteredItems as any[]).filter((item) => {
            const isRejected = rejectedIds.has(String(item._id));
            return showRejected ? isRejected : !isRejected;
          });
        } else if (showRejected) {
          filteredItems = [];
        }
      }

      const owner = await User.findById(datasetVersion.ownerId).select('_id name').lean();

      const inferredFormat: EvalFormat = Array.isArray(filteredItems[0]?.data?.messages) ? 'openai' : 'alpaca';
      const serializedData = inferredFormat === 'openai'
        ? filteredItems.map((item: any) => ({
            conversation_id: item.sampleId,
            messages: Array.isArray(item.data?.messages) ? item.data.messages : [],
          }))
        : filteredItems.map((item: any) => ({
            id: item.sampleId,
            ...(item.data || {}),
          }));

      const sampleIdMap = filteredItems.reduce<Record<string, string>>((acc, item: any) => {
        acc[String(item.sampleId)] = String(item._id);
        return acc;
      }, {});

      res.json({
        project: {
          id: String(datasetVersion._id),
          projectName: datasetVersion.projectName,
          ownerId: String(datasetVersion.ownerId),
          ownerName: String(owner?.name || 'Unknown'),
          updatedAt: datasetVersion.createdAt,
        },
        loadProject: {
          projectName: datasetVersion.projectName,
          format: inferredFormat,
          data: serializedData,
          evaluationMap: {},
          datasetVersionId: String(datasetVersion._id),
          sampleIdMap,
          ownerId: String(datasetVersion.ownerId),
          startStep: 7,
          totalSamples: items.length,
          visibleSamples: filteredItems.length,
          rejectedSamples,
          showRejected,
        },
      });
    } catch (error: any) {
      console.error('Get public project labeling error:', error);
      res.status(500).json({
        error: 'Lấy dữ liệu labeling thất bại',
        details: error.message,
      });
    }
  }

  async getDatasetVersionDetail(req: Request, res: Response): Promise<void> {
    try {
      const viewerId = getAuthUserId(req);
      if (!viewerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

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

      const isOwner = String((version as any).ownerId) === String(viewerId);
      const isPublicVersion = Boolean((version as any).isPublic);
      const hasSharedAccess = isVersionSharedWithUser(version, viewerId);
      const assignedAccess = await getAssignedSampleIdsForUser(version._id, viewerId);
      const hasAssignedAccess = assignedAccess.sampleIds.size > 0;

      if (!isOwner && !isPublicVersion && !hasSharedAccess && !hasAssignedAccess) {
        res.status(403).json({ error: 'Forbidden: you do not have access to this dataset version.' });
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

      // ── Hard-REJECT community filter ─────────────────────────────────────
      // showRejected=true  → show ONLY samples with hard REJECT >= 3 upvotes
      // showRejected=false → exclude those samples (default)
      const showRejected = String(req.query.showRejected || '').toLowerCase() === 'true';
      let filteredItems: typeof itemsWithEvaluations = !isOwner && assignedAccess.hasAssignments
        ? filterItemsByAssignedSampleIds(itemsWithEvaluations as any[], assignedAccess.sampleIds)
        : itemsWithEvaluations;

      if (filteredItems.length > 0) {
        const scopedIds = (filteredItems as any[]).map(
          (item) => new mongoose.Types.ObjectId(String(item._id))
        );
        const rejectedIds = await getHardRejectedSampleIds(scopedIds);

        if (rejectedIds.size > 0) {
          filteredItems = (filteredItems as any[]).filter((item) => {
            const isRejected = rejectedIds.has(String(item._id));
            return showRejected ? isRejected : !isRejected;
          });
        } else if (showRejected) {
          filteredItems = [];
        }
      }

      const detailItems = (filteredItems as any[]).map((item) => {
        const history = Array.isArray(item.evaluations)
          ? item.evaluations.filter((entry: any) => String(entry.ownerId) === viewerId)
          : [];
        history.sort((a: any, b: any) => getEvaluationTimestamp(a) - getEvaluationTimestamp(b));
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
          projectId: version.projectId ? String(version.projectId) : null,
          parentVersionId: version.parentVersionId ? String(version.parentVersionId) : null,
          versionNo: version.versionNo ?? null,
          projectName: version.projectName,
          versionName: version.versionName,
          isPublic: Boolean((version as any).isPublic),
          sharedWithUsers: await buildSharedUserDtos(version),
          operationType: version.operationType || 'legacy',
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

  async updateDatasetVersionVisibility(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { isPublic } = req.body as { isPublic?: boolean };

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      if (typeof isPublic !== 'boolean') {
        res.status(400).json({ error: 'isPublic phải là boolean.' });
        return;
      }

      const updated = await DatasetVersion.findOneAndUpdate(
        { _id: id, ownerId },
        { $set: { isPublic } },
        { new: true }
      ).lean();

      if (!updated) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      res.json({
        message: isPublic ? 'Dataset version đã được public.' : 'Dataset version đã được chuyển về private.',
        datasetVersion: {
          _id: String(updated._id),
          isPublic: Boolean((updated as any).isPublic),
          projectName: updated.projectName,
          versionName: updated.versionName,
        },
      });
    } catch (error: any) {
      console.error('Update dataset version visibility error:', error);
      res.status(500).json({
        error: 'Cập nhật visibility thất bại',
        details: error.message,
      });
    }
  }

  async updateDatasetVersionSharing(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const rawUserId = req.body?.userId;
      const userId = rawUserId ? String(rawUserId) : '';

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json({ error: 'userId không hợp lệ.' });
        return;
      }

      if (userId && userId === String(ownerId)) {
        res.status(400).json({ error: 'Owner đã có quyền trên dataset version này.' });
        return;
      }

      if (userId) {
        const targetUser = await User.findById(userId).select('_id').lean();
        if (!targetUser) {
          res.status(404).json({ error: 'Không tìm thấy tài khoản được chọn.' });
          return;
        }
      }

      const sharedWithUserIds = userId ? [new mongoose.Types.ObjectId(userId)] : [];
      const updated = await DatasetVersion.findOneAndUpdate(
        { _id: id, ownerId },
        { $set: { sharedWithUserIds } },
        { new: true }
      ).lean();

      if (!updated) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      res.json({
        message: userId ? 'Đã cấp quyền cho tài khoản được chọn.' : 'Đã xóa quyền chia sẻ riêng.',
        datasetVersion: {
          _id: String(updated._id),
          isPublic: Boolean((updated as any).isPublic),
          projectName: updated.projectName,
          versionName: updated.versionName,
          sharedWithUsers: await buildSharedUserDtos(updated),
        },
      });
    } catch (error: any) {
      console.error('Update dataset version sharing error:', error);
      res.status(500).json({
        error: 'Cập nhật quyền chia sẻ thất bại',
        details: error.message,
      });
    }
  }

  async getDatasetVersionAssignments(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      const version = await DatasetVersion.findOne({ _id: id, ownerId }).lean();
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      const samples = await ProcessedDatasetItem.find({ datasetVersionId: version._id })
        .sort({ createdAt: 1 })
        .lean();
      const assignments = await DatasetSampleAssignment.find({ datasetVersionId: version._id })
        .sort({ sampleIndex: 1 })
        .lean();

      const assigneeIds = Array.from(new Set(assignments.map((item: any) => String(item.assigneeId)).filter(Boolean)));
      const users = assigneeIds.length
        ? await User.find({ _id: { $in: assigneeIds } }).select('_id name email').lean()
        : [];
      const userMap = new Map(users.map((user: any) => [String(user._id), user]));
      const assignmentBySampleId = new Map(assignments.map((item: any) => [String(item.sampleId), item]));
      const summaryMap = new Map<string, { user: { id: string; name: string; email: string }; count: number; ranges: string[]; indices: number[] }>();

      assignments.forEach((assignment: any) => {
        const userId = String(assignment.assigneeId);
        const user = userMap.get(userId);
        if (!user) {
          return;
        }
        if (!summaryMap.has(userId)) {
          summaryMap.set(userId, {
            user: { id: userId, name: String(user.name || ''), email: String(user.email || '') },
            count: 0,
            ranges: [],
            indices: [],
          });
        }
        const summary = summaryMap.get(userId)!;
        summary.count += 1;
        summary.indices.push(Number(assignment.sampleIndex));
      });

      const summary = Array.from(summaryMap.values()).map((item) => {
        const sorted = item.indices.sort((a, b) => a - b);
        const ranges: string[] = [];
        let start = sorted[0];
        let prev = sorted[0];
        for (let i = 1; i <= sorted.length; i += 1) {
          const current = sorted[i];
          if (current === prev + 1) {
            prev = current;
            continue;
          }
          if (Number.isFinite(start)) {
            ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
          }
          start = current;
          prev = current;
        }
        return {
          user: item.user,
          count: item.count,
          ranges,
        };
      });

      const sampleRows = samples.map((sample: any, index) => {
        const assignment = assignmentBySampleId.get(String(sample._id));
        const user = assignment ? userMap.get(String(assignment.assigneeId)) : null;
        const rawPreview = Array.isArray(sample.data?.messages)
          ? sample.data.messages.map((msg: any) => String(msg?.content || '')).join(' ')
          : [sample.data?.instruction, sample.data?.input, sample.data?.output].map((part) => String(part || '')).join(' ');
        return {
          sampleId: String(sample._id),
          sampleKey: String(sample.sampleId),
          sampleIndex: index + 1,
          preview: rawPreview.trim().slice(0, 180),
          assignee: user
            ? { id: String(user._id), name: String(user.name || ''), email: String(user.email || '') }
            : null,
        };
      });

      res.json({
        datasetVersion: {
          _id: String(version._id),
          projectName: version.projectName,
          versionName: version.versionName,
          totalSamples: samples.length,
        },
        samples: sampleRows,
        summary,
        totals: {
          totalSamples: samples.length,
          assigned: assignments.length,
          unassigned: Math.max(0, samples.length - assignments.length),
        },
      });
    } catch (error: any) {
      console.error('Get dataset version assignments error:', error);
      res.status(500).json({
        error: 'Lấy danh sách phân quyền thất bại',
        details: error.message,
      });
    }
  }

  async assignDatasetVersionRange(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const assigneeId = String(req.body?.assigneeId || '');
      const startIndex = Number(req.body?.startIndex);
      const count = Number(req.body?.count);

      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(assigneeId)) {
        res.status(400).json({ error: 'Dataset version id hoặc assigneeId không hợp lệ.' });
        return;
      }
      if (!Number.isInteger(startIndex) || startIndex < 1 || !Number.isInteger(count) || count < 1) {
        res.status(400).json({ error: 'startIndex và count phải là số nguyên dương.' });
        return;
      }
      if (assigneeId === String(ownerId)) {
        res.status(400).json({ error: 'Owner không cần được gán mẫu.' });
        return;
      }

      const [version, assignee] = await Promise.all([
        DatasetVersion.findOne({ _id: id, ownerId }).lean(),
        User.findById(assigneeId).select('_id').lean(),
      ]);
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }
      if (!assignee) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản được gán.' });
        return;
      }

      const endIndex = startIndex + count - 1;
      const samples = await ProcessedDatasetItem.find({ datasetVersionId: version._id })
        .sort({ createdAt: 1 })
        .lean();
      if (startIndex > samples.length || endIndex > samples.length) {
        res.status(400).json({ error: `Range vượt quá tổng số mẫu (${samples.length}).` });
        return;
      }

      const selectedSamples = samples.slice(startIndex - 1, endIndex);
      const selectedSampleIds = selectedSamples.map((sample: any) => sample._id);
      const conflicts = await DatasetSampleAssignment.find({
        sampleId: { $in: selectedSampleIds },
        assigneeId: { $ne: new mongoose.Types.ObjectId(assigneeId) },
      }).lean();

      if (conflicts.length > 0) {
        const users = await User.find({ _id: { $in: conflicts.map((item: any) => item.assigneeId) } })
          .select('_id name email')
          .lean();
        const userMap = new Map(users.map((user: any) => [String(user._id), user]));
        res.status(409).json({
          error: 'Range này đã có mẫu được gán cho user khác.',
          conflicts: conflicts.map((item: any) => {
            const user = userMap.get(String(item.assigneeId));
            return {
              sampleIndex: Number(item.sampleIndex),
              sampleId: String(item.sampleId),
              assignee: user
                ? { id: String(user._id), name: String(user.name || ''), email: String(user.email || '') }
                : null,
            };
          }),
        });
        return;
      }

      await DatasetSampleAssignment.deleteMany({
        datasetVersionId: version._id,
        sampleId: { $in: selectedSampleIds },
        assigneeId: new mongoose.Types.ObjectId(assigneeId),
      });

      await DatasetSampleAssignment.insertMany(
        selectedSamples.map((sample: any, offset) => ({
          datasetVersionId: version._id,
          sampleId: sample._id,
          assigneeId: new mongoose.Types.ObjectId(assigneeId),
          assignedBy: new mongoose.Types.ObjectId(ownerId),
          sampleIndex: startIndex + offset,
        })),
        { ordered: false }
      );

      await DatasetVersion.updateOne(
        { _id: version._id, ownerId },
        { $addToSet: { sharedWithUserIds: new mongoose.Types.ObjectId(assigneeId) } }
      );

      res.status(201).json({
        message: `Đã gán ${selectedSamples.length} mẫu.`,
        assignedCount: selectedSamples.length,
      });
    } catch (error: any) {
      console.error('Assign dataset version range error:', error);
      res.status(500).json({
        error: 'Gán range mẫu thất bại',
        details: error.message,
      });
    }
  }

  async clearDatasetVersionAssignmentRange(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const startIndex = Number(req.body?.startIndex);
      const count = Number(req.body?.count);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }
      if (!Number.isInteger(startIndex) || startIndex < 1 || !Number.isInteger(count) || count < 1) {
        res.status(400).json({ error: 'startIndex và count phải là số nguyên dương.' });
        return;
      }

      const version = await DatasetVersion.findOne({ _id: id, ownerId }).lean();
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      const result = await DatasetSampleAssignment.deleteMany({
        datasetVersionId: version._id,
        sampleIndex: { $gte: startIndex, $lte: startIndex + count - 1 },
      });

      res.json({
        message: `Đã xóa ${result.deletedCount || 0} assignment.`,
        deletedCount: result.deletedCount || 0,
      });
    } catch (error: any) {
      console.error('Clear dataset version assignment range error:', error);
      res.status(500).json({
        error: 'Xóa assignment theo range thất bại',
        details: error.message,
      });
    }
  }

  async clearDatasetVersionUserAssignments(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id, userId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json({ error: 'Dataset version id hoặc userId không hợp lệ.' });
        return;
      }

      const version = await DatasetVersion.findOne({ _id: id, ownerId }).lean();
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      const result = await DatasetSampleAssignment.deleteMany({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(userId),
      });

      res.json({
        message: `Đã xóa ${result.deletedCount || 0} assignment của user.`,
        deletedCount: result.deletedCount || 0,
      });
    } catch (error: any) {
      console.error('Clear dataset version user assignments error:', error);
      res.status(500).json({
        error: 'Xóa assignment của user thất bại',
        details: error.message,
      });
    }
  }

  async deleteDatasetVersionSample(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

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

      const version = await DatasetVersion.findOne({ _id: item.datasetVersionId, ownerId }).select('_id').lean();
      if (!version) {
        res.status(404).json({ error: 'Không tìm thấy mẫu cần xóa.' });
        return;
      }

      await Promise.all([
        ProcessedDatasetItem.deleteOne({ _id: item._id }),
        EvaluationHistory.deleteMany({ sampleId: item._id, ownerId }),
        DatasetSampleAssignment.deleteMany({ sampleId: item._id }),
      ]);

      await DatasetVersion.updateOne(
        { _id: item.datasetVersionId, ownerId, totalSamples: { $gt: 0 } },
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
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

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

      const updated = await EvaluationHistory.findOneAndUpdate(
        { _id: id, ownerId },
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
