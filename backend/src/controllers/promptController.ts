import { Request, Response } from 'express';
import { DatasetPrompt } from '../models/DatasetPrompt';
import { DatasetVersion } from '../models/DatasetVersion';
import mongoose from 'mongoose';

export class PromptController {
  /**
   * GET /dataset-prompts/project/:projectName
   * List all prompt versions for a given project, sorted newest first.
   */
  async listByProject(req: Request, res: Response): Promise<void> {
    try {
      const { projectName } = req.params;
      if (!projectName || !String(projectName).trim()) {
        res.status(400).json({ error: 'projectName is required.' });
        return;
      }

      const prompts = await DatasetPrompt.find({ projectName: String(projectName).trim() })
        .sort({ version: -1 })
        .lean();

      res.json({ prompts });
    } catch (error: any) {
      console.error('List prompts error:', error);
      res.status(500).json({ error: 'Failed to list prompts', details: error.message });
    }
  }

  /**
   * GET /dataset-prompts/:id
   * Get a single prompt version by its MongoDB _id.
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid prompt id.' });
        return;
      }

      const prompt = await DatasetPrompt.findById(id).lean();
      if (!prompt) {
        res.status(404).json({ error: 'Prompt not found.' });
        return;
      }

      res.json({ prompt });
    } catch (error: any) {
      console.error('Get prompt error:', error);
      res.status(500).json({ error: 'Failed to get prompt', details: error.message });
    }
  }

  /**
   * POST /dataset-prompts
   * Create a new prompt version for a project.
   * Auto-increments the version number.
   * Body: { projectName, content, description? }
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const { projectName, content, description } = req.body as {
        projectName?: string;
        content?: string;
        description?: string;
      };

      const trimmedProject = String(projectName || '').trim();
      const trimmedContent = String(content || '').trim();

      if (!trimmedProject) {
        res.status(400).json({ error: 'projectName is required.' });
        return;
      }
      if (!trimmedContent) {
        res.status(400).json({ error: 'content is required.' });
        return;
      }

      // Auto-increment version number
      const latestPrompt = await DatasetPrompt.findOne({ projectName: trimmedProject })
        .sort({ version: -1 })
        .select('version')
        .lean();
      const nextVersion = (latestPrompt?.version || 0) + 1;

      const prompt = await DatasetPrompt.create({
        projectName: trimmedProject,
        version: nextVersion,
        content: trimmedContent,
        description: String(description || '').trim(),
      });

      res.status(201).json({
        message: `Created prompt version ${nextVersion} for project "${trimmedProject}".`,
        prompt,
      });
    } catch (error: any) {
      console.error('Create prompt error:', error);
      // Handle duplicate key error (race condition)
      if (error.code === 11000) {
        res.status(409).json({ error: 'Duplicate version number. Please try again.' });
        return;
      }
      res.status(500).json({ error: 'Failed to create prompt', details: error.message });
    }
  }

  /**
   * DELETE /dataset-prompts/:id
   * Delete a prompt version, only if no DatasetVersion references it.
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid prompt id.' });
        return;
      }

      // Check if any DatasetVersion references this prompt
      const linkedCount = await DatasetVersion.countDocuments({ promptId: new mongoose.Types.ObjectId(id) });
      if (linkedCount > 0) {
        res.status(409).json({
          error: `Cannot delete: ${linkedCount} dataset version(s) reference this prompt.`,
        });
        return;
      }

      const deleted = await DatasetPrompt.findByIdAndDelete(id);
      if (!deleted) {
        res.status(404).json({ error: 'Prompt not found.' });
        return;
      }

      res.json({ message: 'Prompt deleted successfully.' });
    } catch (error: any) {
      console.error('Delete prompt error:', error);
      res.status(500).json({ error: 'Failed to delete prompt', details: error.message });
    }
  }
}
