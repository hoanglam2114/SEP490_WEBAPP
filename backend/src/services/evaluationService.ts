import { ILlmProvider } from './providers/ILlmProvider';
import { AlpacaFormat } from '../types';
import { ALPACA_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT, REFINEMENT_SYSTEM_PROMPT } from '../constants/prompts';
import { GeminiProvider } from './providers/GeminiProvider';

export interface SampleEvaluation {
    instruction: string;
    output: string;
    reason: string;        // Lý do đánh giá
    scores: {
        accuracy?: number;    // Chính xác (0–10)
        clarity?: number;     // Rõ ràng (0–10)
        completeness?: number; // Đủ ý (0–10)
        socratic?: number;
        encouragement?: number;
        factuality?: number;
        overall: number;     // Trung bình
    };
}

export interface EvaluationResult {
    sampleSize: number;
    evaluated: number;
    avgScores: {
        accuracy?: number;
        clarity?: number;
        completeness?: number;
        socratic?: number;
        encouragement?: number;
        factuality?: number;
        overall: number;
    };
    passRate: number; // % mẫu đạt >= 6/10
    totalPopulation: number;
    samples: SampleEvaluation[];
}

// A full OpenAI conversation object sent from the frontend for conversation-level evaluation
export interface OpenAIConversationSample {
    conversation_id?: string;
    messages: Array<{ role: string; content: string }>;
}

// Union type: either a flat Alpaca sample or a full OpenAI conversation
export type EvaluationSample = AlpacaFormat | OpenAIConversationSample;

export interface RefinementSample {
    assistant: string;
    reason: string;
}

export interface RefinementResultItem {
    assistant: string;
    refinedOutput: string;
}

function isConversationSample(s: EvaluationSample): s is OpenAIConversationSample {
    return Array.isArray((s as OpenAIConversationSample).messages);
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class EvaluationService {
    constructor(private provider: ILlmProvider) { }

    private static readonly MAX_MESSAGES_PER_CONVERSATION = 16;
    private static readonly MAX_MESSAGE_CHARS = 800;

    private compactText(content: string, maxChars = EvaluationService.MAX_MESSAGE_CHARS): string {
        const text = String(content || '');
        if (text.length <= maxChars) {
            return text;
        }

        const head = text.slice(0, Math.floor(maxChars * 0.7));
        const tail = text.slice(-Math.floor(maxChars * 0.3));
        return `${head}\n...[truncated]...\n${tail}`;
    }

    private compactMessages(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
        const normalized = messages.map((m) => ({
            role: String(m?.role || ''),
            content: this.compactText(String(m?.content || '')),
        }));

        if (normalized.length <= EvaluationService.MAX_MESSAGES_PER_CONVERSATION) {
            return normalized;
        }

        const half = Math.floor(EvaluationService.MAX_MESSAGES_PER_CONVERSATION / 2);
        return [
            ...normalized.slice(0, half),
            ...normalized.slice(-half),
        ];
    }

    private toInstructionOutput(sample: EvaluationSample): { instruction: string; output: string } {
        if (isConversationSample(sample)) {
            const firstUser = sample.messages.find((m) => m.role === 'user');
            const lastAssistant = [...sample.messages].reverse().find((m) => m.role === 'assistant');
            return {
                instruction: firstUser?.content || '',
                output: lastAssistant?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '',
            };
        }

        return {
            instruction: sample.instruction,
            output: sample.output,
        };
    }

    /**
     * Đánh giá một chunk (lên đến 20 mẫu).
     * - Khi format = 'openai' và sample có trường messages[], đánh giá toàn bộ cuộc hội thoại.
     * - Khi format = 'alpaca', đánh giá theo cặp instruction/output như cũ.
     */
    async evaluateChunk(samples: EvaluationSample[], format?: string): Promise<SampleEvaluation[]> {
        if (samples.length === 0) return [];

        const isOpenAI = format === 'openai';

        const batchPayload = isOpenAI
            ? samples.map((s, index) => {
                if (isConversationSample(s)) {
                    return {
                        index,
                        messages: this.compactMessages(s.messages || []),
                    };
                }

                return {
                    index,
                    messages: [
                        { role: 'user', content: String((s as AlpacaFormat).instruction || '') },
                        { role: 'assistant', content: String((s as AlpacaFormat).output || '') },
                    ],
                };
            })
            : samples.map((s, index) => {
                const alpaca = s as AlpacaFormat;
                return {
                    index,
                    instruction: String(alpaca.instruction || ''),
                    input: String(alpaca.input || ''),
                    output: String(alpaca.output || ''),
                };
            });

        const samplesJson = JSON.stringify(batchPayload);
        const prompt = isOpenAI
            ? OPENAI_SYSTEM_PROMPT.replace('${samplesJson}', samplesJson)
            : ALPACA_SYSTEM_PROMPT.replace('${samplesJson}', samplesJson);

        try {
            const rawText = await this.provider.generateContent(prompt);

            let jsonString = rawText;
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }

            let parsedArray: any[];
            try {
                parsedArray = JSON.parse(jsonString);
                if (!Array.isArray(parsedArray)) {
                    parsedArray = [parsedArray];
                }
            } catch (e) {
                console.error('JSON parsing failed. Raw text snippet:', jsonString.substring(0, 100));
                parsedArray = [];
            }

            const byIndex = new Map<number, any>();
            parsedArray.forEach((item, idx) => {
                const mappedIndex = Number(item?.index ?? item?.id);
                if (Number.isFinite(mappedIndex)) {
                    byIndex.set(mappedIndex, item);
                } else {
                    // Fallback by position if model omits index
                    byIndex.set(idx, item);
                }
            });

            return samples.map((sample, idx) => {
                const parsed = byIndex.get(idx) || {};
                const scoreSource = parsed?.scores && typeof parsed.scores === 'object' ? parsed.scores : parsed;
                const reason = String(parsed.reason || 'Không có lý do cụ thể');
                const { instruction, output } = this.toInstructionOutput(sample);

                if (isOpenAI) {
                    const socratic = Math.min(10, Math.max(0, Number(scoreSource.socratic) || 0));
                    const encouragement = Math.min(10, Math.max(0, Number(scoreSource.encouragement) || 0));
                    const factuality = Math.min(10, Math.max(0, Number(scoreSource.factuality) || 0));
                    const overall = Math.round(((socratic + encouragement + factuality) / 3) * 10) / 10;
                    return {
                        instruction,
                        output,
                        reason,
                        scores: { socratic, encouragement, factuality, overall },
                    };
                }

                const accuracy = Math.min(10, Math.max(0, Number(scoreSource.accuracy) || 0));
                const clarity = Math.min(10, Math.max(0, Number(scoreSource.clarity) || 0));
                const completeness = Math.min(10, Math.max(0, Number(scoreSource.completeness) || 0));
                const overall = Math.round(((accuracy + clarity + completeness) / 3) * 10) / 10;
                return {
                    instruction,
                    output,
                    reason,
                    scores: { accuracy, clarity, completeness, overall },
                };
            });

        } catch (error: any) {
            const statusCode = Number(error?.response?.status || 0);
            if (statusCode === 413 && samples.length > 1) {
                const mid = Math.ceil(samples.length / 2);
                const left = await this.evaluateChunk(samples.slice(0, mid), format);
                const right = await this.evaluateChunk(samples.slice(mid), format);
                return [...left, ...right];
            }

            console.error('Eval error for chunk:', error.message);
            return samples.map((sample) => {
                const { instruction, output } = this.toInstructionOutput(sample);
                return {
                    instruction,
                    output,
                    reason: 'Lỗi API: ' + error.message,
                    scores: { overall: 0 },
                };
            });
        }
    }

    /**
     * Đánh giá batch mẫu sử dụng Rate Limit Queue.
     * Accepts both AlpacaFormat[] and OpenAIConversationSample[].
     */
    async evaluateBatch(
        data: EvaluationSample[],
        format?: string
    ): Promise<EvaluationResult> {
        const populationSize = data.length;
        const samples = data;
        // const sampleSize = Math.min(10, populationSize);
        // const samples = data.slice(0, sampleSize);
        //console.log(`[Evaluation] Lấy ${sampleSize} mẫu đầu tiên: population=${populationSize}, samples=${samples.length}`);
        console.log(`[Evaluation] Lấy mẫu để chấm: population=${populationSize}, samples=${samples.length}`);
        const CHUNK_SIZE = 5;
        const results: SampleEvaluation[] = [];
        

        console.log(`[Evaluation] Bắt đầu xử lý batching: ${Math.ceil(samples.length / CHUNK_SIZE)} chunk(s)`);

        for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
            const chunk = samples.slice(i, i + CHUNK_SIZE);
            console.log(`[Evaluation] Đang gọi API chunk ${(i / CHUNK_SIZE) + 1}... (${chunk.length} items)`);

            const chunkResults = await this.evaluateChunk(chunk, format);
            results.push(...chunkResults);

        }

        const evaluated = results.length;
        if (evaluated === 0) {
            return {
                sampleSize: samples.length,
                evaluated: 0,
                totalPopulation: populationSize,
                avgScores: { overall: 0 },
                passRate: 0,
                samples: [],
            };
        }

        const avgOverall = Math.round((results.reduce((s, r) => s + r.scores.overall, 0) / evaluated) * 10) / 10;

        let avgScores: any = { overall: avgOverall };

        if (format === 'openai') {
            avgScores.socratic = Math.round((results.reduce((s, r) => s + (r.scores.socratic || 0), 0) / evaluated) * 10) / 10;
            avgScores.encouragement = Math.round((results.reduce((s, r) => s + (r.scores.encouragement || 0), 0) / evaluated) * 10) / 10;
            avgScores.factuality = Math.round((results.reduce((s, r) => s + (r.scores.factuality || 0), 0) / evaluated) * 10) / 10;
        } else {
            avgScores.accuracy = Math.round((results.reduce((s, r) => s + (r.scores.accuracy || 0), 0) / evaluated) * 10) / 10;
            avgScores.clarity = Math.round((results.reduce((s, r) => s + (r.scores.clarity || 0), 0) / evaluated) * 10) / 10;
            avgScores.completeness = Math.round((results.reduce((s, r) => s + (r.scores.completeness || 0), 0) / evaluated) * 10) / 10;
        }
        const passRate = Math.round((results.filter((r) => r.scores.overall >= 6.0).length / evaluated) * 100);

        return {
            sampleSize: samples.length,
            evaluated,
            totalPopulation: populationSize,
            avgScores,
            passRate,
            samples: results,
        };
    }

    async refineBatch(data: RefinementSample[]): Promise<RefinementResultItem[]> {
        if (!data.length) {
            return [];
        }

        const CHUNK_SIZE = 5;
        const results: RefinementResultItem[] = [];

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            const payload = chunk.map((item, index) => ({
                index,
                assistant: String(item.assistant || ''),
                reason: String(item.reason || ''),
            }));

            const prompt = REFINEMENT_SYSTEM_PROMPT.replace('${samplesJson}', JSON.stringify(payload, null, 2));

            try {
                const rawText = await this.provider.generateContent(prompt);
                const jsonMatch = rawText.match(/\[[\s\S]*\]/);
                const jsonString = jsonMatch ? jsonMatch[0] : rawText;
                const parsed = JSON.parse(jsonString);
                const arr = Array.isArray(parsed) ? parsed : [parsed];

                const mapped = new Map<number, any>();
                arr.forEach((item, idx) => {
                    const itemIndex = Number(item?.index);
                    if (Number.isFinite(itemIndex)) {
                        mapped.set(itemIndex, item);
                    } else {
                        mapped.set(idx, item);
                    }
                });

                chunk.forEach((original, idx) => {
                    const responseItem = mapped.get(idx);
                    const refinedOutput = String(responseItem?.refinedOutput || original.assistant || '').trim();
                    results.push({
                        assistant: original.assistant,
                        refinedOutput,
                    });
                });
            } catch (error) {
                chunk.forEach((original) => {
                    results.push({
                        assistant: original.assistant,
                        refinedOutput: original.assistant,
                    });
                });
            }
            if (i + CHUNK_SIZE < data.length) {
        console.log(`[Evaluation] Đang nghỉ 4 giây để tránh lỗi 429...`);
        await delay(4000);
            }
        }

        return results;
    }
}

// Export a default instance powered by Gemini
export const evaluationService = new EvaluationService(new GeminiProvider());
