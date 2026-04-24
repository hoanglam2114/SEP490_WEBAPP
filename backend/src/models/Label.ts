import mongoose, { Schema, Document, Types } from 'mongoose';

export type LabelType = 'hard' | 'soft';

export interface ILabel extends Document {
  sampleId: Types.ObjectId;
  name: string;
  type: LabelType;
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

export const Label = mongoose.model<ILabel>('Label', LabelSchema);
