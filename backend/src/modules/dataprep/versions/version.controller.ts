import { Request, Response } from 'express';
import { EvaluationController } from '../../../controllers/evaluationController';

const legacyEvaluationController = new EvaluationController();

export class DataPrepVersionController {
  async createVersion(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.createDatasetVersion(req, res);
  }

  async getVersion(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.getDatasetVersionDetail(req, res);
  }

  async updateVisibility(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.updateDatasetVersionVisibility(req, res);
  }

  async deleteSample(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.deleteDatasetVersionSample(req, res);
  }
}
