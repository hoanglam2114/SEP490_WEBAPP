import { Request, Response } from 'express';
import { EvaluationSample, EvaluationService, RefinementSample } from '../services/evaluationService';
import { EvaluationHistory } from '../models/EvaluationHistory';
import { GeminiProvider } from '../services/providers/GeminiProvider';
import { OpenAIProvider } from '../services/providers/OpenAIProvider';

type EvalFormat = 'openai' | 'alpaca';

function normalizeProjectName(input?: string): string {
    const value = String(input || '').trim();
    if (!value) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        return `Project_${dd}/${mm}_${hh}:${min}`;
    }
    return value;
}

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
    private getService(provider?: string): EvaluationService {
        if (String(provider || '').toLowerCase() === 'openai') {
            return new EvaluationService(new OpenAIProvider());
        }
        return new EvaluationService(new GeminiProvider());
    }

    /**
     * POST /api/evaluate
     * Body: { data: EvaluationSample[], format?: string }
     * Accepts both AlpacaFormat[] and OpenAI conversation objects ({ messages: [...] }[])
     */
    async evaluate(req: Request, res: Response): Promise<void> {
        try {
            const { data, format, provider } = req.body as {
                data: EvaluationSample[];
                format?: string;
                provider?: 'gemini' | 'openai';
            };

            if (!data || !Array.isArray(data) || data.length === 0) {
                res.status(400).json({ error: 'Cần cung cấp mảng data không rỗng.' });
                return;
            }

            const service = this.getService(provider);
            const result = await service.evaluateBatch(data, format);

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
     * POST /api/evaluate/refine
     * Body: { data: [{ assistant, reason }] }
     */
    async refine(req: Request, res: Response): Promise<void> {
        try {
            const { data } = req.body as {
                data: RefinementSample[];
            };

            if (!Array.isArray(data) || data.length === 0) {
                res.status(400).json({ error: 'Cần cung cấp mảng data để refine.' });
                return;
            }

            const service = new EvaluationService(new GeminiProvider());
            const samples = data.map((item) => ({
                assistant: String(item?.assistant || ''),
                reason: String(item?.reason || ''),
            }));

            const refined = await service.refineBatch(samples);
            res.json({ items: refined, refined: refined.length });
        } catch (error: any) {
            console.error('Refine error:', error);
            res.status(500).json({
                error: 'Tinh chỉnh dữ liệu thất bại',
                details: error.message,
            });
        }
    }

    /**
     * POST /api/evaluate/save
     * Body: { fileId, projectName, items[] }
     */
    async saveEvaluation(req: Request, res: Response): Promise<void> {
        try {
            const { fileId, projectName, items } = req.body as {
                fileId: string;
                projectName?: string;
                items: Array<{
                    format: string;
                    data: Record<string, any>;
                    evaluatedBy: 'manual' | 'gemini' | 'openai' | 'none';
                    results: {
                        accuracy?: number;
                        clarity?: number;
                        completeness?: number;
                        socratic?: number;
                        encouragement?: number;
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

            const normalizedProjectName = normalizeProjectName(projectName);

            const docs = items
                .filter((item) =>
                    item &&
                    (item.format === 'openai' || item.format === 'alpaca') &&
                    item.data &&
                    (item.evaluatedBy === 'manual' || item.evaluatedBy === 'gemini' || item.evaluatedBy === 'openai' || item.evaluatedBy === 'none') &&
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
                        projectName: normalizedProjectName,
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
     * GET /api/evaluate/history?page=1&limit=20&format=openai|alpaca&minOverall=0
     */
    async getEvaluationHistory(req: Request, res: Response): Promise<void> {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
            const format = String(req.query.format || '').trim().toLowerCase();
            const minOverallRaw = Number(req.query.minOverall);
            const hasMinOverall = Number.isFinite(minOverallRaw);

            const filter: Record<string, any> = {};
            if (format === 'openai' || format === 'alpaca') {
                filter.format = format;
            }
            if (hasMinOverall) {
                filter['results.overall'] = { $gte: minOverallRaw };
            }

            const [projectGroups, totalProjects] = await Promise.all([
                EvaluationHistory.aggregate([
                    { $match: filter },
                    {
                        $group: {
                            _id: '$projectName',
                            projectName: { $first: '$projectName' },
                            totalItems: { $sum: 1 },
                            latestCreatedAt: { $max: '$createdAt' },
                            formats: { $addToSet: '$format' },
                            avgOverall: { $avg: '$results.overall' },
                        },
                    },
                    { $sort: { latestCreatedAt: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                ]),
                EvaluationHistory.aggregate([
                    { $match: filter },
                    { $group: { _id: '$projectName' } },
                    { $count: 'total' },
                ]),
            ]);

            const projectNames = projectGroups.map((group) => group.projectName);

            const items = projectNames.length
                ? await EvaluationHistory.find({ ...filter, projectName: { $in: projectNames } })
                    .sort({ createdAt: -1 })
                    .lean()
                : [];

            const itemMap = new Map<string, any[]>();
            for (const item of items) {
                const key = String((item as any).projectName || 'Untitled Project');
                if (!itemMap.has(key)) {
                    itemMap.set(key, []);
                }
                itemMap.get(key)!.push(item);
            }

            const projects = projectGroups.map((group) => ({
                projectName: String(group.projectName || 'Untitled Project'),
                totalItems: Number(group.totalItems || 0),
                latestCreatedAt: group.latestCreatedAt,
                formats: Array.isArray(group.formats) ? group.formats : [],
                avgOverall: Number((group.avgOverall || 0).toFixed(2)),
                items: itemMap.get(String(group.projectName || 'Untitled Project')) || [],
            }));

            const total = Number(totalProjects?.[0]?.total || 0);

            res.json({
                projects,
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
                    encouragement?: number;
                    factuality?: number;
                    overall: number;
                    reason: string;
                };
                evaluatedBy: 'manual' | 'gemini' | 'openai' | 'none';
            };

            if (!id) {
                res.status(400).json({ error: 'Thiếu id bản ghi cần cập nhật.' });
                return;
            }

            if (!results || !Number.isFinite(results.overall)) {
                res.status(400).json({ error: 'Thiếu hoặc sai dữ liệu results.' });
                return;
            }

            if (evaluatedBy !== 'manual' && evaluatedBy !== 'gemini' && evaluatedBy !== 'openai' && evaluatedBy !== 'none') {
                res.status(400).json({ error: 'evaluatedBy chỉ nhận manual, gemini, openai hoặc none.' });
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
