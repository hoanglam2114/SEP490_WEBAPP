import mongoose, { Schema, Document } from 'mongoose';

// Per-conversation result (1 entry = 1 conversation được replay + chấm)
export interface IEvalResult {
  conv_index: number;
  num_turns: number;
  avg_latency_ms: number;
  replay_turns?: {               // ← thêm
    user: string;
    model: string;
    latency_ms: number;
  }[];
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
  confidence?: {
    overall: number;
    by_group: Record<string, number>;
    is_low: boolean;
  };
  human_review?: {
    verdict: 'agree' | 'disagree' | 'skip';
    note?: string;
    reviewer?: string;
    reviewed_at: Date;
  };
}

export interface IEvaluation extends Document {
  ownerId: mongoose.Types.ObjectId;
  modelEvalId: string;
  jobId: string;
  status: string;
  evalMode: 'single' | 'paired';
  ftModelRepo?: string;
  baseModelRepo?: string;
  totalConversations: number;
  validConversations: number;
  results: IEvalResult[];           // FT results
  baseResults?: IEvalResult[];      // Base results (paired only)
  summary: Record<string, any>;     // FT summary
  baseSummary?: Record<string, any>;// Base summary (paired only)
  delta?: Record<string, any>;      // FT - Base delta (paired only)
  gpuResult?: Record<string, any>;
  judgeModel?: string;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  flags?: string[];
  // Dataset & Prompt traceability
  systemPrompt?: string;
  systemPromptVersion?: string;
  datasetVersionId?: string;
  datasetVersionName?: string;
}

const EvaluationResultSchema = new Schema<IEvalResult>(
  {
    conv_index: { type: Number },
    num_turns: { type: Number },
    avg_latency_ms: { type: Number },
    replay_turns: { type: Schema.Types.Mixed, default: [] },
    criteria_scores: { type: Schema.Types.Mixed, default: {} },
    criteria_reasons: { type: Schema.Types.Mixed, default: {} },
    group_scores: { type: Schema.Types.Mixed, default: {} },
    non_scoring: { type: Schema.Types.Mixed, default: {} },
    human_review: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const EvaluationSchema = new Schema<IEvaluation>(
  {
    ownerId:           { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    modelEvalId:       { type: String, required: true, unique: true, index: true },
    jobId:             { type: String, required: true, index: true },
    status:            { type: String, required: true },
    evalMode:          { type: String, enum: ['single', 'paired'], default: 'single' },
    ftModelRepo:       { type: String },
    baseModelRepo:     { type: String },
    totalConversations:{ type: Number, default: 0 },
    validConversations:{ type: Number, default: 0 },
    results:           { type: [EvaluationResultSchema], default: [] },
    baseResults:       { type: [EvaluationResultSchema], default: [] },
    summary:           { type: Schema.Types.Mixed, default: {} },
    baseSummary:       { type: Schema.Types.Mixed, default: null },
    delta:             { type: Schema.Types.Mixed, default: null },
    gpuResult:         { type: Schema.Types.Mixed, default: {} },
    startedAt:         { type: Date, required: true },
    completedAt:       { type: Date, required: true },
    judgeModel:        { type: String, default: 'claude-sonnet-4-5-20251001' },
    flags:             { type: [String], default: [] },
    // Dataset & Prompt traceability
    systemPrompt:       { type: String, default: '' },
    systemPromptVersion:{ type: String, default: '' },
    datasetVersionId:   { type: String, default: '' },
    datasetVersionName: { type: String, default: '' },
  },
  { timestamps: true }
);

export const ModelEvaluation = mongoose.model<IEvaluation>('ModelEvaluation', EvaluationSchema);