import { Request, Response } from 'express';
import { evaluationService } from '../services/evaluationService';
import { AlpacaFormat } from '../types';
import { EvaluationHistory } from '../models/EvaluationHistory';


export class EvaluationController {
    /**
     * POST /api/evaluate
     * Body: { data: AlpacaFormat[], sampleSize?: number }
     */
    async evaluate(req: Request, res: Response): Promise<void> {
        try {
            const { data, format } = req.body as {
                data: AlpacaFormat[];
                format?: string;
            };

            if (!data || !Array.isArray(data) || data.length === 0) {
                res.status(400).json({ error: 'Cần cung cấp mảng data (AlpacaFormat[]) không rỗng.' });
                return;
            }

            const result = await evaluationService.evaluateBatch(data, format);

            res.json(result);
        } catch (error: any) {
            console.error('Evaluation error:', error);
            res.status(500).json({
                error: 'Đánh giá thất bại',
                details: error.message,
            });
        }
    }

    /**
     * POST /api/evaluate/save
     * Body: { fileId, format, dataGroup, results[] }
     */
    async saveEvaluation(req: Request, res: Response): Promise<void> {
        try {
            const { fileId, format, dataGroup, results } = req.body as {
                fileId: string;
                format: string;
                dataGroup: string | number;
                results: Array<{
                    rowId: string;
                    groupId?: number;
                    instruction: string;
                    output: string;
                    reason: string;
                    scores: {
                        accuracy?: number;
                        clarity?: number;
                        completeness?: number;
                        socratic?: number;
                        alignment?: number;
                        factuality?: number;
                        overall: number;
                    };
                }>;
            };

            if (!fileId || !format || !Array.isArray(results) || results.length === 0) {
                res.status(400).json({ error: 'Thiếu dữ liệu lưu evaluation hoặc mảng results rỗng.' });
                return;
            }

            const validResults = results.filter((item) =>
                item &&
                item.rowId &&
                item.instruction !== undefined &&
                item.output !== undefined &&
                item.scores &&
                Number.isFinite(item.scores.overall)
            );

            if (validResults.length === 0) {
                res.status(400).json({ error: 'Không có evaluation result hợp lệ để lưu.' });
                return;
            }

            const avgScores = validResults.reduce(
                (acc, item) => {
                    acc.accuracy += item.scores.accuracy || 0;
                    acc.clarity += item.scores.clarity || 0;
                    acc.completeness += item.scores.completeness || 0;
                    acc.socratic += item.scores.socratic || 0;
                    acc.alignment += item.scores.alignment || 0;
                    acc.factuality += item.scores.factuality || 0;
                    acc.overall += item.scores.overall || 0;
                    return acc;
                },
                { accuracy: 0, clarity: 0, completeness: 0, socratic: 0, alignment: 0, factuality: 0, overall: 0 }
            );

            const size = validResults.length;
            const payload = {
                fileId,
                format,
                dataGroup: String(dataGroup ?? 'all'),
                results: validResults,
                avgScores: {
                    accuracy: Number((avgScores.accuracy / size).toFixed(4)),
                    clarity: Number((avgScores.clarity / size).toFixed(4)),
                    completeness: Number((avgScores.completeness / size).toFixed(4)),
                    socratic: Number((avgScores.socratic / size).toFixed(4)),
                    alignment: Number((avgScores.alignment / size).toFixed(4)),
                    factuality: Number((avgScores.factuality / size).toFixed(4)),
                    overall: Number((avgScores.overall / size).toFixed(4)),
                },
            };

            const saved = await EvaluationHistory.create(payload);

            res.json({
                message: 'Đã lưu kết quả evaluation vào MongoDB.',
                id: String(saved._id),
            });
        } catch (error: any) {
            console.error('Save evaluation error:', error);
            res.status(500).json({
                error: 'Lưu kết quả đánh giá thất bại',
                details: error.message,
            });
        }
    }
}
