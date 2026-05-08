import axios from 'axios';
import { ILlmProvider } from './ILlmProvider';
import dotenv from 'dotenv';

dotenv.config();

export class OpenAIProvider implements ILlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.apiKey = this.resolveApiKey();

    if (!this.apiKey) {
      throw new Error(this.buildMissingKeyMessage());
    }
  }

  private resolveApiKey(): string {
    const normalizedBaseUrl = this.baseUrl.toLowerCase();

    if (normalizedBaseUrl.includes('api.groq.com')) {
      return process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
    }

    if (normalizedBaseUrl.includes('openrouter.ai')) {
      return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
    }

    return process.env.OPENAI_API_KEY || '';
  }

  private buildMissingKeyMessage(): string {
    const normalizedBaseUrl = this.baseUrl.toLowerCase();

    if (normalizedBaseUrl.includes('api.groq.com')) {
      return 'Missing API key for Groq-compatible OpenAI endpoint. Set GROQ_API_KEY or OPENAI_API_KEY.';
    }

    if (normalizedBaseUrl.includes('openrouter.ai')) {
      return 'Missing API key for OpenRouter-compatible OpenAI endpoint. Set OPENROUTER_API_KEY or OPENAI_API_KEY.';
    }

    return 'OPENAI_API_KEY is missing.';
  }

  async generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string> {
    const finalSystemPrompt = systemPrompt || 'You are a strict data formatter. You must return ONLY a raw, valid JSON array. Do NOT wrap the JSON in markdown formatting (like ```json). Do NOT include any explanations, greetings, or conversational text. Just the raw JSON array starting with [ and ending with ].';
    try {
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
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText || 'Unknown error';
        const responseMessage =
          typeof error.response?.data?.error?.message === 'string'
            ? error.response.data.error.message
            : typeof error.response?.data?.message === 'string'
              ? error.response.data.message
              : '';

        const providerHint = this.baseUrl.toLowerCase().includes('api.groq.com')
          ? 'Current OPENAI_BASE_URL points to Groq. Use a Groq key in GROQ_API_KEY or OPENAI_API_KEY.'
          : this.baseUrl.toLowerCase().includes('openrouter.ai')
            ? 'Current OPENAI_BASE_URL points to OpenRouter. Use an OpenRouter key in OPENROUTER_API_KEY or OPENAI_API_KEY.'
            : 'Current OPENAI_BASE_URL points to OpenAI. Use a valid OPENAI_API_KEY.';

        throw new Error(
          `OpenAI-compatible request failed (${status || 'no-status'} ${statusText}). ${responseMessage} ${status === 401 ? providerHint : ''}`.trim()
        );
      }

      throw error;
    }
  }
}
