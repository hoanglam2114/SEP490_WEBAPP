import { Request, Response } from 'express';
import { PromptLibraryItem } from '../models/PromptLibraryItem';
import { DatasetVersion } from '../models/DatasetVersion';
import mongoose from 'mongoose';
import { getAuthUserId } from '../utils/auth';

export class PromptController {
  /**
   * GET /dataset-prompts
   * List all prompts for a given user, sorted newest first.
   * (Adapter: we can still accept /project/:projectName but ignore the parameter to keep frontend unbroken for now, or just provide a new route /dataset-prompts)
   */
  async listByProject(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const prompts = await PromptLibraryItem.find({ ownerId })
        .sort({ createdAt: -1 })
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
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid prompt id.' });
        return;
      }

      const prompt = await PromptLibraryItem.findOne({ _id: id, ownerId }).lean();
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
   * Create a new prompt in the library.
   * Body: { name, content, description?, isPublic? }
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { name, content, description, isPublic } = req.body as {
        name?: string;
        content?: string;
        description?: string;
        isPublic?: boolean;
      };

      const trimmedName = String(name || '').trim();
      const trimmedContent = String(content || '').trim();

      if (!trimmedName) {
        res.status(400).json({ error: 'name is required.' });
        return;
      }
      if (!trimmedContent) {
        res.status(400).json({ error: 'content is required.' });
        return;
      }

      const prompt = await PromptLibraryItem.create({
        ownerId,
        name: trimmedName,
        content: trimmedContent,
        description: String(description || '').trim(),
        isPublic: Boolean(isPublic),
      });

      res.status(201).json({
        message: `Created prompt "${trimmedName}".`,
        prompt,
      });
    } catch (error: any) {
      console.error('Create prompt error:', error);
      if (error.code === 11000) {
        res.status(409).json({ error: 'A prompt with this name already exists. Please choose a different name.' });
        return;
      }
      res.status(500).json({ error: 'Failed to create prompt', details: error.message });
    }
  }

  /**
   * DELETE /dataset-prompts/:id
   * Delete a prompt, only if no DatasetVersion references it.
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid prompt id.' });
        return;
      }

      const linkedCount = await DatasetVersion.countDocuments({ ownerId, promptId: new mongoose.Types.ObjectId(id) });
      if (linkedCount > 0) {
        res.status(409).json({
          error: `Cannot delete: ${linkedCount} dataset version(s) reference this prompt.`,
        });
        return;
      }

      const deleted = await PromptLibraryItem.findOneAndDelete({ _id: id, ownerId });
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
