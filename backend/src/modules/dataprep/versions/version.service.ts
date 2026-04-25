import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { DataPrepProject } from '../../../models/DataPrepProject';
import { normalizeEvaluationData, inferFormatFromRow } from '../../../utils/evalUtils';

export class VersionService {
  async createVersion(params: {
    ownerId: string;
    projectId?: string;
    projectName: string;
    parentVersionId?: string;
    createdFromVersionId?: string;
    operationType: 'upload' | 'clean' | 'cluster' | 'refine_approved' | 'manual_edit' | 'legacy';
    operationParams?: Record<string, unknown>;
    similarityThreshold: number;
    format?: 'openai' | 'alpaca';
    data: any[];
    promptId?: string;
    promptContentSnapshot?: string;
    sourceType?: 'chat' | 'lesson';
  }) {
    const {
      ownerId,
      projectId,
      projectName,
      parentVersionId,
      createdFromVersionId,
      operationType,
      operationParams,
      similarityThreshold,
      format,
      data,
      promptId,
      promptContentSnapshot,
      sourceType = 'chat',
    } = params;

    const normalizedFormat = format || inferFormatFromRow(data[0] || {});

    // 1. Find or create project
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

    // 2. Determine version number
    const versionCount = await DatasetVersion.countDocuments({ projectId: project._id });
    const nextVersionNo = versionCount + 1;
    const versionName = `Version ${nextVersionNo}`;

    // 3. Create version record
    const datasetVersion = await DatasetVersion.create({
      projectId: project._id,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      projectName,
      parentVersionId: parentVersionId ? new mongoose.Types.ObjectId(parentVersionId) : undefined,
      createdFromVersionId: createdFromVersionId ? new mongoose.Types.ObjectId(createdFromVersionId) : (parentVersionId ? new mongoose.Types.ObjectId(parentVersionId) : undefined),
      versionNo: nextVersionNo,
      versionName,
      operationType,
      operationParams,
      similarityThreshold,
      totalSamples: data.length,
      promptId: promptId ? new mongoose.Types.ObjectId(promptId) : undefined,
      promptContentSnapshot,
    });

    // 4. Update project latest version
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

    // 5. Bulk insert items
    const operations = data
      .map((row, index) => {
        const rawData = (row && typeof row === 'object' && 'data' in row && row.data) ? row.data : row;
        const sampleKey = String((row as any)?.sourceKey || (row as any)?.id || (row as any)?.conversation_id || index);
        const normalizedData = normalizeEvaluationData(normalizedFormat as any, rawData as Record<string, any>);
        if (!normalizedData) return null;

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

    if (operations.length > 0) {
      await ProcessedDatasetItem.bulkWrite(operations as any[], { ordered: false });
    }

    // 6. Build sampleIdMap
    const createdItems = await ProcessedDatasetItem.find({ datasetVersionId: datasetVersion._id })
      .select('_id sampleId')
      .lean();

    const sampleIdMap = createdItems.reduce<Record<string, string>>((acc, item: any) => {
      acc[String(item.sampleId)] = String(item._id);
      return acc;
    }, {});

    return {
      project,
      datasetVersion,
      sampleIdMap,
    };
  }
}

export const versionService = new VersionService();
