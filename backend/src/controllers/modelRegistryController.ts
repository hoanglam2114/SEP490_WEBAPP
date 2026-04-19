import { Request, Response } from 'express';
import { ModelRegistry } from '../models/ModelRegistry';
import { ModelVersion, ModelVersionStatus } from '../models/ModelVersion';
import { TrainingHistory } from '../models/TrainingHistory';
import { ModelEvaluation } from '../models/Evaluation';
import fs from 'fs';
import path from 'path';

export class ModelRegistryController {
  // --- Registry Methods ---

  async listRegistries(req: Request, res: Response) {
    try {
      const registries = await ModelRegistry.find().sort({ updatedAt: -1 });
      res.json(registries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getRegistry(req: Request, res: Response) {
    try {
      const registry = await ModelRegistry.findById(req.params.id);
      if (!registry) return res.status(404).json({ message: 'Registry not found' });
      res.json(registry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async createRegistry(req: Request, res: Response) {
    try {
      const { name, description, baseModel } = req.body;
      const registry = await ModelRegistry.create({ name, description, baseModel });
      res.status(201).json(registry);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateRegistry(req: Request, res: Response) {
    try {
      const registry = await ModelRegistry.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!registry) return res.status(404).json({ message: 'Registry not found' });
      res.json(registry);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async deleteRegistry(req: Request, res: Response) {
    try {
      const registry = await ModelRegistry.findByIdAndDelete(req.params.id);
      if (!registry) return res.status(404).json({ message: 'Registry not found' });
      // Also delete all versions associated with this registry
      await ModelVersion.deleteMany({ modelRegistryId: registry._id });
      res.json({ message: 'Registry and its versions deleted' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  // --- Version Methods ---

  async listVersions(req: Request, res: Response) {
    try {
      const versions = await ModelVersion.find({ modelRegistryId: req.params.registryId })
        .populate('trainingHistoryId')
        .sort({ createdAt: -1 });
      res.json(versions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async registerVersion(req: Request, res: Response) {
    try {
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
      const registry = await ModelRegistry.findById(modelRegistryId);
      if (!registry) return res.status(404).json({ message: 'Model Registry not found' });

      let metrics: any = {};
      let configSnapshot = null;
      let datasetInfo = null;

      // 1. Fetch data from Training History
      if (trainingHistoryId) {
        const history = await TrainingHistory.findById(trainingHistoryId);
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
        const evaluation = await ModelEvaluation.findById(evaluationId);
        if (evaluation && evaluation.summary) {
          // Extract overall score if available
          const overall = evaluation.summary.overall?.ft_avg;
          const max = evaluation.summary.max_possible || 5;
          if (overall !== undefined) {
            metrics.overallScore = (overall / max) * 100; // Convert to percentage
          }
          metrics.evalSummary = evaluation.summary;
        }
      }

      const newVersion = await ModelVersion.create({
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
        status: status || ModelVersionStatus.DEVELOPMENT,
      });

      res.status(201).json(newVersion);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateVersionStatus(req: Request, res: Response) {
    try {
      const { status } = req.body;
      if (!Object.values(ModelVersionStatus).includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }

      const version = await ModelVersion.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
      );

      if (!version) return res.status(404).json({ message: 'Version not found' });

      // If status is PRODUCTION, we might want to demote other versions of the same registry
      if (status === ModelVersionStatus.PRODUCTION) {
        await ModelVersion.updateMany(
          {
            modelRegistryId: version.modelRegistryId,
            _id: { $ne: version._id },
            status: ModelVersionStatus.PRODUCTION
          },
          { status: ModelVersionStatus.STAGING }
        );
      }

      res.json(version);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  async deleteVersion(req: Request, res: Response) {
    try {
      const version = await ModelVersion.findByIdAndDelete(req.params.id);
      if (!version) return res.status(404).json({ message: 'Version not found' });
      res.json({ message: 'Version deleted' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getEvaluationsByJob(req: Request, res: Response) {
    try {
      const evaluations = await ModelEvaluation.find({ jobId: req.params.jobId, status: 'COMPLETED' })
        .select('modelEvalId summary createdAt judgeModel')
        .sort({ createdAt: -1 });
      res.json(evaluations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async downloadDataset(req: Request, res: Response) {
    try {
      const version = await ModelVersion.findById(req.params.id).populate('trainingHistoryId');
      if (!version) return res.status(404).json({ message: 'Version not found' });

      const history = version.trainingHistoryId as any;
      if (!history || !history.datasetPath) {
        return res.status(404).json({ message: 'Dataset file not found or not stored locally' });
      }

      const filePath = history.datasetPath;
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'File no longer exists on server' });
      }

      res.download(filePath, history.datasetName || 'dataset.json');
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  async getProductionVersion(req: Request, res: Response) {
    try {
      const { registryId } = req.params;
      const version = await ModelVersion.findOne({
        modelRegistryId: registryId,
        status: ModelVersionStatus.PRODUCTION
      }).populate('trainingHistoryId');

      if (!version) {
        return res.status(404).json({ message: 'No production version found for this registry' });
      }

      res.json(version);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
}
