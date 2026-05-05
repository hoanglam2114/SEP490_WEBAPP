import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { EvaluationSample, EvaluationService, RefinementSample, RewriteSample } from '../services/evaluationService';
import { EvaluationHistory } from '../models/EvaluationHistory';
import { DataPrepProject } from '../models/DataPrepProject';
import { DatasetVersion } from '../models/DatasetVersion';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { User } from '../models/User';
import { Label } from '../models/Label';
import { DatasetSampleAssignment } from '../models/DatasetSampleAssignment';
import { DatasetAssignmentSubmission } from '../models/DatasetAssignmentSubmission';
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

function getLogicalMessagesForAssignment(sample: any): Array<{ messageIndex: number; role: 'user' | 'assistant'; content: string }> {
  if (Array.isArray(sample?.data?.messages)) {
    return sample.data.messages.map((message: any, index: number) => ({
      messageIndex: index,
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || ''),
    }));
  }

  return [
    {
      messageIndex: 0,
      role: 'user' as const,
      content: [sample?.data?.instruction, sample?.data?.input].map((part) => String(part || '').trim()).filter(Boolean).join('\n\n'),
    },
    {
      messageIndex: 1,
      role: 'assistant' as const,
      content: String(sample?.data?.output || ''),
    },
  ];
}

async function calculateAssignmentProgress(datasetVersionId: mongoose.Types.ObjectId, assigneeId: string) {
  const assigneeObjectId = new mongoose.Types.ObjectId(assigneeId);
  const assignments = await DatasetSampleAssignment.find({ datasetVersionId, assigneeId: assigneeObjectId })
    .sort({ sampleIndex: 1 })
    .lean();

  const sampleIds = assignments.map((assignment: any) => assignment.sampleId);
  const samples = sampleIds.length
    ? await ProcessedDatasetItem.find({ _id: { $in: sampleIds } }).lean()
    : [];
  const sampleMap = new Map(samples.map((sample: any) => [String(sample._id), sample]));

  const labels = sampleIds.length
    ? await Label.find({
        sampleId: { $in: sampleIds },
        targetScope: 'message',
        $or: [
          { createdBy: assigneeObjectId },
          { upvotes: assigneeObjectId },
          { downvotes: assigneeObjectId },
        ],
      })
        .select('sampleId messageIndex')
        .lean()
    : [];

  const completed = new Set(
    labels
      .filter((label: any) => Number.isInteger(label.messageIndex))
      .map((label: any) => `${String(label.sampleId)}:${Number(label.messageIndex)}`)
  );

  let requiredMessages = 0;
  let completedMessages = 0;
  const missing: Array<{ sampleId: string; sampleIndex: number; sampleKey: string; messageIndex: number; role: string }> = [];

  assignments.forEach((assignment: any) => {
    const sample = sampleMap.get(String(assignment.sampleId));
    if (!sample) {
      return;
    }

    getLogicalMessagesForAssignment(sample).forEach((message) => {
      requiredMessages += 1;
      const key = `${String(sample._id)}:${message.messageIndex}`;
      if (completed.has(key)) {
        completedMessages += 1;
        return;
      }

      missing.push({
        sampleId: String(sample._id),
        sampleIndex: Number(assignment.sampleIndex),
        sampleKey: String(sample.sampleId || ''),
        messageIndex: message.messageIndex,
        role: message.role,
      });
    });
  });

  return {
    assignedSamples: assignments.length,
    requiredMessages,
    completedMessages,
    missingMessages: missing,
    percent: requiredMessages > 0 ? Math.round((completedMessages / requiredMessages) * 100) : 0,
    isComplete: requiredMessages > 0 && completedMessages === requiredMessages,
  };
}

function formatSubmission(submission: any, progress: any) {
  return {
    status: submission?.status || 'draft',
    submittedAt: submission?.submittedAt || null,
    approvedAt: submission?.approvedAt || null,
    approvedBy: submission?.approvedBy ? String(submission.approvedBy) : null,
    progress,
  };
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
      const requestedPrepareResumeStep = Number(req.body?.prepareResumeStep);
      const prepareResumeStep = Number.isInteger(requestedPrepareResumeStep)
        ? Math.min(14, Math.max(1, requestedPrepareResumeStep))
        : 5;
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
        prepareResumeStep,
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
          prepareResumeStep: Number((version as any).prepareResumeStep || 5),
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

      const ownedAssignmentRows = await DatasetSampleAssignment.find({ assignedBy: viewerObjectId })
        .select('datasetVersionId')
        .lean();
      const ownedAssignedVersionIds = Array.from(
        new Set(ownedAssignmentRows.map((row: any) => String(row.datasetVersionId)).filter(Boolean))
      ).map((id) => new mongoose.Types.ObjectId(id));
      const ownedAssignedVersionIdSet = new Set(ownedAssignedVersionIds.map(String));

      const versionRows = await DatasetVersion.find({
        $or: [
          { isPublic: true },
          { sharedWithUserIds: viewerObjectId },
          ...(assignedVersionIds.length ? [{ _id: { $in: assignedVersionIds } }] : []),
          {
            ownerId: viewerObjectId,
            $or: [
              { sharedWithUserIds: { $exists: true, $ne: [] } },
              ...(ownedAssignedVersionIds.length ? [{ _id: { $in: ownedAssignedVersionIds } }] : []),
            ],
          },
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
            accessType: ownerId === String(viewerId) && (
              ownedAssignedVersionIdSet.has(datasetVersionId)
              || (Array.isArray(row.sharedWithUserIds) && row.sharedWithUserIds.length > 0)
            )
              ? 'owned'
              : Boolean(row.isPublic)
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
      const ownerUnassignedOnly = String(req.query.ownerUnassignedOnly || '').toLowerCase() === 'true';

      const items = await ProcessedDatasetItem.find({ datasetVersionId: datasetVersion._id })
        .sort({ createdAt: 1 })
        .lean();

      let filteredItems: typeof items = !isOwner && assignedAccess.hasAssignments
        ? filterItemsByAssignedSampleIds(items as any[], assignedAccess.sampleIds)
        : items;
      if (isOwner && ownerUnassignedOnly) {
        const assignedSamples = await DatasetSampleAssignment.find({ datasetVersionId: datasetVersion._id })
          .select('sampleId')
          .lean();
        const assignedSampleIds = new Set(assignedSamples.map((item: any) => String(item.sampleId)));
        filteredItems = (filteredItems as any[]).filter((item) => !assignedSampleIds.has(String(item._id)));
      }
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
          operationParams: version.operationParams || {},
          prepareResumeStep: Number((version as any).prepareResumeStep || 5),
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

  async rewrite(req: Request, res: Response): Promise<void> {
    try {
      const { data, provider } = req.body as {
        data: RewriteSample[];
        provider?: 'gemini' | 'openai' | 'deepseek';
      };

      if (!Array.isArray(data) || data.length === 0) {
        res.status(400).json({ error: 'Cần cung cấp mảng data để rewrite.' });
        return;
      }

      const service = this.getService(provider);
      const samples = data.map((item) => ({
        turns: Array.isArray(item?.turns) ? item.turns.map((turn) => ({
          userMessageIndex: Number(turn?.userMessageIndex),
          assistantMessageIndex: Number(turn?.assistantMessageIndex),
          user: String(turn?.user || ''),
          assistant: String(turn?.assistant || ''),
          userLabels: Array.isArray(turn?.userLabels) ? turn.userLabels.map((label) => String(label || '')) : [],
          assistantLabels: Array.isArray(turn?.assistantLabels) ? turn.assistantLabels.map((label) => String(label || '')) : [],
          expectedActions: Array.isArray(turn?.expectedActions) ? turn.expectedActions.map((label) => String(label || '')) : [],
          matched: Boolean(turn?.matched),
        })) : [],
      }));

      const rewritten = await service.rewriteBatch(samples);
      res.json({ items: rewritten, rewritten: rewritten.length });
    } catch (error: any) {
      console.error('Rewrite error:', error);
      res.status(500).json({
        error: 'Rewrite dữ liệu thất bại',
        details: error.message,
      });
    }
  }

  async updateDatasetVersionPrepareProgress(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const prepareResumeStep = Number(req.body?.prepareResumeStep);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      if (!Number.isInteger(prepareResumeStep) || prepareResumeStep < 1 || prepareResumeStep > 14) {
        res.status(400).json({ error: 'prepareResumeStep phải là số nguyên từ 1 đến 14.' });
        return;
      }

      const updated = await DatasetVersion.findOneAndUpdate(
        { _id: id, ownerId },
        { $set: { prepareResumeStep } },
        { returnDocument: 'after' }
      ).lean();

      if (!updated) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      if (updated.projectId) {
        await DataPrepProject.updateOne(
          { _id: updated.projectId, ownerId },
          { $set: { latestVersionId: updated._id } }
        );
      }

      res.json({
        message: 'Đã cập nhật tiến độ prepare.',
        datasetVersion: {
          _id: String(updated._id),
          projectName: updated.projectName,
          versionName: updated.versionName,
          prepareResumeStep: Number((updated as any).prepareResumeStep || prepareResumeStep),
        },
      });
    } catch (error: any) {
      console.error('Update dataset version prepare progress error:', error);
      res.status(500).json({
        error: 'Cập nhật tiến độ prepare thất bại',
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
        { returnDocument: 'after' }
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
        { returnDocument: 'after' }
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
      const submissions = assigneeIds.length
        ? await DatasetAssignmentSubmission.find({
            datasetVersionId: version._id,
            assigneeId: { $in: assigneeIds.map((userId) => new mongoose.Types.ObjectId(userId)) },
          }).lean()
        : [];
      const submissionMap = new Map(submissions.map((submission: any) => [String(submission.assigneeId), submission]));
      const progressMap = new Map<string, any>();
      await Promise.all(
        assigneeIds.map(async (userId) => {
          progressMap.set(userId, await calculateAssignmentProgress(version._id, userId));
        })
      );
      const assignmentsBySampleId = new Map<string, any[]>();
      assignments.forEach((item: any) => {
        const key = String(item.sampleId);
        if (!assignmentsBySampleId.has(key)) {
          assignmentsBySampleId.set(key, []);
        }
        assignmentsBySampleId.get(key)!.push(item);
      });
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
          submission: formatSubmission(submissionMap.get(item.user.id), progressMap.get(item.user.id)),
        };
      });

      const sampleRows = samples.map((sample: any, index) => {
        const itemAssignments = assignmentsBySampleId.get(String(sample._id)) || [];
        const assignees = itemAssignments
          .map((a) => {
            const u = userMap.get(String(a.assigneeId));
            return u ? { id: String(u._id), name: String(u.name || ''), email: String(u.email || '') } : null;
          })
          .filter(Boolean);

        const rawPreview = Array.isArray(sample.data?.messages)
          ? sample.data.messages.map((msg: any) => String(msg?.content || '')).join(' ')
          : [sample.data?.instruction, sample.data?.input, sample.data?.output].map((part) => String(part || '')).join(' ');
        return {
          sampleId: String(sample._id),
          sampleKey: String(sample.sampleId),
          sampleIndex: index + 1,
          preview: rawPreview.trim().slice(0, 180),
          assignees,
          // Legacy field for back-compat if needed, taking the first one
          assignee: assignees[0] || null,
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
          assigned: new Set(assignments.map((a: any) => String(a.sampleId))).size,
          unassigned: Math.max(0, samples.length - new Set(assignments.map((a: any) => String(a.sampleId))).size),
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

      await DatasetSampleAssignment.deleteMany({
        datasetVersionId: version._id,
        sampleId: { $in: selectedSampleIds },
        assigneeId: new mongoose.Types.ObjectId(assigneeId),
      });
      await DatasetAssignmentSubmission.deleteOne({
        datasetVersionId: version._id,
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

      const affectedAssignments = await DatasetSampleAssignment.find({
        datasetVersionId: version._id,
        sampleIndex: { $gte: startIndex, $lte: startIndex + count - 1 },
      })
        .select('assigneeId')
        .lean();

      const result = await DatasetSampleAssignment.deleteMany({
        datasetVersionId: version._id,
        sampleIndex: { $gte: startIndex, $lte: startIndex + count - 1 },
      });
      await DatasetAssignmentSubmission.deleteMany({ datasetVersionId: version._id });

      const affectedAssigneeIds = Array.from(
        new Set(affectedAssignments.map((item: any) => String(item.assigneeId)).filter(Boolean))
      );

      if (affectedAssigneeIds.length > 0) {
        const remainingAssignments = await DatasetSampleAssignment.find({
          datasetVersionId: version._id,
          assigneeId: { $in: affectedAssigneeIds.map((item) => new mongoose.Types.ObjectId(item)) },
        })
          .select('assigneeId')
          .lean();

        const assigneesWithRemainingAssignments = new Set(
          remainingAssignments.map((item: any) => String(item.assigneeId)).filter(Boolean)
        );
        const assigneesToRemoveFromShared = affectedAssigneeIds.filter((item) => !assigneesWithRemainingAssignments.has(item));

        if (assigneesToRemoveFromShared.length > 0) {
          await DatasetVersion.updateOne(
            { _id: version._id, ownerId },
            { $pull: { sharedWithUserIds: { $in: assigneesToRemoveFromShared.map((item) => new mongoose.Types.ObjectId(item)) } } }
          );
        }
      }

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
      await DatasetAssignmentSubmission.deleteOne({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(userId),
      });

      const remainingAssignmentCount = await DatasetSampleAssignment.countDocuments({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(userId),
      });

      if (remainingAssignmentCount === 0) {
        await DatasetVersion.updateOne(
          { _id: version._id, ownerId },
          { $pull: { sharedWithUserIds: new mongoose.Types.ObjectId(userId) } }
        );
      }

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

  async getMyAssignmentSubmissionStatus(req: Request, res: Response): Promise<void> {
    try {
      const assigneeId = getAuthUserId(req);
      if (!assigneeId) {
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

      const progress = await calculateAssignmentProgress(version._id, assigneeId);
      if (progress.assignedSamples === 0) {
        res.status(404).json({ error: 'Bạn chưa được phân công mẫu nào trong version này.' });
        return;
      }

      const submission = await DatasetAssignmentSubmission.findOne({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(assigneeId),
      }).lean();

      res.json(formatSubmission(submission, progress));
    } catch (error: any) {
      console.error('Get my assignment submission status error:', error);
      res.status(500).json({
        error: 'Lấy trạng thái nộp kết quả thất bại',
        details: error.message,
      });
    }
  }

  async submitMyAssignment(req: Request, res: Response): Promise<void> {
    try {
      const assigneeId = getAuthUserId(req);
      if (!assigneeId) {
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

      const progress = await calculateAssignmentProgress(version._id, assigneeId);
      if (progress.assignedSamples === 0) {
        res.status(404).json({ error: 'Bạn chưa được phân công mẫu nào trong version này.' });
        return;
      }

      if (!progress.isComplete) {
        res.status(409).json({
          error: 'Bạn cần gán nhãn đầy đủ mọi message trước khi nộp kết quả.',
          progress,
        });
        return;
      }

      const existing = await DatasetAssignmentSubmission.findOne({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(assigneeId),
      }).lean();

      if (existing?.status === 'approved') {
        res.status(409).json({ error: 'Kết quả này đã được owner approve.', submission: formatSubmission(existing, progress) });
        return;
      }

      const submittedAt = existing?.submittedAt || new Date();
      const submission = await DatasetAssignmentSubmission.findOneAndUpdate(
        {
          datasetVersionId: version._id,
          assigneeId: new mongoose.Types.ObjectId(assigneeId),
        },
        {
          $set: {
            status: 'submitted',
            submittedAt,
            progressSnapshot: progress,
          },
        },
        { returnDocument: 'after', upsert: true }
      ).lean();

      res.json({
        message: 'Đã nộp kết quả gán nhãn.',
        ...formatSubmission(submission, progress),
      });
    } catch (error: any) {
      console.error('Submit my assignment error:', error);
      res.status(500).json({
        error: 'Nộp kết quả gán nhãn thất bại',
        details: error.message,
      });
    }
  }

  async approveUserAssignmentSubmission(req: Request, res: Response): Promise<void> {
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

      const submission = await DatasetAssignmentSubmission.findOne({
        datasetVersionId: version._id,
        assigneeId: new mongoose.Types.ObjectId(userId),
      }).lean();

      if (!submission || submission.status !== 'submitted') {
        res.status(409).json({ error: 'User này chưa nộp kết quả để approve.' });
        return;
      }

      const progress = await calculateAssignmentProgress(version._id, userId);
      const updated = await DatasetAssignmentSubmission.findOneAndUpdate(
        {
          datasetVersionId: version._id,
          assigneeId: new mongoose.Types.ObjectId(userId),
        },
        {
          $set: {
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: new mongoose.Types.ObjectId(ownerId),
            progressSnapshot: progress,
          },
        },
        { returnDocument: 'after' }
      ).lean();

      res.json({
        message: 'Đã approve kết quả gán nhãn.',
        ...formatSubmission(updated, progress),
      });
    } catch (error: any) {
      console.error('Approve user assignment submission error:', error);
      res.status(500).json({
        error: 'Approve kết quả gán nhãn thất bại',
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
        { returnDocument: 'after' }
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
