import { ILlmProvider } from './ILlmProvider';
const fetch = async (url: any, init?: any) => {
  const module = await import('node-fetch');
  return module.default(url, init);
};
import dotenv from 'dotenv';
dotenv.config();

export class OpenRouterProvider implements ILlmProvider {
    private apiKey: string;

    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY || '';
    }

    async generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string> {
        // Fallback to a sensible default if no model is provided
        const model = modelOverride || 'google/gemini-2.0-flash-001';
        
        const messages: any[] = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000', // Optional, for OpenRouter rankings
                'X-Title': 'SEP490 Web App'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errorData: any = await response.json().catch(() => ({}));
            throw new Error(`OpenRouter Error: ${response.statusText} ${JSON.stringify(errorData)}`);
        }

        const data: any = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }
}
