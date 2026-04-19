import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { DatasetPrompt } from '../models/DatasetPrompt';
import { DatasetVersion } from '../models/DatasetVersion';

export class PromptController {
  async getProjectPrompts(req: Request, res: Response): Promise<void> {
    try {
      const { projectName } = req.params;

      const prompts = await DatasetPrompt.find({ projectName }).sort({ createdAt: -1 });

      const promptsWithUsage = await Promise.all(
        prompts.map(async (prompt) => {
          const inUse = await DatasetVersion.exists({ promptId: prompt._id });
          return {
            ...prompt.toObject(),
            isUsed: Boolean(inUse),
          };
        })
      );

      res.json(promptsWithUsage);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Failed to fetch prompts' });
    }
  }

  async createPrompt(req: Request, res: Response): Promise<void> {
    try {
      const { projectName, content, description } = req.body;

      if (!projectName || !content) {
        res.status(400).json({ message: 'projectName and content are required' });
        return;
      }

      const latestPrompt = await DatasetPrompt.findOne({ projectName })
        .sort({ version: -1 })
        .select('version');

      const nextVersion = latestPrompt ? latestPrompt.version + 1 : 1;

      const created = await DatasetPrompt.create({
        projectName,
        version: nextVersion,
        content,
        description,
      });

      res.status(201).json(created);
    } catch (error: any) {
      if (error?.code === 11000) {
        res.status(409).json({
          message: 'Version conflict while creating prompt. Please retry.',
        });
        return;
      }

      res.status(400).json({ message: error.message || 'Failed to create prompt' });
    }
  }

  async deletePrompt(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ message: 'Invalid prompt id' });
        return;
      }

      // Explicitly block deletion if the prompt is referenced by any dataset version.
      const inUse = await DatasetVersion.exists({ promptId: id });
      if (inUse) {
        res.status(400).json({
          message: 'Cannot delete prompt because it is referenced by a dataset version',
        });
        return;
      }

      const deleted = await DatasetPrompt.findByIdAndDelete(id);
      if (!deleted) {
        res.status(404).json({ message: 'Prompt not found' });
        return;
      }

      res.json({ message: 'Prompt deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Failed to delete prompt' });
    }
  }
}
