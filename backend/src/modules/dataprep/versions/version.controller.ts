import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { EvaluationController } from '../../../controllers/evaluationController';
import { getAuthUserId } from '../../../utils/auth';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { versionService } from './version.service';

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

  async updatePrepareProgress(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.updateDatasetVersionPrepareProgress(req, res);
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

  async getUserAssignmentDetail(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.getDatasetVersionUserAssignmentDetail(req, res);
  }

  async clearAssignmentRange(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.clearDatasetVersionAssignmentRange(req, res);
  }

  async clearUserAssignments(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.clearDatasetVersionUserAssignments(req, res);
  }

  async getMyAssignmentStatus(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.getMyAssignmentSubmissionStatus(req, res);
  }

  async submitMyAssignment(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.submitMyAssignment(req, res);
  }

  async approveUserAssignment(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.approveUserAssignmentSubmission(req, res);
  }

  async deleteSample(req: Request, res: Response): Promise<void> {
    return legacyEvaluationController.deleteDatasetVersionSample(req, res);
  }

  private async cloneCheckpoint(
    req: Request,
    res: Response,
    options: {
      operationType: 'classification_balanced' | 'evaluation_filtered' | 'refine_approved';
      prepareResumeStep: number;
      stage: 'classification' | 'evaluation' | 'finish';
      checkpointReason: string;
    }
  ): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Dataset version id không hợp lệ.' });
        return;
      }

      const baseVersion = await DatasetVersion.findOne({ _id: id, ownerId }).lean();
      if (!baseVersion) {
        res.status(404).json({ error: 'Không tìm thấy dataset version.' });
        return;
      }

      const data = Array.isArray(req.body?.data) ? req.body.data : [];
      if (!data.length) {
        res.status(400).json({ error: 'Cần cung cấp dữ liệu checkpoint.' });
        return;
      }

      const operationParams = {
        ...(req.body?.operationParams && typeof req.body.operationParams === 'object' ? req.body.operationParams : {}),
        sourceVersionId: String(baseVersion._id),
        stage: options.stage,
        checkpointReason: options.checkpointReason,
      };

      const result = await versionService.cloneVersionFromVersion({
        ownerId,
        baseVersionId: String(baseVersion._id),
        operationType: options.operationType,
        operationParams,
        prepareResumeStep: options.prepareResumeStep,
        format: req.body?.format === 'openai' ? 'openai' : 'alpaca',
        data,
      });

      res.status(201).json({
        message: 'Đã tạo checkpoint version thành công.',
        project: {
          _id: String(result.project._id),
          name: result.project.name,
          sourceType: result.project.sourceType,
        },
        datasetVersion: result.datasetVersion,
        sampleIdMap: result.sampleIdMap,
      });
    } catch (error: any) {
      console.error('Create checkpoint version error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Tạo checkpoint version thất bại',
      });
    }
  }

  async createClassificationBalanceCheckpoint(req: Request, res: Response): Promise<void> {
    return this.cloneCheckpoint(req, res, {
      operationType: 'classification_balanced',
      prepareResumeStep: 10,
      stage: 'classification',
      checkpointReason: 'classification-balance',
    });
  }

  async createEvaluationFilterCheckpoint(req: Request, res: Response): Promise<void> {
    return this.cloneCheckpoint(req, res, {
      operationType: 'evaluation_filtered',
      prepareResumeStep: 11,
      stage: 'evaluation',
      checkpointReason: 'evaluation-filter',
    });
  }

  async createRefineAcceptCheckpoint(req: Request, res: Response): Promise<void> {
    return this.cloneCheckpoint(req, res, {
      operationType: 'refine_approved',
      prepareResumeStep: 13,
      stage: 'finish',
      checkpointReason: 'refine-accept',
    });
  }
}
