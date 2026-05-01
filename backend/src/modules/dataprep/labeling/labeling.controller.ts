import { Request, Response } from 'express';
import { addLabel, getLabelsBySample, voteLabel } from '../../../controllers/labelController';

export class DataPrepLabelingController {
  async getLabelsBySample(req: Request, res: Response): Promise<void> {
    return getLabelsBySample(req, res);
  }

  async addLabel(req: Request, res: Response): Promise<void> {
    return addLabel(req, res);
  }

  async voteLabel(req: Request, res: Response): Promise<void> {
    return voteLabel(req, res);
  }
}
