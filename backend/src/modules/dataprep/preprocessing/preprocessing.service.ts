import mongoose from 'mongoose';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { DatasetVersion } from '../../../models/DatasetVersion';

export class DataPrepPreprocessingService {
  async getVersionById(versionId: string) {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw new Error('Invalid dataset version id');
    }
    return DatasetVersion.findById(versionId).lean();
  }

  async getAuthorizedVersion(versionId: string, ownerId: string, allowPublicRead = false) {
    const version = await this.getVersionById(versionId);
    if (!version) {
      return null;
    }

    const isOwner = String(version.ownerId) === String(ownerId);
    const isPublicRead = allowPublicRead && Boolean((version as any).isPublic);
    if (!isOwner && !isPublicRead) {
      const error = new Error('Forbidden: you do not have access to this dataset version.');
      (error as any).statusCode = 403;
      throw error;
    }

    return version;
  }

  async loadSerializedVersionData(versionId: string): Promise<any[]> {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw new Error('Invalid dataset version id');
    }

    const items = await ProcessedDatasetItem.find({
      datasetVersionId: new mongoose.Types.ObjectId(versionId),
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!items.length) {
      return [];
    }

    const isOpenAI = Array.isArray(items[0]?.data?.messages);

    if (isOpenAI) {
      return items.map((item: any) => ({
        conversation_id: item.sampleId,
        messages: Array.isArray(item.data?.messages) ? item.data.messages : [],
      }));
    }

    return items.map((item: any) => ({
      id: item.sampleId,
      ...(item.data || {}),
    }));
  }
}
