export type OutputFormat = 'openai' | 'anthropic' | 'alpaca' | 'sharegpt';
export type FileType = 'chat' | 'lesson';

export interface ConversionOptions {
  format: OutputFormat;
  includeSystemPrompt?: boolean;
  systemPrompt?: string;
  filterByUser?: string;
  filterByConversation?: string;
  startDate?: string;
  endDate?: string;
  removeThinkTags?: boolean;
  maxMessagesPerConversation?: number;
  // Làm sạch dữ liệu
  enableCleaning?: boolean;
  minCharsInstruction?: number;
  maxCharsInstruction?: number;
  minCharsOutput?: number;
  maxCharsOutput?: number;
  minCharsThink?: number;
  maxCharsThink?: number;
  minCharsAssistant?: number;
  maxCharsAssistant?: number;
  removeBoilerplate?: boolean;
  deduplicate?: boolean;
  removeEmptyOutput?: boolean;
  minTurns?: number;
}

export interface FileUploadResult {
  fileId: string;
  filename: string;
  size: number;
  uploadedAt: string;
  fileType: FileType;
  messageCount?: number;
  conversationCount?: number;
  lessonCount?: number;
  exerciseCount?: number;
}

export interface ConversionResult {
  data: any[];
  format: OutputFormat;
  output: string;
  filename: string;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalTokensEstimate: number;
    cleaning?: {
      originalCount: number;
      removedBoilerplate: number;
      removedTooShort: number;
      removedTooLong: number;
      removedDuplicates: number;
      finalCount: number;
    };
  };
}

export interface FileStats extends FileUploadResult {
  uniqueUsers: number;
  avgMessagesPerConversation: string;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

export interface PreviewData {
  preview: Array<{
    conversation_id: string;
    user_id: string;
    message_count: number;
    start_time: string;
    messages: Array<{
      role: string;
      content: string;
      created_at: string;
    }>;
  }>;
  total: number;
  showing: number;
}

export interface SampleEvaluation {
  instruction: string;
  output: string;
  reason: string;
  scores: {
    accuracy?: number;
    clarity?: number;
    completeness?: number;
    socratic?: number;
    alignment?: number;
    factuality?: number;
    overall: number;
  };
}

export interface EvaluationResult {
  sampleSize: number;
  evaluated: number;
  totalPopulation: number;
  avgScores: {
    accuracy?: number;
    clarity?: number;
    completeness?: number;
    socratic?: number;
    alignment?: number;
    factuality?: number;
    overall: number;
  };
  passRate: number;
  samples: SampleEvaluation[];
}
