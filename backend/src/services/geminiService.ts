import { GoogleGenerativeAI } from '@google/generative-ai';
import { AlpacaFormat } from '../types';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
    }
});

export interface SampleEvaluation {
    instruction: string;
    output: string;
    scores: {
        accuracy: number;    // Chính xác (0–10)
        clarity: number;     // Rõ ràng (0–10)
        completeness: number; // Đủ ý (0–10)
        overall: number;     // Trung bình
    };
}

export interface EvaluationResult {
    sampleSize: number;
    evaluated: number;
    avgScores: {
        accuracy: number;
        clarity: number;
        completeness: number;
        overall: number;
    };
    passRate: number; // % mẫu đạt >= 6/10
    totalPopulation: number;
    samples: SampleEvaluation[];
}

export class GeminiService {
    /**
     * Tính toán số lượng mẫu theo công thức Cochran (95% confidence, 10% margin of error)
     */
    calculateSampleSize(populationSize: number): number {
        if (populationSize <= 0) return 0;

        // n0 = (Z^2 * p * (1-p)) / e^2
        // Với Z = 1.96 (95% confidence), p = 0.5, e = 0.05 (5% margin)
        // n0 = (1.96^2 * 0.5 * 0.5) / 0.05^2 = 3.8416 * 0.25 / 0.0025 = 384.16
        const n0 = 384.16;

        // n = n0 / (1 + (n0 - 1) / N)
        const n = n0 / (1 + (n0 - 1) / populationSize);

        return Math.ceil(n);
    }

    /**
     * Helper to delay execution (rate limiting)
     */
    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Đánh giá một chunk (lên đến 20 mẫu) bằng Gemini API
     */
    async evaluateChunk(samples: AlpacaFormat[]): Promise<SampleEvaluation[]> {
        if (samples.length === 0) return [];

        const samplesText = samples.map((s, index) =>
            `=== MẪU ${index + 1} ===\n**Câu hỏi:**\n${s.instruction}\n**Câu trả lời:**\n${s.output}\n`
        ).join('\n');

        const prompt = `Bạn là chuyên gia đánh giá chất lượng dữ liệu huấn luyện AI.

Dưới đây là ${samples.length} mẫu dữ liệu. Hãy đánh giá từng mẫu theo 3 tiêu chí (thang điểm 0–10).
1. **Chính xác** (accuracy): Câu trả lời có đúng về mặt nội dung không?
2. **Rõ ràng** (clarity): Câu trả lời có dễ hiểu, văn phong rõ ràng không?
3. **Đủ ý** (completeness): Câu trả lời có bao phủ đầy đủ nội dung câu hỏi không?

DỮ LIỆU CẦN ĐÁNH GIÁ:
${samplesText}

Trích xuất kết quả dưới dạng một mảng JSON (chứa đúng ${samples.length} object tương ứng với thứ tự mẫu). CHỈ trả về JSON thuần hợp lệ (không kèm text khác):
[
  {
    "accuracy": <số từ 0–10>,
    "clarity": <số từ 0–10>,
    "completeness": <số từ 0–10>
  },
  ...
]`;

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const rawText = response.text()?.trim() || '[]';

            // Gemini trong chế độ application/json thường trả về JSON sạch.
            // Nếu có lỗi, cố gắng tìm phần mảng [ ... ]
            let jsonString = rawText;
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }
            
            let parsedArray: any[];
            try {
                parsedArray = JSON.parse(jsonString);
                if (!Array.isArray(parsedArray)) {
                    // Nếu là object đơn lẻ, bọc lại
                    parsedArray = [parsedArray];
                }
            } catch (e) {
                console.error('JSON parsing failed. Raw text snippet:', jsonString.substring(0, 100));
                parsedArray = [];
            }

            return samples.map((sample, idx) => {
                const parsed = parsedArray[idx] || { accuracy: 0, clarity: 0, completeness: 0 };

                const accuracy = Math.min(10, Math.max(0, Number(parsed.accuracy) || 0));
                const clarity = Math.min(10, Math.max(0, Number(parsed.clarity) || 0));
                const completeness = Math.min(10, Math.max(0, Number(parsed.completeness) || 0));
                const overall = Math.round(((accuracy + clarity + completeness) / 3) * 10) / 10;

                return {
                    instruction: sample.instruction,
                    output: sample.output,
                    scores: { accuracy, clarity, completeness, overall },
                };
            });

        } catch (error: any) {
            console.error('Gemini eval error for chunk:', error.message);
            return samples.map((sample) => ({
                instruction: sample.instruction,
                output: sample.output,
                scores: { accuracy: 0, clarity: 0, completeness: 0, overall: 0 },
            }));
        }
    }

    /**
     * Đánh giá batch mẫu sử dụng Rate Limit Queue
     */
    async evaluateBatch(
        data: AlpacaFormat[]
    ): Promise<EvaluationResult> {
        const populationSize = data.length;
        const sampleSize = this.calculateSampleSize(populationSize);

        console.log(`[Evaluation] Lấy mẫu thống kê: population=${populationSize}, calculated_sample=${sampleSize}`);

        // Lấy mẫu ngẫu nhiên
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        const samples = shuffled.slice(0, Math.min(sampleSize, populationSize));

        const CHUNK_SIZE = 50;
        const DELAY_MS = 10000; // 10 giây delay => tối đa 6 req/phút
        const results: SampleEvaluation[] = [];

        console.log(`[Evaluation] Bắt đầu xử lý Queue: ${Math.ceil(samples.length / CHUNK_SIZE)} chunks`);

        for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
            const chunk = samples.slice(i, i + CHUNK_SIZE);
            console.log(`[Evaluation] Đang gọi API chunk ${(i / CHUNK_SIZE) + 1}... (${chunk.length} items)`);

            const chunkResults = await this.evaluateChunk(chunk);
            results.push(...chunkResults);

            // Nếu chưa phải chunk cuối cùng, sleep để tránh rate limit
            if (i + CHUNK_SIZE < samples.length) {
                console.log(`[Evaluation] Đang chờ ${DELAY_MS}ms...`);
                await this.sleep(DELAY_MS);
            }
        }

        // Tính điểm trung bình
        const evaluated = results.length;
        const avgAccuracy =
            Math.round((results.reduce((s, r) => s + r.scores.accuracy, 0) / evaluated) * 10) / 10;
        const avgClarity =
            Math.round((results.reduce((s, r) => s + r.scores.clarity, 0) / evaluated) * 10) / 10;
        const avgCompleteness =
            Math.round((results.reduce((s, r) => s + r.scores.completeness, 0) / evaluated) * 10) / 10;
        const avgOverall =
            Math.round(((avgAccuracy + avgClarity + avgCompleteness) / 3) * 10) / 10;
        const passRate = Math.round((results.filter((r) => r.scores.overall >= 6.0).length / evaluated) * 100);

        return {
            sampleSize: sampleSize,
            evaluated,
            totalPopulation: populationSize,
            avgScores: {
                accuracy: avgAccuracy,
                clarity: avgClarity,
                completeness: avgCompleteness,
                overall: avgOverall,
            },
            passRate,
            samples: results,
        };
    }
}
