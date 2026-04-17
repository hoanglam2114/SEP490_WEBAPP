export interface ILlmProvider {
    generateContent(prompt: string, modelOverride?: string, systemPrompt?: string): Promise<string>;
}
