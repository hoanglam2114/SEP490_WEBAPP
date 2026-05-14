import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IDatasetCanonicalLabel extends Document {
  datasetVersionId: Types.ObjectId;
  sampleId: Types.ObjectId;
  targetScope: 'sample' | 'message';
  messageIndex?: number | null;
  messageRole?: 'user' | 'assistant' | null;
  labels: string[];
  targetTextSnapshot?: string;
  sourceType: 'owner_manual_resolution';
  resolutionRef?: Types.ObjectId | null;
  sourceAnnotatorIds: string[];
  publishedBy: Types.ObjectId;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetCanonicalLabelSchema = new Schema<IDatasetCanonicalLabel>(
  {
    datasetVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DatasetVersion',
      required: true,
      index: true,
    },
    sampleId: {
      type: Schema.Types.ObjectId,
      ref: 'ProcessedDatasetItem',
      required: true,
      index: true,
    },
    targetScope: {
      type: String,
      enum: ['sample', 'message'] as const,
      required: true,
      index: true,
    },
    messageIndex: { type: Number, min: 0, default: null },
    messageRole: {
      type: String,
      enum: ['user', 'assistant'] as const,
      default: null,
    },
    labels: { type: [String], default: [] },
    targetTextSnapshot: { type: String, default: '' },
    sourceType: {
      type: String,
      enum: ['owner_manual_resolution'] as const,
      default: 'owner_manual_resolution',
    },
    resolutionRef: {
      type: Schema.Types.ObjectId,
      ref: 'DatasetAssignmentAdjudication',
      default: null,
    },
    sourceAnnotatorIds: { type: [String], default: [] },
    publishedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    publishedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

DatasetCanonicalLabelSchema.index(
  { datasetVersionId: 1, sampleId: 1, targetScope: 1, messageIndex: 1, messageRole: 1 },
  { unique: true }
);

export const DatasetCanonicalLabel = mongoose.model<IDatasetCanonicalLabel>(
  'DatasetCanonicalLabel',
  DatasetCanonicalLabelSchema
);
