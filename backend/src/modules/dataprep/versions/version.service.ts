import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { DataPrepProject } from '../../../models/DataPrepProject';
import { LabelAssignment } from '../../../models/LabelAssignment';
import { DatasetAssignmentActivity } from '../../../models/DatasetAssignmentActivity';
import { DatasetAssignmentAdjudication } from '../../../models/DatasetAssignmentAdjudication';
import { EvaluationHistory } from '../../../models/EvaluationHistory';
import { ensureLabelAssignmentsForSamples } from '../../../services/labelAssignmentService';
import { DatasetSampleAssignment } from '../../../models/DatasetSampleAssignment';
import { DatasetAssignmentSubmission } from '../../../models/DatasetAssignmentSubmission';
import { normalizeEvaluationData, inferFormatFromRow, resolveSampleKey } from '../../../utils/evalUtils';

export type DatasetOperationType =
  | 'upload'
  | 'clean'
  | 'cluster'
  | 'labeling_base'
  | 'classification_balanced'
  | 'evaluation_filtered'
  | 'refine_approved'
  | 'manual_edit'
  | 'legacy';

type VersionDataRow = { sourceKey?: string; data?: Record<string, any> } | Record<string, any>;

type CreateVersionParams = {
  ownerId: string;
  projectId?: string;
  projectName: string;
  parentVersionId?: string;
  createdFromVersionId?: string;
  operationType: DatasetOperationType;
  operationParams?: Record<string, unknown>;
  prepareResumeStep?: number;
  similarityThreshold: number;
  format?: 'openai' | 'alpaca';
  data: VersionDataRow[];
  promptId?: string;
  promptContentSnapshot?: string;
  sourceType?: 'chat' | 'lesson';
};

type CloneVersionParams = {
  ownerId: string;
  baseVersionId: string;
  operationType: DatasetOperationType;
  operationParams?: Record<string, unknown>;
  prepareResumeStep?: number;
  format?: 'openai' | 'alpaca';
  data: VersionDataRow[];
  promptId?: string;
  promptContentSnapshot?: string;
};

type CreatedVersionResult = {
  project: any;
  datasetVersion: any;
  sampleIdMap: Record<string, string>;
  sourceToCreatedSampleMap: Record<string, string>;
};

type DeleteVersionTreeResult = {
  deletedVersionIds: string[];
  deletedSampleIds: string[];
  deletedCounts: {
    versions: number;
    samples: number;
    assignments: number;
    submissions: number;
    labels: number;
    activities: number;
    adjudications: number;
    evaluations: number;
  };
  projectArchived: boolean;
  latestVersionId: string | null;
  rootVersionId: string | null;
};

function normalizeProjectName(value?: string): string {
  return String(value || '').trim() || 'Untitled Dataset';
}

function clampPrepareResumeStep(value?: number): number {
  return Number.isInteger(Number(value))
    ? Math.min(14, Math.max(1, Number(value)))
    : 5;
}

function toObjectId(value?: string) {
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : undefined;
}

export class VersionService {
  private async resolveProject(ownerId: string, projectId: string | undefined, projectName: string, sourceType: 'chat' | 'lesson') {
    let project;
    if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
      project = await DataPrepProject.findOne({ _id: projectId, ownerId }).lean();
    } else {
      project = await DataPrepProject.findOne({ ownerId, name: projectName, isArchived: { $ne: true } })
        .sort({ createdAt: -1 })
        .lean();
    }

    if (!project) {
      project = await DataPrepProject.create({
        ownerId: new mongoose.Types.ObjectId(ownerId),
        name: projectName,
        sourceType,
      });
    }

    return project;
  }

  private async buildVersionBase(params: CreateVersionParams) {
    const normalizedProjectName = normalizeProjectName(params.projectName);
    const sourceType = params.sourceType === 'lesson' ? 'lesson' : 'chat';
    const project = await this.resolveProject(params.ownerId, params.projectId, normalizedProjectName, sourceType);
    const versionCount = await DatasetVersion.countDocuments({ projectId: project._id });
    const nextVersionNo = versionCount + 1;
    const versionName = `Version ${nextVersionNo}`;

    const datasetVersion = await DatasetVersion.create({
      projectId: project._id,
      ownerId: new mongoose.Types.ObjectId(params.ownerId),
      projectName: normalizedProjectName,
      parentVersionId: toObjectId(params.parentVersionId),
      createdFromVersionId: toObjectId(params.createdFromVersionId || params.parentVersionId),
      versionNo: nextVersionNo,
      versionName,
      operationType: params.operationType,
      operationParams: params.operationParams,
      prepareResumeStep: clampPrepareResumeStep(params.prepareResumeStep),
      similarityThreshold: params.similarityThreshold,
      totalSamples: params.data.length,
      promptId: toObjectId(params.promptId),
      promptContentSnapshot: params.promptContentSnapshot,
    });

    await DataPrepProject.updateOne(
      { _id: project._id },
      {
        $set: { latestVersionId: datasetVersion._id },
        $setOnInsert: { rootVersionId: datasetVersion._id },
      }
    );

    if (!(project as any).rootVersionId) {
      await DataPrepProject.updateOne(
        { _id: project._id, rootVersionId: { $exists: false } },
        { $set: { rootVersionId: datasetVersion._id } }
      );
    }

    return { project, datasetVersion, normalizedProjectName };
  }

  private buildRows(data: VersionDataRow[], format?: 'openai' | 'alpaca') {
    const normalizedFormat = format || inferFormatFromRow((data[0] as any)?.data || data[0] || {});
    const rows = data
      .map((row, index) => {
        const rawData = (row && typeof row === 'object' && 'data' in row && row.data) ? row.data : row;
        const sampleKey = String((row as any)?.sourceKey || resolveSampleKey(rawData as Record<string, any>, index));
        const normalizedData = normalizeEvaluationData(normalizedFormat as any, rawData as Record<string, any>);
        if (!normalizedData) {
          return null;
        }
        return { sampleKey, normalizedData };
      })
      .filter((row): row is { sampleKey: string; normalizedData: Record<string, any> } => Boolean(row));

    return { normalizedFormat, rows };
  }

  private async copyLabelsFromSources(sourceToCreatedSampleMap: Record<string, string>) {
    const sourceIds = Object.keys(sourceToCreatedSampleMap).filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!sourceIds.length) {
      return;
    }

    await ensureLabelAssignmentsForSamples(sourceIds);

    const labels = await LabelAssignment.find({
      sampleId: { $in: sourceIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();

    if (!labels.length) {
      return;
    }

    const docs = labels
      .map((label: any) => {
        const nextSampleId = sourceToCreatedSampleMap[String(label.sampleId)];
        if (!nextSampleId || !mongoose.Types.ObjectId.isValid(nextSampleId)) {
          return null;
        }

        return {
          sampleId: new mongoose.Types.ObjectId(nextSampleId),
          name: label.name,
          type: label.type,
          targetScope: label.targetScope || 'sample',
          ...(Number.isInteger(Number(label.messageIndex)) ? { messageIndex: Number(label.messageIndex) } : {}),
          ...(label.messageRole ? { messageRole: label.messageRole } : {}),
          ...(label.targetTextSnapshot ? { targetTextSnapshot: label.targetTextSnapshot } : {}),
          createdBy: label.createdBy,
        };
      })
      .filter(Boolean);

    if (!docs.length) {
      return;
    }

    await LabelAssignment.insertMany(docs as any[], { ordered: false });
  }

  async createVersion(params: CreateVersionParams): Promise<CreatedVersionResult> {
    const { project, datasetVersion } = await this.buildVersionBase(params);
    const { rows } = this.buildRows(params.data, params.format);

    if (!rows.length) {
      throw new Error('No valid samples to create dataset version.');
    }

    let sourceItemMap = new Map<string, any>();
    if (params.parentVersionId && mongoose.Types.ObjectId.isValid(params.parentVersionId)) {
      const parentItems = await ProcessedDatasetItem.find({
        datasetVersionId: new mongoose.Types.ObjectId(params.parentVersionId),
      })
        .select('_id sampleId rootSampleKey')
        .lean();
      sourceItemMap = new Map(parentItems.map((item: any) => [String(item.sampleId), item]));
    }

    const operations = rows.map((row) => {
      const sourceItem = sourceItemMap.get(row.sampleKey);
      return {
        updateOne: {
          filter: {
            datasetVersionId: datasetVersion._id,
            sampleId: row.sampleKey,
          },
          update: {
            $set: {
              datasetVersionId: datasetVersion._id,
              sampleId: row.sampleKey,
              sourceSampleId: sourceItem?._id,
              rootSampleKey: String(sourceItem?.rootSampleKey || row.sampleKey),
              data: row.normalizedData,
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    await ProcessedDatasetItem.bulkWrite(operations as any[], { ordered: false });

    const createdItems = await ProcessedDatasetItem.find({ datasetVersionId: datasetVersion._id })
      .select('_id sampleId sourceSampleId rootSampleKey')
      .lean();

    const sampleIdMap = createdItems.reduce<Record<string, string>>((acc, item: any) => {
      acc[String(item.sampleId)] = String(item._id);
      return acc;
    }, {});

    const sourceToCreatedSampleMap = createdItems.reduce<Record<string, string>>((acc, item: any) => {
      if (item.sourceSampleId) {
        acc[String(item.sourceSampleId)] = String(item._id);
      }
      return acc;
    }, {});

    await this.copyLabelsFromSources(sourceToCreatedSampleMap);

    return {
      project,
      datasetVersion,
      sampleIdMap,
      sourceToCreatedSampleMap,
    };
  }

  async cloneVersionFromVersion(params: CloneVersionParams): Promise<CreatedVersionResult> {
    if (!mongoose.Types.ObjectId.isValid(params.baseVersionId)) {
      throw Object.assign(new Error('Invalid base version id.'), { statusCode: 400 });
    }

    const baseVersion = await DatasetVersion.findOne({
      _id: new mongoose.Types.ObjectId(params.baseVersionId),
      ownerId: new mongoose.Types.ObjectId(params.ownerId),
    }).lean();

    if (!baseVersion) {
      throw Object.assign(new Error('Base dataset version not found.'), { statusCode: 404 });
    }

    return this.createVersion({
      ownerId: params.ownerId,
      projectId: baseVersion.projectId ? String(baseVersion.projectId) : undefined,
      projectName: baseVersion.projectName,
      parentVersionId: String(baseVersion._id),
      createdFromVersionId: String(baseVersion._id),
      operationType: params.operationType,
      operationParams: params.operationParams,
      prepareResumeStep: params.prepareResumeStep,
      similarityThreshold: baseVersion.similarityThreshold,
      format: params.format,
      data: params.data,
      promptId: params.promptId || (baseVersion.promptId ? String(baseVersion.promptId) : undefined),
      promptContentSnapshot: params.promptContentSnapshot ?? baseVersion.promptContentSnapshot,
    });
  }

  async deleteVersionTree(ownerId: string, versionId: string): Promise<DeleteVersionTreeResult> {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw Object.assign(new Error('Invalid dataset version id.'), { statusCode: 400 });
    }

    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    const targetVersion = await DatasetVersion.findOne({
      _id: new mongoose.Types.ObjectId(versionId),
      ownerId: ownerObjectId,
    }).lean();

    if (!targetVersion) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const versionScopeQuery: Record<string, any> = { ownerId: ownerObjectId };
    if (targetVersion.projectId) {
      versionScopeQuery.projectId = targetVersion.projectId;
    } else {
      versionScopeQuery.projectName = targetVersion.projectName;
    }

    const scopedVersions = await DatasetVersion.find(versionScopeQuery)
      .select('_id parentVersionId versionNo createdAt')
      .lean();

    const childrenByParentId = new Map<string, string[]>();
    scopedVersions.forEach((version: any) => {
      const parentId = version.parentVersionId ? String(version.parentVersionId) : null;
      if (!parentId) {
        return;
      }
      const current = childrenByParentId.get(parentId) || [];
      current.push(String(version._id));
      childrenByParentId.set(parentId, current);
    });

    const deletedVersionIdSet = new Set<string>();
    const queue: string[] = [String(targetVersion._id)];
    while (queue.length) {
      const currentId = queue.shift() as string;
      if (deletedVersionIdSet.has(currentId)) {
        continue;
      }
      deletedVersionIdSet.add(currentId);
      const childIds = childrenByParentId.get(currentId) || [];
      childIds.forEach((childId) => {
        if (!deletedVersionIdSet.has(childId)) {
          queue.push(childId);
        }
      });
    }

    const deletedVersionIds = Array.from(deletedVersionIdSet);
    const deletedVersionObjectIds = deletedVersionIds.map((id) => new mongoose.Types.ObjectId(id));

    const sampleRows = await ProcessedDatasetItem.find({
      datasetVersionId: { $in: deletedVersionObjectIds },
    })
      .select('_id')
      .lean();
    const deletedSampleIds = sampleRows.map((row: any) => String(row._id));
    const deletedSampleObjectIds = deletedSampleIds.map((id) => new mongoose.Types.ObjectId(id));

    const labelResult = deletedSampleObjectIds.length
      ? await LabelAssignment.deleteMany({ sampleId: { $in: deletedSampleObjectIds } })
      : { deletedCount: 0 };
    const activityResult = await DatasetAssignmentActivity.deleteMany({
      datasetVersionId: { $in: deletedVersionObjectIds },
    });
    const adjudicationResult = await DatasetAssignmentAdjudication.deleteMany({
      datasetVersionId: { $in: deletedVersionObjectIds },
    });
    const evaluationResult = deletedSampleObjectIds.length
      ? await EvaluationHistory.deleteMany({ sampleId: { $in: deletedSampleObjectIds } })
      : { deletedCount: 0 };
    const assignmentResult = await DatasetSampleAssignment.deleteMany({
      datasetVersionId: { $in: deletedVersionObjectIds },
    });
    const submissionResult = await DatasetAssignmentSubmission.deleteMany({
      datasetVersionId: { $in: deletedVersionObjectIds },
    });
    const sampleResult = await ProcessedDatasetItem.deleteMany({
      datasetVersionId: { $in: deletedVersionObjectIds },
    });
    const versionResult = await DatasetVersion.deleteMany({
      _id: { $in: deletedVersionObjectIds },
      ownerId: ownerObjectId,
    });

    let projectArchived = false;
    let latestVersionId: string | null = null;
    let rootVersionId: string | null = null;

    if (targetVersion.projectId) {
      const remainingVersions = await DatasetVersion.find({
        ownerId: ownerObjectId,
        projectId: targetVersion.projectId,
      })
        .select('_id parentVersionId versionNo createdAt')
        .lean();

      if (!remainingVersions.length) {
        projectArchived = true;
        await DataPrepProject.updateOne(
          { _id: targetVersion.projectId, ownerId: ownerObjectId },
          {
            $set: { isArchived: true },
            $unset: { latestVersionId: 1, rootVersionId: 1 },
          }
        );
      } else {
        const remainingIdSet = new Set(remainingVersions.map((version: any) => String(version._id)));
        const nextLatest = [...remainingVersions].sort((a: any, b: any) => {
          const versionNoDiff = Number(b.versionNo || 0) - Number(a.versionNo || 0);
          if (versionNoDiff !== 0) {
            return versionNoDiff;
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })[0];
        const nextRoot =
          remainingVersions.find((version: any) => {
            if (!version.parentVersionId) {
              return true;
            }
            return !remainingIdSet.has(String(version.parentVersionId));
          }) ||
          [...remainingVersions].sort(
            (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )[0];

        latestVersionId = nextLatest ? String(nextLatest._id) : null;
        rootVersionId = nextRoot ? String(nextRoot._id) : null;

        await DataPrepProject.updateOne(
          { _id: targetVersion.projectId, ownerId: ownerObjectId },
          {
            $set: {
              isArchived: false,
              ...(latestVersionId ? { latestVersionId: new mongoose.Types.ObjectId(latestVersionId) } : {}),
              ...(rootVersionId ? { rootVersionId: new mongoose.Types.ObjectId(rootVersionId) } : {}),
            },
          }
        );
      }
    }

    return {
      deletedVersionIds,
      deletedSampleIds,
      deletedCounts: {
        versions: versionResult.deletedCount || 0,
        samples: sampleResult.deletedCount || 0,
        assignments: assignmentResult.deletedCount || 0,
        submissions: submissionResult.deletedCount || 0,
        labels: labelResult.deletedCount || 0,
        activities: activityResult.deletedCount || 0,
        adjudications: adjudicationResult.deletedCount || 0,
        evaluations: evaluationResult.deletedCount || 0,
      },
      projectArchived,
      latestVersionId,
      rootVersionId,
    };
  }
}

export const versionService = new VersionService();
