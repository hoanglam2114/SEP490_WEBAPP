import { ILlmProvider } from './providers/ILlmProvider';
import { AlpacaFormat } from '../types';
import { ALPACA_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT } from '../constants/prompts';
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
        alignment?: number;
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
        alignment?: number;
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

function isConversationSample(s: EvaluationSample): s is OpenAIConversationSample {
    return Array.isArray((s as OpenAIConversationSample).messages);
}

export class EvaluationService {
    constructor(private provider: ILlmProvider) { }

    /**
     * Helper to delay execution (rate limiting)
     */
    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Format a single OpenAI conversation into a readable text block for the prompt.
     * Renders all turns in order so the model can evaluate the full dialogue.
     */
    private formatConversationText(sample: OpenAIConversationSample, index: number): string {
        const turns = sample.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => {
                const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
                // Strip <think> tags from assistant messages for cleaner display
                const cleanContent = m.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                return `**${roleLabel}:** ${cleanContent}`;
            })
            .join('\n');

        return `=== MẪU ${index + 1} ===\n${turns}\n`;
    }

    /**
     * Đánh giá một chunk (lên đến 20 mẫu).
     * - Khi format = 'openai' và sample có trường messages[], đánh giá toàn bộ cuộc hội thoại.
     * - Khi format = 'alpaca', đánh giá theo cặp instruction/output như cũ.
     */
    async evaluateChunk(samples: EvaluationSample[], format?: string): Promise<SampleEvaluation[]> {
        if (samples.length === 0) return [];

        const isOpenAI = format === 'openai';
        let prompt = '';

        if (isOpenAI) {
            const samplesText = samples.map((s, index) => {
                if (isConversationSample(s)) {
                    // Full conversation evaluation: render all turns
                    return this.formatConversationText(s, index);
                }
                // Fallback: flat pair (should not happen when sending from frontend, but kept for safety)
                return `=== MẪU ${index + 1} ===\n**User:**\n${s.instruction}\n**Input/<think>:**\n${s.input || 'N/A'}\n**Assistant:**\n${s.output}\n`;
            }).join('\n');

            prompt = OPENAI_SYSTEM_PROMPT.replace('${samplesSize}', String(samples.length)).replace('${samplesText}', samplesText);
        } else {
            const samplesText = samples.map((s, index) => {
                const alpaca = s as AlpacaFormat;
                return `=== MẪU ${index + 1} ===\n**Câu hỏi:**\n${alpaca.instruction}\n**Câu trả lời:**\n${alpaca.output}\n`;
            }).join('\n');

            prompt = ALPACA_SYSTEM_PROMPT.replace('${samplesSize}', String(samples.length)).replace('${samplesText}', samplesText);
        }

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

            return samples.map((sample, idx) => {
                const parsed = parsedArray[idx] || {};
                const reason = String(parsed.reason || 'Không có lý do cụ thể');

                // Derive a label for instruction/output fields based on sample type
                let instruction = '';
                let output = '';
                if (isConversationSample(sample)) {
                    const firstUser = sample.messages.find((m) => m.role === 'user');
                    const lastAssistant = [...sample.messages].reverse().find((m) => m.role === 'assistant');
                    instruction = firstUser?.content || '';
                    output = lastAssistant?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '';
                } else {
                    instruction = sample.instruction;
                    output = sample.output;
                }

                if (isOpenAI) {
                    const socratic = Math.min(10, Math.max(0, Number(parsed.socratic) || 0));
                    const alignment = Math.min(10, Math.max(0, Number(parsed.alignment) || 0));
                    const factuality = Math.min(10, Math.max(0, Number(parsed.factuality) || 0));
                    const overall = Math.round(((socratic + alignment + factuality) / 3) * 10) / 10;
                    return {
                        instruction,
                        output,
                        reason,
                        scores: { socratic, alignment, factuality, overall }
                    };
                } else {
                    const accuracy = Math.min(10, Math.max(0, Number(parsed.accuracy) || 0));
                    const clarity = Math.min(10, Math.max(0, Number(parsed.clarity) || 0));
                    const completeness = Math.min(10, Math.max(0, Number(parsed.completeness) || 0));
                    const overall = Math.round(((accuracy + clarity + completeness) / 3) * 10) / 10;
                    return {
                        instruction,
                        output,
                        reason,
                        scores: { accuracy, clarity, completeness, overall }
                    };
                }
            });

        } catch (error: any) {
            console.error('Eval error for chunk:', error.message);
            return samples.map((sample) => {
                let instruction = '';
                let output = '';
                if (isConversationSample(sample)) {
                    const firstUser = sample.messages.find((m) => m.role === 'user');
                    const lastAssistant = [...sample.messages].reverse().find((m) => m.role === 'assistant');
                    instruction = firstUser?.content || '';
                    output = lastAssistant?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '';
                } else {
                    instruction = sample.instruction;
                    output = sample.output;
                }
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
        const sampleSize = Math.min(10, populationSize);
        const samples = data.slice(0, sampleSize);
        console.log(`[Evaluation] Lấy ${sampleSize} mẫu đầu tiên: population=${populationSize}, samples=${samples.length}`);

        const CHUNK_SIZE = 1;
        const DELAY_MS = 6000; // 6 giây delay => tối đa 10 req/phút
        const results: SampleEvaluation[] = [];

        console.log(`[Evaluation] Bắt đầu xử lý Queue: ${Math.ceil(samples.length / CHUNK_SIZE)} chunks`);

        for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
            const chunk = samples.slice(i, i + CHUNK_SIZE);
            console.log(`[Evaluation] Đang gọi API chunk ${(i / CHUNK_SIZE) + 1}... (${chunk.length} items)`);

            const chunkResults = await this.evaluateChunk(chunk, format);
            results.push(...chunkResults);

            if (i + CHUNK_SIZE < samples.length) {
                console.log(`[Evaluation] Đang chờ ${DELAY_MS}ms...`);
                await this.sleep(DELAY_MS);
            }
        }

        const evaluated = results.length;
        const avgOverall = Math.round((results.reduce((s, r) => s + r.scores.overall, 0) / evaluated) * 10) / 10;

        let avgScores: any = { overall: avgOverall };

        if (format === 'openai') {
            avgScores.socratic = Math.round((results.reduce((s, r) => s + (r.scores.socratic || 0), 0) / evaluated) * 10) / 10;
            avgScores.alignment = Math.round((results.reduce((s, r) => s + (r.scores.alignment || 0), 0) / evaluated) * 10) / 10;
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
}

// Export a default instance powered by Gemini
export const evaluationService = new EvaluationService(new GeminiProvider());
