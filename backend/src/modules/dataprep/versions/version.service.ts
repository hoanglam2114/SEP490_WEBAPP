import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { DataPrepProject } from '../../../models/DataPrepProject';
import { Label } from '../../../models/Label';
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

    const labels = await Label.find({
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
          upvotes: Array.isArray(label.upvotes) ? label.upvotes : [],
          downvotes: Array.isArray(label.downvotes) ? label.downvotes : [],
        };
      })
      .filter(Boolean);

    if (!docs.length) {
      return;
    }

    await Label.insertMany(docs as any[], { ordered: false });
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
}

export const versionService = new VersionService();
