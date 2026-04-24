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
  removeUnclosedThink?: boolean;
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
      removedUnclosedThink?: number;
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
    encouragement?: number;
    factuality?: number;
    overall: number;
  };
}

// New evaluation types matching backend schema
export interface IEvalResult {
  conv_index: number;
  num_turns: number;
  avg_latency_ms: number;
  criteria_scores: {
    A1: number; A2: number; A3: number;
    B1: number; B2: number;
    C1: number; C2: number; C3: number;
    D1: number; D2: number;
  };
  criteria_reasons: Record<string, string>;
  group_scores: {
    group_a: number;
    group_b: number;
    group_c: number;
    group_d: number;
    overall: number;
    a1_hard_constraint_triggered: boolean;
  };
  non_scoring: {
    bleu: number;
    rouge_l: number;
    question_detection_rate: number;
  };
}

export interface ModelEvalItem {
  jobId: string;
  projectName: string;
  baseModel: string;
  completedAt: string;
  trainingDuration: number;
  modelEvalId: string | null;
  evalId?: string | null;
  pinnedEvalId: string | null;
  judgeModel: string | null;
  totalConversations: number;
  scores: {
    overall: number | null;
    group_a: number | null;
    group_b: number | null;
    group_c: number | null;
    group_d: number | null;
    criteria: Record<string, any> | null;
    avg_latency_ms: number | null;
    non_scoring: Record<string, any> | null;
  };
}

export interface EvaluationData {
  modelEvalId: string;
  jobId: string;
  projectName?: string;
  isPinned?: boolean;
  status: string;
  totalConversations: number;
  validConversations: number;
  results: IEvalResult[];
  judgeModel?: string;
  summary: Record<string, any>;
  startedAt: string;
  completedAt: string;
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
    encouragement?: number;
    factuality?: number;
    overall: number;
  };
  passRate: number;
  samples: SampleEvaluation[];
}
