import { Request, Response } from 'express';
import { evaluationService, EvaluationSample } from '../services/evaluationService';
import { EvaluationHistory } from '../models/EvaluationHistory';

type EvalFormat = 'openai' | 'alpaca';

function normalizeEvaluationData(format: EvalFormat, rawData: Record<string, any>): Record<string, any> | null {
    if (!rawData || typeof rawData !== 'object') {
        return null;
    }

    if (format === 'openai') {
        const rawMessages = Array.isArray(rawData.messages) ? rawData.messages : [];

        let messages = rawMessages
            .map((msg) => ({
                role: String(msg?.role || '').trim(),
                content: String(msg?.content || '').trim(),
            }))
            .filter((msg) => !!msg.role && !!msg.content);

        if (!messages.length) {
            const legacyUser = String(rawData.userText ?? rawData.instruction ?? '').trim();
            const legacyAssistant = String(rawData.assistantText ?? rawData.output ?? '').trim();
            messages = [
                legacyUser ? { role: 'user', content: legacyUser } : null,
                legacyAssistant ? { role: 'assistant', content: legacyAssistant } : null,
            ].filter(Boolean) as Array<{ role: string; content: string }>;
        }

        if (!messages.length) {
            return null;
        }

        return {
            messages,
        };
    }

    const instruction = String(rawData.instruction ?? rawData.userText ?? '').trim();
    const input = String(rawData.input ?? '').trim();
    const output = String(rawData.output ?? rawData.assistantText ?? '').trim();

    if (!instruction || !output) {
        return null;
    }

    return {
        instruction,
        input,
        output,
    };
}


export class EvaluationController {
    /**
     * POST /api/evaluate
     * Body: { data: EvaluationSample[], format?: string }
     * Accepts both AlpacaFormat[] and OpenAI conversation objects ({ messages: [...] }[])
     */
    async evaluate(req: Request, res: Response): Promise<void> {
        try {
            const { data, format } = req.body as {
                data: EvaluationSample[];
                format?: string;
            };

            if (!data || !Array.isArray(data) || data.length === 0) {
                res.status(400).json({ error: 'Cần cung cấp mảng data không rỗng.' });
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
     * Body: { fileId, items[] }
     */
    async saveEvaluation(req: Request, res: Response): Promise<void> {
        try {
            const { fileId, items } = req.body as {
                fileId: string;
                items: Array<{
                    format: string;
                    data: Record<string, any>;
                    evaluatedBy: 'manual' | 'gemini';
                    results: {
                        accuracy?: number;
                        clarity?: number;
                        completeness?: number;
                        socratic?: number;
                        alignment?: number;
                        factuality?: number;
                        overall: number;
                        reason: string;
                    };
                    createdAt: string;
                }>;
            };

            if (!fileId || !Array.isArray(items) || items.length === 0) {
                res.status(400).json({ error: 'Thiếu dữ liệu lưu evaluation hoặc mảng items rỗng.' });
                return;
            }

            const docs = items
                .filter((item) =>
                item &&
                (item.format === 'openai' || item.format === 'alpaca') &&
                item.data &&
                (item.evaluatedBy === 'manual' || item.evaluatedBy === 'gemini') &&
                item.results &&
                Number.isFinite(item.results.overall)
                )
                .map((item) => {
                    const format = item.format as EvalFormat;
                    const normalizedData = normalizeEvaluationData(format, item.data);

                    if (!normalizedData) {
                        return null;
                    }

                    return {
                        fileId,
                        format,
                        data: normalizedData,
                        evaluatedBy: item.evaluatedBy,
                        results: item.results,
                        createdAt: new Date(item.createdAt || Date.now()),
                        updatedAt: new Date(),
                    };
                })
                .filter(Boolean);

            if (docs.length === 0) {
                res.status(400).json({ error: 'Không có evaluation item hợp lệ để lưu.' });
                return;
            }

            await EvaluationHistory.insertMany(docs);

            res.json({
                message: 'Đã lưu kết quả evaluation vào MongoDB.',
                insertedCount: docs.length,
            });
        } catch (error: any) {
            console.error('Save evaluation error:', error);
            res.status(500).json({
                error: 'Lưu kết quả đánh giá thất bại',
                details: error.message,
            });
        }
    }

    /**
     * GET /api/evaluate/history?page=1&limit=20&format=openai|alpaca
     */
    async getEvaluationHistory(req: Request, res: Response): Promise<void> {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
            const format = String(req.query.format || '').trim().toLowerCase();

            const filter: Record<string, any> = {};
            if (format === 'openai' || format === 'alpaca') {
                filter.format = format;
            }

            const [items, total] = await Promise.all([
                EvaluationHistory.find(filter)
                    .sort({ createdAt: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                EvaluationHistory.countDocuments(filter),
            ]);

            res.json({
                items,
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            });
        } catch (error: any) {
            console.error('Get evaluation history error:', error);
            res.status(500).json({
                error: 'Lấy lịch sử đánh giá thất bại',
                details: error.message,
            });
        }
    }

    /**
     * PATCH /api/evaluate/history/:id
     * Body: { results, evaluatedBy }
     */
    async updateEvaluationHistory(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { results, evaluatedBy } = req.body as {
                results: {
                    accuracy?: number;
                    clarity?: number;
                    completeness?: number;
                    socratic?: number;
                    alignment?: number;
                    factuality?: number;
                    overall: number;
                    reason: string;
                };
                evaluatedBy: 'manual' | 'gemini';
            };

            if (!id) {
                res.status(400).json({ error: 'Thiếu id bản ghi cần cập nhật.' });
                return;
            }

            if (!results || !Number.isFinite(results.overall)) {
                res.status(400).json({ error: 'Thiếu hoặc sai dữ liệu results.' });
                return;
            }

            if (evaluatedBy !== 'manual' && evaluatedBy !== 'gemini') {
                res.status(400).json({ error: 'evaluatedBy chỉ nhận manual hoặc gemini.' });
                return;
            }

            const updated = await EvaluationHistory.findByIdAndUpdate(
                id,
                {
                    $set: {
                        results,
                        evaluatedBy,
                        updatedAt: new Date(),
                    },
                },
                { new: true }
            ).lean();

            if (!updated) {
                res.status(404).json({ error: 'Không tìm thấy bản ghi evaluation history.' });
                return;
            }

            res.json({
                message: 'Cập nhật bản ghi evaluation thành công.',
                item: updated,
            });
        } catch (error: any) {
            console.error('Update evaluation history error:', error);
            res.status(500).json({
                error: 'Cập nhật lịch sử đánh giá thất bại',
                details: error.message,
            });
        }
    }
}
