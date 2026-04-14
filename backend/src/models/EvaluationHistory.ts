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
  evaluatedBy: 'manual' | 'gemini';
  results: IEvaluationScore;
  createdAt: Date;
  updatedAt?: Date;
}

const EvaluationScoreSchema = new Schema<IEvaluationScore>(
  {
    accuracy: { type: Number },
    clarity: { type: Number },
    completeness: { type: Number },
    socratic: { type: Number },
    encouragement: { type: Number },
    factuality: { type: Number },
    overall: { type: Number, required: true },
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
    evaluatedBy: { type: String, required: true, enum: ['manual', 'gemini'] },
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
