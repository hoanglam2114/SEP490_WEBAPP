import { Request, Response } from 'express';
import { GpuClient } from '../gpu/gpuClient';
import { DataPrepPreprocessingService } from './preprocessing.service';
import { versionService } from '../versions/version.service';
import { getAuthUserId } from '../../../utils/auth';
import dotenv from 'dotenv';

dotenv.config();
const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
const gpuClient = new GpuClient(GPU_SERVICE_URL);
const preprocessingService = new DataPrepPreprocessingService();

export class DataPrepPreprocessingController {
  private handleError(res: Response, error: any) {
    res.status(error?.statusCode || 500).json({ error: error.message });
  }

  private async hydrateAndGetVersion(req: Request, allowPublicRead = false) {
    const { versionId } = req.params;
    if (!versionId) return null;

    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      const error = new Error('Unauthorized');
      (error as any).statusCode = 401;
      throw error;
    }

    const version = await preprocessingService.getAuthorizedVersion(versionId, ownerId, allowPublicRead);
    if (!version) {
      const error = new Error('Dataset version not found');
      (error as any).statusCode = 404;
      throw error;
    }

    const data = await preprocessingService.loadSerializedVersionData(versionId);
    req.body = { ...(req.body || {}), data };
    return version;
  }

  async visualize(req: Request, res: Response): Promise<void> {
    try {
      await this.hydrateAndGetVersion(req, true);
      const gpuResponse = await gpuClient.visualize(req.body);
      res.status(gpuResponse.status).json(gpuResponse.data);
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  async cluster(req: Request, res: Response): Promise<void> {
    try {
      const version = await this.hydrateAndGetVersion(req);
      const gpuResponse = await gpuClient.cluster(req.body);

      if (gpuResponse.status === 200 && version) {
        const result = await versionService.createVersion({
          ownerId: String(version.ownerId),
          projectId: version.projectId ? String(version.projectId) : undefined,
          projectName: version.projectName,
          parentVersionId: String(version._id),
          operationType: 'cluster',
          operationParams: { k: req.body.k, eps: req.body.eps, min_samples: req.body.min_samples },
          similarityThreshold: version.similarityThreshold,
          data: gpuResponse.data.data,
          promptId: version.promptId ? String(version.promptId) : undefined,
          promptContentSnapshot: version.promptContentSnapshot,
        });
        res.status(201).json({ ...result, gpuResult: gpuResponse.data });
      } else {
        res.status(gpuResponse.status).json(gpuResponse.data);
      }
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  async filter(req: Request, res: Response): Promise<void> {
    try {
      const version = await this.hydrateAndGetVersion(req);
      const gpuResponse = await gpuClient.filter(req.body);

      if (gpuResponse.status === 200 && version) {
        const result = await versionService.createVersion({
          ownerId: String(version.ownerId),
          projectId: version.projectId ? String(version.projectId) : undefined,
          projectName: version.projectName,
          parentVersionId: String(version._id),
          operationType: 'clean',
          operationParams: { threshold: req.body.threshold },
          similarityThreshold: version.similarityThreshold,
          data: gpuResponse.data.data,
          promptId: version.promptId ? String(version.promptId) : undefined,
          promptContentSnapshot: version.promptContentSnapshot,
        });
        res.status(201).json({ ...result, gpuResult: gpuResponse.data });
      } else {
        res.status(gpuResponse.status).json(gpuResponse.data);
      }
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  async removeNoise(req: Request, res: Response): Promise<void> {
    try {
      const version = await this.hydrateAndGetVersion(req);
      const cacheWarmupResponse = await gpuClient.cluster(req.body);
      if (cacheWarmupResponse.status < 200 || cacheWarmupResponse.status >= 300) {
        res.status(cacheWarmupResponse.status).json(cacheWarmupResponse.data);
        return;
      }
      const gpuResponse = await gpuClient.removeNoise();

      if (gpuResponse.status === 200 && version) {
        const result = await versionService.createVersion({
          ownerId: String(version.ownerId),
          projectId: version.projectId ? String(version.projectId) : undefined,
          projectName: version.projectName,
          parentVersionId: String(version._id),
          operationType: 'clean',
          operationParams: { action: 'remove-noise' },
          similarityThreshold: version.similarityThreshold,
          data: gpuResponse.data.data,
          promptId: version.promptId ? String(version.promptId) : undefined,
          promptContentSnapshot: version.promptContentSnapshot,
        });
        res.status(201).json({ ...result, gpuResult: gpuResponse.data });
      } else {
        res.status(gpuResponse.status).json(gpuResponse.data);
      }
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  async deduplicate(req: Request, res: Response): Promise<void> {
    try {
      const version = await this.hydrateAndGetVersion(req);
      const cacheWarmupResponse = await gpuClient.cluster(req.body);
      if (cacheWarmupResponse.status < 200 || cacheWarmupResponse.status >= 300) {
        res.status(cacheWarmupResponse.status).json(cacheWarmupResponse.data);
        return;
      }
      const gpuResponse = await gpuClient.deduplicate(req.body);

      if (gpuResponse.status === 200 && version) {
        const result = await versionService.createVersion({
          ownerId: String(version.ownerId),
          projectId: version.projectId ? String(version.projectId) : undefined,
          projectName: version.projectName,
          parentVersionId: String(version._id),
          operationType: 'clean',
          operationParams: { action: 'deduplicate', threshold: req.body.threshold },
          similarityThreshold: version.similarityThreshold,
          data: gpuResponse.data.data,
          promptId: version.promptId ? String(version.promptId) : undefined,
          promptContentSnapshot: version.promptContentSnapshot,
        });
        res.status(201).json({ ...result, gpuResult: gpuResponse.data });
      } else {
        res.status(gpuResponse.status).json(gpuResponse.data);
      }
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  async clearCache(_req: Request, res: Response): Promise<void> {
    try {
      const gpuResponse = await gpuClient.clearCache();
      res.status(gpuResponse.status).json(gpuResponse.data);
    } catch (error: any) {
      this.handleError(res, error);
    }
  }
}
