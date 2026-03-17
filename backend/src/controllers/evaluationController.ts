import { Request, Response } from 'express';
import { GeminiService } from '../services/geminiService';
import { AlpacaFormat } from '../types';

const geminiService = new GeminiService();

export class EvaluationController {
    /**
     * POST /api/evaluate
     * Body: { data: AlpacaFormat[], sampleSize?: number }
     */
    async evaluate(req: Request, res: Response): Promise<void> {
        try {
            const { data } = req.body as {
                data: AlpacaFormat[];
            };

            if (!data || !Array.isArray(data) || data.length === 0) {
                res.status(400).json({ error: 'Cần cung cấp mảng data (AlpacaFormat[]) không rỗng.' });
                return;
            }

            const result = await geminiService.evaluateBatch(data);

            res.json(result);
        } catch (error: any) {
            console.error('Evaluation error:', error);
            res.status(500).json({
                error: 'Đánh giá thất bại',
                details: error.message,
            });
        }
    }
}
