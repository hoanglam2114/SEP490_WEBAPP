import axios from 'axios';
import { ILlmProvider } from './ILlmProvider';
import dotenv from 'dotenv';

dotenv.config();

export class DeepseekProvider implements ILlmProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = 'https://api.deepseek.com';

    if (!this.apiKey) {
      console.warn('DEEPSEEK_API_KEY is missing. Evaluation using Deepseek will fail.');
    }
  }

  async generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string> {
    const finalSystemPrompt = systemPrompt || 'You are a strict data formatter. You must return ONLY a raw, valid JSON array. Do NOT wrap the JSON in markdown formatting (like ```json). Do NOT include any explanations, greetings, or conversational text. Just the raw JSON array starting with [ and ending with ].';
    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: modelOverride || 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: finalSystemPrompt
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    return String(content || '[]').trim();
  }
}
