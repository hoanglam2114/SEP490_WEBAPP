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

  async updateSharing(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.updateDatasetVersionSharing(req, res);
  }

  async getAssignments(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.getDatasetVersionAssignments(req, res);
  }

  async assignRange(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.assignDatasetVersionRange(req, res);
  }

  async clearAssignmentRange(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.clearDatasetVersionAssignmentRange(req, res);
  }

  async clearUserAssignments(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.clearDatasetVersionUserAssignments(req, res);
  }

  async deleteSample(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.deleteDatasetVersionSample(req, res);
  }
}
