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
  /**
   * Upload file JSON
   */
  async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const fileContent = await fs.readFile(req.file.path, 'utf-8');
      const messages: any[] = JSON.parse(fileContent);

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
        // Logic cho Lesson
        const alpacaData = conversionService.convertLessonToAlpaca(stored.data);
        const totalText = JSON.stringify(alpacaData);
        const totalTokensEstimate = conversionService.estimateTokens(totalText);
        result = {
          data: alpacaData,
          format: 'alpaca',
          stats: {
            totalConversations: stored.metadata.lessonCount || 0,
            totalMessages: stored.metadata.exerciseCount || 0,
            totalTokensEstimate
          }
        };
        // override options.format for lessons to guarantee JSONL
        options.format = 'alpaca';
      } else {
        result = conversionService.convert(stored.data as MongoDBMessage[], options);
      }

      // === PIPELINE LÀM SẠCH DỮ LIỆU (nếu được bật) ===
      if (options.enableCleaning && result.format === 'alpaca') {
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
      }


      // Format output dựa vào format type
      let output: string;
      const isJsonl = options.format === 'openai' || options.format === 'anthropic' || options.format === 'alpaca';

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
        filename: `converted_${options.format}_${Date.now()}.${isJsonl ? 'jsonl' : 'json'
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

      if (stored.metadata.fileType === 'lesson') {
        const preview: any[] = [];
        let totalExercises = 0;
        stored.data.slice(0, limit).forEach(record => {
          if (record.lessons && Array.isArray(record.lessons)) {
            record.lessons.forEach((lesson: any) => {
              const exercises = lesson.sections?.filter((s: any) => s.type === 'exercise') || [];
              totalExercises += exercises.length;
              if (exercises.length > 0) {
                preview.push({
                  conversation_id: lesson.lesson_title || record._id?.$oid || 'Unknown',
                  user_id: 'LessonSystem',
                  message_count: exercises.length,
                  start_time: new Date().toISOString(),
                  messages: exercises.map((ex: any) => ({
                    role: 'exercise',
                    content: ex.content.substring(0, 200) + (ex.content.length > 200 ? '...' : ''),
                    created_at: new Date().toISOString()
                  }))
                });
              }
            })
          }
        });

        res.json({
          preview,
          total: stored.metadata.lessonCount || 0,
          showing: preview.length,
        });
        return;
      }

      const conversations = conversionService.groupByConversations(stored.data as MongoDBMessage[]);
      const preview = conversations.slice(0, limit).map((conv) => ({
        conversation_id: conv.conversation_id,
        user_id: conv.user_id,
        message_count: conv.message_count,
        start_time: conv.start_time,
        messages: conv.messages.map((m) => ({
          role: m.role,
          content: m.content.substring(0, 200) + (m.content.length > 200 ? '...' : ''),
          created_at: m.created_at.$date,
        })),
      }));

      res.json({
        preview,
        total: conversations.length,
        showing: preview.length,
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