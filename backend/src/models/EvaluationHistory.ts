import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEvaluationScore {
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
  sampleId: Types.ObjectId;
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
    sampleId: {
      type: Schema.Types.ObjectId,
      ref: 'ProcessedDatasetItem',
      required: true,
      index: true,
    },
    evaluatedBy: { type: String, required: true, enum: ['manual', 'gemini', 'openai', 'deepseek', 'none'] },
    results: { type: EvaluationScoreSchema, required: true },
  },
  {
    timestamps: true,
  }
);

export const EvaluationHistory = mongoose.model<IEvaluationHistory>('EvaluationHistory', EvaluationHistorySchema);
