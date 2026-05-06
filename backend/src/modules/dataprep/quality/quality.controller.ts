import { Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/auth';
import { QualityService } from './quality.service';

const qualityService = new QualityService();

export class QualityController {
  async getLabelingStatus(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const result = await qualityService.getLabelingStatus(versionId, ownerId);
      res.json(result);
    } catch (error: any) {
      console.error('Get labeling status error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to get labeling status',
      });
    }
  }

  async updateIncompleteBucket(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const rawBucket = req.body?.bucket;
      const bucket = rawBucket === null || rawBucket === undefined || rawBucket === ''
        ? null
        : String(rawBucket);

      if (bucket !== null && !['Gold', 'Rewrite', 'Reject'].includes(bucket)) {
        res.status(400).json({ error: "bucket must be one of 'Gold', 'Rewrite', 'Reject' or null" });
        return;
      }

      const result = await qualityService.updateIncompleteBucket(versionId, ownerId, bucket as any);
      res.json({
        message: bucket
          ? `Incomplete samples will be treated as ${bucket}.`
          : 'Incomplete sample bucket override cleared.',
        ...result,
      });
    } catch (error: any) {
      console.error('Update incomplete bucket error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to update incomplete bucket',
      });
    }
  }

  async classify(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const result = await qualityService.classify(versionId, ownerId, undefined, { tagRejects: true });
      res.json(result);
    } catch (error: any) {
      console.error('Quality classification error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Quality classification failed',
      });
    }
  }

  async getQualitySamples(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const group = req.query.group ? String(req.query.group) : undefined;
      const result = await qualityService.classify(versionId, ownerId, group);
      res.json(result);
    } catch (error: any) {
      console.error('Get quality samples error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to get quality samples',
      });
    }
  }
}
