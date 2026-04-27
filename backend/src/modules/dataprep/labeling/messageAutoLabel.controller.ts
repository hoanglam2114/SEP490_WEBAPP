import { Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/auth';
import { GeminiProvider } from '../../../services/providers/GeminiProvider';
import { OpenAIProvider } from '../../../services/providers/OpenAIProvider';
import { DeepseekProvider } from '../../../services/providers/DeepseekProvider';
import { MessageAutoLabelingService } from './messageAutoLabel.service';

function getService(provider?: string) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'openai') {
    return new MessageAutoLabelingService(new OpenAIProvider());
  }
  if (normalized === 'deepseek') {
    return new MessageAutoLabelingService(new DeepseekProvider());
  }
  return new MessageAutoLabelingService(new GeminiProvider());
}

export class MessageAutoLabelingController {
  async preview(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { sampleId } = req.params;
      const { messages, provider } = req.body as {
        messages?: Array<{ messageIndex: number; role: 'user' | 'assistant'; content: string }>;
        provider?: 'gemini' | 'openai' | 'deepseek';
      };

      const service = getService(provider);
      const suggestions = await service.preview(sampleId, ownerId, messages || []);

      res.json({ suggestions });
    } catch (error: any) {
      console.error('Message auto-label preview error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Message auto-label preview failed',
      });
    }
  }

  async save(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = getAuthUserId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { sampleId } = req.params;
      const { suggestions, messages } = req.body as {
        suggestions?: Array<{
          messageIndex: number;
          role: 'user' | 'assistant';
          label: string | string[];
          confidence?: number;
          is_correct_logic?: boolean;
        }>;
        messages?: Array<{ messageIndex: number; role: 'user' | 'assistant'; content: string }>;
      };

      const service = getService('gemini');
      const result = await service.save(sampleId, ownerId, suggestions || [], messages || []);

      res.json({
        message: 'Message auto-labels saved successfully.',
        insertedCount: result.insertedCount,
      });
    } catch (error: any) {
      console.error('Message auto-label save error:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Message auto-label save failed',
      });
    }
  }
}
