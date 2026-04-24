export interface MongoDBMessage {
  _id: {
    $oid: string;
  };
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  agent_id: string | null;
  correlation_id: string | null;
  mem0_ids: string[];
  metadata: Record<string, any>;
  created_at: {
    $date: string;
  };
}

export interface Conversation {
  conversation_id: string;
  messages: MongoDBMessage[];
  user_id: string;
  start_time: Date;
  end_time: Date;
  message_count: number;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIFormat {
  messages: OpenAIMessage[];
}

export interface AnthropicFormat {
  prompt: string;
  completion: string;
}

export interface AlpacaFormat {
  instruction: string;
  input: string;
  output: string;
}

export interface ShareGPTMessage {
  from: 'human' | 'gpt' | 'system';
  value: string;
}

export interface ShareGPTFormat {
  conversations: ShareGPTMessage[];
}

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
  // Dữ liệu làm sạch
  enableCleaning?: boolean;
  minCharsInstruction?: number;  // Mặc định: 10
  maxCharsInstruction?: number;  // Mặc định: 2000
  minCharsOutput?: number;       // Mặc định: 5
  maxCharsOutput?: number;       // Mặc định: 4000
  minCharsThink?: number;        // Mặc định: 10
  maxCharsThink?: number;        // Mặc định: 2000
  minCharsAssistant?: number;    // Mặc định: 5
  maxCharsAssistant?: number;    // Mặc định: 4000
  removeBoilerplate?: boolean;   // Xóa các câu trả lời mẫu của AI
  deduplicate?: boolean;         // Xóa các bản ghi trùng lặp
  removeUnclosedThink?: boolean; // Lọc những mẫu có <think> mà không có thẻ đóng </think>
  minTurns?: number;             // Số cặp hỏi đáp tối thiểu (QA pairs)
}

export interface DataCleaningStats {
  originalCount: number;
  removedBoilerplate: number;
  removedTooShort: number;
  removedTooLong: number;
  removedDuplicates: number;
  removedUnclosedThink?: number;
  finalCount: number;
}

export interface ConversionResult {
  data: any[];
  format: OutputFormat;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalTokensEstimate: number;
    cleaning?: DataCleaningStats;
  };
}

export interface FileUploadResult {
  fileId: string;
  filename: string;
  size: number;
  uploadedAt: Date;
  fileType: FileType;
  messageCount?: number;
  conversationCount?: number;
  lessonCount?: number;
  exerciseCount?: number;
}