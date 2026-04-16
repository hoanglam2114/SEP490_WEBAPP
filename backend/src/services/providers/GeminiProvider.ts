import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { ILlmProvider } from './ILlmProvider';
import dotenv from 'dotenv';
dotenv.config();

export class GeminiProvider implements ILlmProvider {
    private model: GenerativeModel;

    constructor() {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        this.model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384,
                responseMimeType: "application/json",
            }
        });
    }

    async generateContent(prompt: string, _modelOverride?: string): Promise<string> {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text()?.trim() || '[]';
    }
}
