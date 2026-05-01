import mongoose, { Schema, Document, Types } from 'mongoose';

export type LabelType = 'hard' | 'soft';
export type LabelTargetScope = 'sample' | 'message';
export type LabelMessageRole = 'user' | 'assistant';

export interface ILabel extends Document {
  sampleId: Types.ObjectId;
  name: string;
  type: LabelType;
  targetScope: LabelTargetScope;
  messageIndex?: number;
  messageRole?: LabelMessageRole;
  targetTextSnapshot?: string;
  createdBy: Types.ObjectId;
  upvotes: Types.ObjectId[];
  downvotes: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema<ILabel>(
  {
    sampleId: {
      type: Schema.Types.ObjectId,
      ref: 'ProcessedDatasetItem',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['hard', 'soft'] as const,
      required: true,
    },
    targetScope: {
      type: String,
      enum: ['sample', 'message'] as const,
      default: 'sample',
      index: true,
    },
    messageIndex: { type: Number, min: 0 },
    messageRole: {
      type: String,
      enum: ['user', 'assistant'] as const,
    },
    targetTextSnapshot: { type: String },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    upvotes: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    downvotes: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

LabelSchema.index({ sampleId: 1, targetScope: 1, messageIndex: 1, createdAt: -1 });

export const Label = mongoose.model<ILabel>('Label', LabelSchema);
