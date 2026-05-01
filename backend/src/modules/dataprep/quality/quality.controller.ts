import { Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/auth';
import { QualityService } from './quality.service';

const qualityService = new QualityService();

export class QualityController {
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
