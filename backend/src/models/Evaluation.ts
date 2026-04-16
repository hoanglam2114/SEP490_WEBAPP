import mongoose, { Schema, Document } from 'mongoose';

// Per-conversation result (1 entry = 1 conversation được replay + chấm)
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

export interface IEvaluation extends Document {
  modelEvalId: string;
  jobId: string;
  status: string;
  totalConversations: number;
  validConversations: number;
  results: IEvalResult[];
  summary: Record<string, any>;
  gpuResult?: Record<string, any>;
  judgeModel?: string;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EvaluationResultSchema = new Schema<IEvalResult>(
  {
    conv_index: { type: Number },
    num_turns: { type: Number },
    avg_latency_ms: { type: Number },
    criteria_scores: { type: Schema.Types.Mixed, default: {} },
    criteria_reasons: { type: Schema.Types.Mixed, default: {} },
    group_scores: { type: Schema.Types.Mixed, default: {} },
    non_scoring: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const EvaluationSchema = new Schema<IEvaluation>(
  {
    modelEvalId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    totalConversations: { type: Number, default: 0 },
    validConversations: { type: Number, default: 0 },
    results: { type: [EvaluationResultSchema], default: [] },
    summary: { type: Schema.Types.Mixed, default: {} },
    gpuResult: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    judgeModel: { type: String, default: 'claude-sonnet-4-5-20251001' },
  },
  { timestamps: true }
);

export const ModelEvaluation = mongoose.model<IEvaluation>('ModelEvaluation', EvaluationSchema);