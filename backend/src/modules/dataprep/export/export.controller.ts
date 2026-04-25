import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { getHardRejectedSampleIds } from '../../../utils/labelFilters';
import { getAuthUserId } from '../../../utils/auth';

export class ExportController {
  async downloadDataset(req: Request, res: Response): Promise<void> {
    try {
      const { versionId } = req.params;
      const showRejected = req.query.showRejected === 'true';

      if (!mongoose.Types.ObjectId.isValid(versionId)) {
        res.status(400).json({ error: 'Invalid version ID' });
        return;
      }

      const version = await DatasetVersion.findById(versionId).lean();
      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }

      const viewerId = getAuthUserId(req);
      const isOwner = viewerId && String(version.ownerId) === String(viewerId);
      const isPublicVersion = Boolean((version as any).isPublic);
      if (!isOwner && !isPublicVersion) {
        res.status(403).json({ error: 'Forbidden: you do not have access to this dataset version.' });
        return;
      }

      const items = await ProcessedDatasetItem.find({ datasetVersionId: version._id }).lean();
      let filteredItems = items;

      if (items.length > 0) {
        const scopedIds = items.map((item) => new mongoose.Types.ObjectId(String(item._id)));
        const rejectedIds = await getHardRejectedSampleIds(scopedIds);

        filteredItems = items.filter((item) => {
          const isRejected = rejectedIds.has(String(item._id));
          return showRejected ? isRejected : !isRejected;
        });
      }

      const exportData = filteredItems.map((item: any) => ({
        id: item.sampleId,
        ...(item.data || {}),
      }));

      res.json(exportData);
    } catch (error: any) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Failed to export dataset' });
    }
  }
}

export const exportController = new ExportController();
