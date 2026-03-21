import mongoose, { Schema, Document } from 'mongoose';

interface IEvaluationScore {
  accuracy?: number;
  clarity?: number;
  completeness?: number;
  socratic?: number;
  alignment?: number;
  factuality?: number;
  overall: number;
}

interface IEvaluationItem {
  rowId: string;
  groupId?: number;
  instruction: string;
  output: string;
  reason: string;
  scores: IEvaluationScore;
}

export interface IEvaluationHistory extends Document {
  fileId: string;
  format: string;
  dataGroup: string;
  results: IEvaluationItem[];
  avgScores: IEvaluationScore;
  createdAt: Date;
  updatedAt: Date;
}

const EvaluationScoreSchema = new Schema<IEvaluationScore>(
  {
    accuracy: { type: Number },
    clarity: { type: Number },
    completeness: { type: Number },
    socratic: { type: Number },
    alignment: { type: Number },
    factuality: { type: Number },
    overall: { type: Number, required: true },
  },
  { _id: false }
);

const EvaluationItemSchema = new Schema<IEvaluationItem>(
  {
    rowId: { type: String, required: true },
    groupId: { type: Number },
    instruction: { type: String, required: true },
    output: { type: String, required: true },
    reason: { type: String, default: '' },
    scores: { type: EvaluationScoreSchema, required: true },
  },
  { _id: false }
);

const EvaluationHistorySchema = new Schema<IEvaluationHistory>(
  {
    fileId: { type: String, required: true, index: true },
    format: { type: String, required: true },
    dataGroup: { type: String, required: true, default: 'all' },
    results: { type: [EvaluationItemSchema], default: [] },
    avgScores: { type: EvaluationScoreSchema, required: true },
  },
  { timestamps: true }
);

export const EvaluationHistory = mongoose.model<IEvaluationHistory>(
  'EvaluationHistory',
  EvaluationHistorySchema
);
