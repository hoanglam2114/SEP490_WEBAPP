export interface ILlmProvider {
    generateContent(prompt: string): Promise<string>;
}
