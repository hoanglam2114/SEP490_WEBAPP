import mongoose, { Schema, Document } from 'mongoose';

interface IEvaluationScore {
  accuracy?: number;
  clarity?: number;
  completeness?: number;
  socratic?: number;
  encouragement?: number;
  factuality?: number;
  overall: number;
  reason: string;
}

export interface IEvaluationHistory extends Document {
  fileId: string;
  projectName: string;
  format: string;
  data: Record<string, any>;
  evaluatedBy: 'manual' | 'gemini' | 'openai' | 'none';
  results: IEvaluationScore;
  createdAt: Date;
  updatedAt?: Date;
}

const EvaluationScoreSchema = new Schema<IEvaluationScore>(
  {
    accuracy: { type: Number, min: -1 },
    clarity: { type: Number, min: -1 },
    completeness: { type: Number, min: -1 },
    socratic: { type: Number, min: -1 },
    encouragement: { type: Number, min: -1 },
    factuality: { type: Number, min: -1 },
    overall: { type: Number, required: true, min: -1 },
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
    evaluatedBy: { type: String, required: true, enum: ['manual', 'gemini', 'openai', 'none'] },
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
