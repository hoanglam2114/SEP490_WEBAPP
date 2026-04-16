import axios from 'axios';
import { ILlmProvider } from './ILlmProvider';
import dotenv from 'dotenv';

dotenv.config();

export class OpenRouterProvider implements ILlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    // Use model from env or leave empty (no hardcoded fallback)
    this.model = process.env.OPENROUTER_MODEL || '';
    this.baseUrl = 'https://openrouter.ai/api/v1';

    if (!this.apiKey) {
      console.warn('OPENROUTER_API_KEY is missing. OpenRouter provider will not work.');
    }
  }

  async generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is missing.');
    }

    const targetModel = (modelOverride || this.model).trim();
    if (!targetModel) {
      throw new Error('OpenRouter: Vui lòng nhập Model ID (Ví dụ: openai/gpt-4o-mini).');
    }

    try {
      const finalModel = targetModel;
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: finalModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt || 'You are a helpful assistant.'
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
            'HTTP-Referer': 'https://github.com/OpenRouterTeam/openrouter-runner', // Optional, for OpenRouter rankings
            'X-Title': 'SEP490 WebApp', // Optional, for OpenRouter rankings
          },
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      return String(content || '[]').trim();
    } catch (error: any) {
      const errorData = error.response?.data?.error;
      const status = error.response?.status;
      
      console.error('OpenRouter Provider Error:', errorData || error.message);
      
      if (status === 402) {
        throw new Error('OpenRouter: Tài khoản của bạn không đủ số dư để dùng model trả phí này. Hãy dùng model :free');
      }
      if (status === 429) {
        const rawMsg = errorData?.metadata?.raw || '';
        if (rawMsg.includes('rate-limited')) {
          throw new Error('OpenRouter: Model này đang bị quá tải (Rate Limit). Vui lòng đợi 1 phút hoặc đổi sang model khác.');
        }
        throw new Error('OpenRouter: Bạn đang gửi quá nhiều yêu cầu. Vui lòng chậm lại một chút.');
      }
      if (status === 404) {
        throw new Error(`OpenRouter: Không tìm thấy model '${modelOverride || this.model}'. Hãy kiểm tra lại ID.`);
      }
      if (status >= 500) {
        throw new Error('OpenRouter: Lỗi máy chủ (500). Model này đang quá tải hoặc gặp sự cố, hãy thử lại hoặc đổi sang model khác.');
      }
      
      throw new Error(`OpenRouter API error: ${errorData?.message || error.message}`);
    }
  }
}
