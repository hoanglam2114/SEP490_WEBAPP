import { Request, Response } from 'express';
import { ClassificationService } from './classification.service';
import { getAuthUserId } from '../../../utils/auth';

const classificationService = new ClassificationService();

export class ClassificationController {
  /**
   * POST /dataprep/versions/:versionId/classification/classify
   *
   * Run classification on all samples in the dataset version.
   */
  async classify(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const result = await classificationService.classify(versionId, ownerId);

      res.json(result);
    } catch (error: any) {
      console.error('Classification error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Classification failed',
      });
    }
  }

  /**
   * GET /dataprep/versions/:versionId/classification
   *
   * Get classified samples. Accepts optional query param ?group=MATH|PHYSICAL|...
   */
  async getClassifiedSamples(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { versionId } = req.params;
      const group = req.query.group ? String(req.query.group) : undefined;
      const result = await classificationService.getClassifiedSamples(versionId, ownerId, group);

      res.json(result);
    } catch (error: any) {
      console.error('Get classified samples error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to get classified samples',
      });
    }
  }
}
