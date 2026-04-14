import mongoose, { Schema, Document } from 'mongoose';

interface IEvaluationScore {
  accuracy?: number | null;
  clarity?: number | null;
  completeness?: number | null;
  socratic?: number | null;
  encouragement?: number | null;
  factuality?: number | null;
  overall: number | null;
  reason: string;
}

export interface IEvaluationHistory extends Document {
  fileId: string;
  projectName: string;
  format: string;
  data: Record<string, any>;
  evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
  results: IEvaluationScore;
  createdAt: Date;
  updatedAt?: Date;
}

const EvaluationScoreSchema = new Schema<IEvaluationScore>(
  {
    accuracy: { type: Number, min: 0 },
    clarity: { type: Number, min: 0 },
    completeness: { type: Number, min: 0 },
    socratic: { type: Number, min: 0 },
    encouragement: { type: Number, min: 0 },
    factuality: { type: Number, min: 0 },
    overall: { type: Number },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const EvaluationHistorySchema = new Schema<IEvaluationHistory>(
  {
    fileId: { type: String, required: true, index: true },
    projectName: { type: String, required: true, index: true, trim: true },
    format: { type: String, required: true, enum: ['openai', 'alpaca'] },
    data: { type: Schema.Types.Mixed, required: true },
    evaluatedBy: { type: String, required: true, enum: ['manual', 'gemini', 'openai', 'deepseek', 'none'] },
    results: { type: EvaluationScoreSchema, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const EvaluationHistory = mongoose.model<IEvaluationHistory>(
  'EvaluationHistory',
  EvaluationHistorySchema
);
