import { Request, Response } from 'express';
import { ModelRegistry } from '../models/ModelRegistry';
import { ModelVersion, ModelVersionStatus } from '../models/ModelVersion';
import { TrainingHistory } from '../models/TrainingHistory';
import { ModelEvaluation } from '../models/Evaluation';
import fs from 'fs';
import { getAuthUserId } from '../utils/auth';

export class ModelRegistryController {
  // --- Registry Methods ---

  async listRegistries(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const registries = await ModelRegistry.find({ ownerId }).sort({ updatedAt: -1 });
      res.json(registries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getRegistry(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const registry = await ModelRegistry.findOne({ _id: req.params.id, ownerId });
      if (!registry) {
        res.status(404).json({ message: 'Registry not found' });
        return;
      }
      res.json(registry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async createRegistry(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { name, description, baseModel } = req.body;
      const registry = await ModelRegistry.create({ ownerId, name, description, baseModel });
      res.status(201).json(registry);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateRegistry(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const registry = await ModelRegistry.findOneAndUpdate(
        { _id: req.params.id, ownerId },
        req.body,
        { new: true }
      );
      if (!registry) {
        res.status(404).json({ message: 'Registry not found' });
        return;
      }
      res.json(registry);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async deleteRegistry(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const registry = await ModelRegistry.findOneAndDelete({ _id: req.params.id, ownerId });
      if (!registry) {
        res.status(404).json({ message: 'Registry not found' });
        return;
      }
      // Also delete all versions associated with this registry
      await ModelVersion.deleteMany({ ownerId, modelRegistryId: registry._id });
      res.json({ message: 'Registry and its versions deleted' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  // --- Version Methods ---

  async listVersions(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const versions = await ModelVersion.find({ ownerId, modelRegistryId: req.params.registryId })
        .populate('trainingHistoryId')
        .sort({ createdAt: -1 });
      res.json(versions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async registerVersion(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const {
        modelRegistryId,
        version,
        trainingHistoryId,
        evaluationId,
        hfRepoId,
        notes,
        status,
        promptVersion
      } = req.body;

      // Validate registry exists
      const registry = await ModelRegistry.findOne({ _id: modelRegistryId, ownerId });
      if (!registry) {
        res.status(404).json({ message: 'Model Registry not found' });
        return;
      }

      let metrics: any = {};
      let configSnapshot = null;
      let datasetInfo: { name: string; source: string } | undefined;

      // 1. Fetch data from Training History
      if (trainingHistoryId) {
        const history = await TrainingHistory.findOne({ _id: trainingHistoryId, ownerId });
        if (history) {
          if (history.finalMetrics) {
            metrics = { ...history.finalMetrics };
          }
          configSnapshot = history.parameters; // or history.config_snapshot
          datasetInfo = {
            name: history.datasetName,
            source: history.datasetSource,
          };
        }
      }

      // 2. Fetch data from Evaluation (if provided)
      // This will override or supplement metrics from training history
      if (evaluationId) {
        const evaluation = await ModelEvaluation.findOne({ _id: evaluationId, ownerId });
        if (evaluation && evaluation.summary) {
          const overall = typeof evaluation.summary.overall === 'number'
            ? evaluation.summary.overall
            : null;
          const max = evaluation.summary.max_possible || 5;
          if (overall !== null) {
            metrics.overallScore = (overall / max) * 100;
          }
          metrics.evalSummary = evaluation.summary;
        }
      }

      const newVersion = await ModelVersion.create({
        ownerId,
        modelRegistryId,
        version,
        trainingHistoryId,
        evaluationId,
        hfRepoId,
        notes,
        metrics,
        configSnapshot,
        datasetInfo,
        promptVersion,
        status: status || ModelVersionStatus.NOT_USE,
      });

      res.status(201).json(newVersion);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateVersionStatus(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { status } = req.body;
      if (!Object.values(ModelVersionStatus).includes(status)) {
        res.status(400).json({ message: 'Invalid status' });
        return;
      }

      const version = await ModelVersion.findOneAndUpdate(
        { _id: req.params.id, ownerId },
        { status },
        { new: true }
      );

      if (!version) {
        res.status(404).json({ message: 'Version not found' });
        return;
      }

      // If status is USE, we might want to demote other versions of the same registry
      if (status === ModelVersionStatus.USE) {
        await ModelVersion.updateMany(
          {
            ownerId,
            modelRegistryId: version.modelRegistryId,
            _id: { $ne: version._id },
            status: ModelVersionStatus.USE
          },
          { status: ModelVersionStatus.NOT_USE }
        );
      }

      res.json(version);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async deleteVersion(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const version = await ModelVersion.findOneAndDelete({ _id: req.params.id, ownerId });
      if (!version) {
        res.status(404).json({ message: 'Version not found' });
        return;
      }
      res.json({ message: 'Version deleted' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getEvaluationsByJob(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const evaluations = await ModelEvaluation.find({ ownerId, jobId: req.params.jobId, status: 'COMPLETED' })
        .select('modelEvalId summary createdAt judgeModel')
        .sort({ createdAt: -1 });
      res.json(evaluations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async downloadDataset(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const version = await ModelVersion.findOne({ _id: req.params.id, ownerId }).populate('trainingHistoryId');
      if (!version) {
        res.status(404).json({ message: 'Version not found' });
        return;
      }

      const history = version.trainingHistoryId as any;
      if (!history || String(history.ownerId) !== ownerId || !history.datasetPath) {
        res.status(404).json({ message: 'Dataset file not found or not stored locally' });
        return;
      }

      const filePath = history.datasetPath;
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ message: 'File no longer exists on server' });
        return;
      }

      res.download(filePath, history.datasetName || 'dataset.json');
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getActiveVersion(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { registryId } = req.params;
      const version = await ModelVersion.findOne({
        ownerId,
        modelRegistryId: registryId,
        status: ModelVersionStatus.USE
      }).populate('trainingHistoryId');

      if (!version) {
        res.status(404).json({ message: 'No active version found for this registry' });
        return;
      }

      res.json(version);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
}
