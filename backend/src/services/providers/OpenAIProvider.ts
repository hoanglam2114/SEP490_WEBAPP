import axios from 'axios';
import { ILlmProvider } from './ILlmProvider';
import dotenv from 'dotenv';

dotenv.config();

export class OpenAIProvider implements ILlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is missing.');
    }
  }

  async generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string> {
    const finalSystemPrompt = systemPrompt || 'You are a strict data formatter. You must return ONLY a raw, valid JSON array. Do NOT wrap the JSON in markdown formatting (like ```json). Do NOT include any explanations, greetings, or conversational text. Just the raw JSON array starting with [ and ending with ].';
    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: modelOverride || this.model,
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
        max_tokens: 8192,
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