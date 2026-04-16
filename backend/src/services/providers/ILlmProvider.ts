export interface ILlmProvider {
    generateContent(prompt: string, modelOverride?: string): Promise<string>;
}
