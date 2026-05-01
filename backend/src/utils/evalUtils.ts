export type EvalFormat = 'openai' | 'alpaca';

export function inferFormatFromRow(row: Record<string, any>): EvalFormat {
  if (Array.isArray(row?.messages)) {
    return 'openai';
  }
  return 'alpaca';
}

export function resolveSampleKey(row: Record<string, any>, index: number): string {
  const keyCandidates = [row?.sourceKey, row?.sampleId, row?.blockId, row?.id, row?.conversation_id, row?.uuid];
  for (const candidate of keyCandidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return String(candidate).trim();
    }
  }
  return `sample-${index + 1}`;
}

export function normalizeEvaluationData(format: EvalFormat, rawData: Record<string, any>): Record<string, any> | null {
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  if (format === 'openai') {
    const rawMessages = Array.isArray(rawData.messages) ? rawData.messages : [];

    let messages = rawMessages
      .map((message) => ({
        role: String(message?.role || '').trim(),
        content: String(message?.content || '').trim(),
      }))
      .filter((message) => !!message.role && !!message.content);

    if (!messages.length) {
      const legacyUser = String(rawData.userText ?? rawData.instruction ?? '').trim();
      const legacyAssistant = String(rawData.assistantText ?? rawData.output ?? '').trim();
      messages = [
        legacyUser ? { role: 'user', content: legacyUser } : null,
        legacyAssistant ? { role: 'assistant', content: legacyAssistant } : null,
      ].filter(Boolean) as Array<{ role: string; content: string }>;
    }

    if (!messages.length) {
      return null;
    }

    return {
      messages,
      ...(rawData.cluster !== undefined ? { cluster: rawData.cluster } : {}),
    };
  }

  const instruction = String(rawData.instruction ?? rawData.userText ?? '').trim();
  const input = String(rawData.input ?? '').trim();
  const output = String(rawData.output ?? rawData.assistantText ?? '').trim();

  if (!instruction || !output) {
    return null;
  }

  return {
    instruction,
    input,
    output,
    ...(rawData.cluster !== undefined ? { cluster: rawData.cluster } : {}),
  };
}
