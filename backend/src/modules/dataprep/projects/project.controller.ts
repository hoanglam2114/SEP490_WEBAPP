import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { getAuthUserId } from '../../../utils/auth';
import { DataPrepProjectService } from './project.service';

const projectService = new DataPrepProjectService();

export class DataPrepProjectController {
  async listProjects(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projects = await projectService.listProjects(ownerId);
      res.json({ projects });
    } catch (error: any) {
      console.error('DataPrep listProjects error:', error);
      res.status(500).json({ error: 'Failed to list dataprep projects', details: error.message });
    }
  }

  async getProject(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { projectId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(projectId)) {
        res.status(400).json({ error: 'Invalid project id' });
        return;
      }

      const project = await projectService.getProjectById(projectId, ownerId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const versions = await projectService.listVersions(projectId, ownerId);

      res.json({
        project,
        versions,
      });
    } catch (error: any) {
      console.error('DataPrep getProject error:', error);
      res.status(500).json({ error: 'Failed to get dataprep project', details: error.message });
    }
  }

  async listVersions(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { projectId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(projectId)) {
        res.status(400).json({ error: 'Invalid project id' });
        return;
      }

      const project = await projectService.getProjectById(projectId, ownerId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const versions = await projectService.listVersions(projectId, ownerId);
      res.json({ project, versions });
    } catch (error: any) {
      console.error('DataPrep listVersions error:', error);
      res.status(500).json({ error: 'Failed to list project versions', details: error.message });
    }
  }
}
