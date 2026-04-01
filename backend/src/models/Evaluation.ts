import mongoose, { Schema, Document } from 'mongoose';

export interface IEvalResult {
  subject: string;
  instruction: string;
  expected: string;
  base_answer: string;
  ft_answer: string;
  base_score: number;
  ft_score: number;
  delta: number;
  eval_method: string;
  criteria_detail?: {
    name: string;
    base_score: number;
    ft_score: number;
    base_reason?: string;
    ft_reason?: string;
  }[];
}

export interface ISubjectSummary {
  base_avg: number;
  ft_avg: number;
  improvement_pct: number;
}

export interface IEvaluation extends Document {
  modelEvalId: string;
  jobId: string;
  status: string; // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalSamples: number;
  subjectBreakdown: Record<string, number>;
  skippedBySimilarity: number;
  results: IEvalResult[];
  summary: {
    overall: { base_avg: number; ft_avg: number; improvement_pct: number; delta?: number };
    quality?: { base_avg: number; ft_avg: number; weight: number };
    hallucination?: { base_avg: number; ft_avg: number; weight: number; sample_count: number };
    speed?: { base_avg_ms: number; ft_avg_ms: number; base_score: number; ft_score: number; weight: number };
    by_subject: Record<string, ISubjectSummary>;
    max_possible: number;
    reference_metrics?: {
      bleu: { base: number; ft: number };
      rouge_l: { base: number; ft: number };
    };
  };
  judgeModel?: string;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EvaluationResultSchema = new Schema<IEvalResult>(
  {
    subject: { type: String, required: true },
    instruction: { type: String, required: true },
    expected: { type: String, required: true },
    base_answer: { type: String, required: true },
    ft_answer: { type: String, required: true },
    base_score: { type: Number, required: true },
    ft_score: { type: Number, required: true },
    delta: { type: Number, required: true },
    eval_method: { type: String, required: true },
    criteria_detail: [
      {
        name: { type: String, required: true },
        base_score: { type: Number, required: true },
        ft_score: { type: Number, required: true },
        base_reason: { type: String },
        ft_reason: { type: String },
      },
    ],
  },
  { _id: false }
);

const SubjectSummarySchema = new Schema<ISubjectSummary>(
  {
    base_avg: { type: Number, required: true },
    ft_avg: { type: Number, required: true },
    improvement_pct: { type: Number, required: true },
  },
  { _id: false }
);

const EvaluationSchema = new Schema<IEvaluation>(
  {
    modelEvalId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    totalSamples: { type: Number, default: 0 },
    subjectBreakdown: { type: Map, of: Number, default: {} },
    skippedBySimilarity: { type: Number, default: 0 },
    results: [EvaluationResultSchema],
    summary: {
      overall: {
        base_avg: { type: Number, required: true },
        ft_avg: { type: Number, required: true },
        improvement_pct: { type: Number, required: true },
        delta: { type: Number },
      },
      quality: {
        base_avg: { type: Number },
        ft_avg: { type: Number },
        weight: { type: Number },
      },
      hallucination: {
        base_avg: { type: Number },
        ft_avg: { type: Number },
        weight: { type: Number },
        sample_count: { type: Number },
      },
      speed: {
        base_avg_ms: { type: Number },
        ft_avg_ms: { type: Number },
        base_score: { type: Number },
        ft_score: { type: Number },
        weight: { type: Number },
      },
      by_subject: { type: Map, of: SubjectSummarySchema, default: {} },
      max_possible: { type: Number, default: 5 },
      reference_metrics: {
        bleu: { base: { type: Number }, ft: { type: Number } },
        rouge_l: { base: { type: Number }, ft: { type: Number } },
      },
    },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    judgeModel: { type: String, default: 'claude-haiku-4-5-20251001' },
  },
  {
    timestamps: true,
  }
);

export const ModelEvaluation = mongoose.model<IEvaluation>('ModelEvaluation', EvaluationSchema);