import { Request, Response } from 'express';
import { ConversionService } from '../services/conversionService';
import { MongoDBMessage, ConversionOptions } from '../types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
//import path from 'path';

const conversionService = new ConversionService();

// Lưu trữ tạm thời trong memory (production nên dùng Redis hoặc database)
const fileStorage = new Map<string, { data: any[]; metadata: any }>();

export class ConversionController {
  private parseFileContent(content: string): any[] {
    try {
      return JSON.parse(content);
    } catch (e) {
      // Try JSONL
      const lines = content.split('\n').filter((l) => l.trim());
      try {
        return lines.map((l) => JSON.parse(l));
      } catch (e2) {
        throw new Error('Invalid file format. Must be JSON or JSONL.');
      }
    }
  }

  /**
   * Upload file JSON/JSONL
   */
  async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const fileContent = await fs.readFile(req.file.path, 'utf-8');
      const messages = this.parseFileContent(fileContent);

      if (!Array.isArray(messages)) {
        res.status(400).json({ error: 'Invalid JSON format. Expected array.' });
        return;
      }

      const fileId = uuidv4();

      let fileType: string = 'chat';
      let metadata: any = {
        filename: req.file.originalname,
        size: req.file.size,
        uploadedAt: new Date(),
      };

      // Check if it's a lesson structure file
      if (messages.length > 0 && messages[0].lessons) {
        fileType = 'lesson';
        let lessonCount = 0;
        let exerciseCount = 0;

        // Cần traverse để tính stats
        messages.forEach(record => {
          if (record.lessons && Array.isArray(record.lessons)) {
            lessonCount += record.lessons.length;
            record.lessons.forEach((lesson: any) => {
              if (lesson.sections && Array.isArray(lesson.sections)) {
                exerciseCount += lesson.sections.filter((s: any) => s.type === 'exercise').length;
              }
            })
          }
        });

        metadata = {
          ...metadata,
          fileType,
          lessonCount,
          exerciseCount,
        };
      } else if (messages.length > 0 && Array.isArray(messages[0].messages)) {
        fileType = 'openai_messages';
        metadata = {
          ...metadata,
          fileType,
          messageCount: messages.reduce((sum, conv) => sum + (conv.messages?.length || 0), 0),
          conversationCount: messages.length,
        };
      } else {
        const conversations = conversionService.groupByConversations(messages);
        metadata = {
          ...metadata,
          fileType,
          messageCount: messages.length,
          conversationCount: conversations.length,
        };
      }

      fileStorage.set(fileId, {
        data: messages,
        metadata,
      });

      // Xóa file tạm
      await fs.unlink(req.file.path);

      res.json({
        fileId,
        ...metadata
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({
        error: 'Failed to process file',
        details: error.message
      });
    }
  }

  /**
   * Convert dữ liệu
   */
  async convertData(req: Request, res: Response): Promise<void> {
    try {
      const { fileId, options } = req.body as {
        fileId: string;
        options: ConversionOptions;
      };

      const stored = fileStorage.get(fileId);
      if (!stored) {
        res.status(404).json({ error: 'File not found. Please upload again.' });
        return;
      }

      let result: any;
      if (stored.metadata.fileType === 'lesson') {
        // Lesson supports both Alpaca and OpenAI formats
        const selectedFormat = options.format === 'openai' ? 'openai' : 'alpaca';
        const lessonData =
          selectedFormat === 'openai'
            ? conversionService.convertLessonToOpenAI(stored.data, options)
            : conversionService.convertLessonToAlpaca(stored.data);
        const totalText = JSON.stringify(lessonData);
        const totalTokensEstimate = conversionService.estimateTokens(totalText);
        result = {
          data: lessonData,
          format: selectedFormat,
          stats: {
            totalConversations: lessonData.length,
            totalMessages: selectedFormat === 'openai' ? lessonData.length * 2 : lessonData.length,
            totalTokensEstimate
          }
        };
      } else if (stored.metadata.fileType === 'openai_messages') {
        // If input is already OpenAI messages, we can pass through or convert to other formats
        if (options.format === 'openai') {
          result = {
            data: stored.data,
            format: 'openai',
            stats: {
              totalConversations: stored.data.length,
              totalMessages: stored.metadata.messageCount,
              totalTokensEstimate: conversionService.estimateTokens(JSON.stringify(stored.data))
            }
          };
        } else if (options.format === 'alpaca') {
          const alpacaData = conversionService.openAIToAlpaca(stored.data, options);
          result = {
            data: alpacaData,
            format: 'alpaca',
            stats: {
              totalConversations: alpacaData.length,
              totalMessages: alpacaData.length,
              totalTokensEstimate: conversionService.estimateTokens(JSON.stringify(alpacaData))
            }
          };
        } else {
          // Default fallback or handle other formats if needed
          result = {
            data: stored.data,
            format: options.format,
            stats: {
              totalConversations: stored.data.length,
              totalMessages: stored.metadata.messageCount,
              totalTokensEstimate: conversionService.estimateTokens(JSON.stringify(stored.data))
            }
          };
        }
      } else {
        result = conversionService.convert(stored.data as MongoDBMessage[], options);
      }

      // === PIPELINE LÀM SẠCH DỮ LIỆU (nếu được bật) ===
      if (options.enableCleaning) {
        if (result.format === 'alpaca') {
          const { cleaned, stats: cleaningStats } = conversionService.cleanAlpacaData(
            result.data,
            options
          );
          result.data = cleaned;
          result.stats.cleaning = cleaningStats;
          // Recompute token estimate sau khi lọc
          result.stats.totalTokensEstimate = conversionService.estimateTokens(
            JSON.stringify(cleaned)
          );
        } else if (result.format === 'openai') {
          const { cleaned, stats: cleaningStats } = conversionService.cleanOpenAIData(
            result.data,
            options
          );
          result.data = cleaned;
          result.stats.cleaning = cleaningStats;
          // Recompute token estimate sau khi lọc
          result.stats.totalTokensEstimate = conversionService.estimateTokens(
            JSON.stringify(cleaned)
          );
        }
      }


      // Format output dựa vào format type
      let output: string;
      const outputFormat = result.format;
      const isJsonl = outputFormat === 'openai' || outputFormat === 'anthropic' || outputFormat === 'alpaca';

      if (isJsonl) {
        // JSONL format: mỗi dòng là một JSON object
        output = result.data.map((item: any) => JSON.stringify(item)).join('\n');
      } else {
        // JSON format: array of objects
        output = JSON.stringify(result.data, null, 2);
      }

      res.json({
        ...result,
        output,
        filename: `converted_${outputFormat}_${Date.now()}.${isJsonl ? 'jsonl' : 'json'
          }`,
      });
    } catch (error: any) {
      console.error('Conversion error:', error);
      res.status(500).json({
        error: 'Failed to convert data',
        details: error.message
      });
    }
  }

  /**
   * Lấy thống kê về file
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;

      const stored = fileStorage.get(fileId);
      if (!stored) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      if (stored.metadata.fileType === 'lesson') {
        // Simple stats for lesson
        res.json({
          ...stored.metadata,
          uniqueUsers: 0,
          avgMessagesPerConversation: '0.00',
          dateRange: {
            earliest: new Date().toISOString(),
            latest: new Date().toISOString()
          }
        });
        return;
      }

      if (stored.metadata.fileType === 'openai_messages') {
        res.json({
          ...stored.metadata,
          uniqueUsers: 1, // Default for pre-formatted
          avgMessagesPerConversation: (stored.metadata.messageCount / stored.metadata.conversationCount).toFixed(2),
          dateRange: {
            earliest: new Date().toISOString(),
            latest: new Date().toISOString()
          }
        });
        return;
      }

      const conversations = conversionService.groupByConversations(stored.data as MongoDBMessage[]);

      // Phân tích thêm cho Chat
      const userIds = new Set(stored.data.map((m: any) => m.user_id));
      const avgMessagesPerConv =
        stored.data.length / conversations.length;

      const dateRange = {
        earliest: new Date(
          Math.min(
            ...stored.data.map((m: any) => new Date(m.created_at.$date).getTime())
          )
        ),
        latest: new Date(
          Math.max(
            ...stored.data.map((m: any) => new Date(m.created_at.$date).getTime())
          )
        ),
      };

      res.json({
        ...stored.metadata,
        uniqueUsers: userIds.size,
        avgMessagesPerConversation: avgMessagesPerConv.toFixed(2),
        dateRange,
      });
    } catch (error: any) {
      console.error('Stats error:', error);
      res.status(500).json({
        error: 'Failed to get stats',
        details: error.message
      });
    }
  }

  /**
   * Xem trước dữ liệu
   */
  async previewData(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;

      const stored = fileStorage.get(fileId);
      if (!stored) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const rawPreview = stored.data.slice(0, limit);
      
      res.json({
        preview: rawPreview,
        total: stored.data.length,
        showing: rawPreview.length,
        isRaw: true
      });
    } catch (error: any) {
      console.error('Preview error:', error);
      res.status(500).json({
        error: 'Failed to preview data',
        details: error.message
      });
    }
  }

  /**
   * Xóa file khỏi storage
   */
  async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;

      if (!fileStorage.has(fileId)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      fileStorage.delete(fileId);
      res.json({ message: 'File deleted successfully' });
    } catch (error: any) {
      console.error('Delete error:', error);
      res.status(500).json({
        error: 'Failed to delete file',
        details: error.message
      });
    }
  }
}