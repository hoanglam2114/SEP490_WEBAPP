import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IDatasetAssignmentAdjudication extends Document {
  datasetVersionId: Types.ObjectId;
  sampleId: Types.ObjectId;
  targetScope: 'sample' | 'message';
  messageIndex?: number | null;
  messageRole?: 'user' | 'assistant' | null;
  status: 'pending' | 'resolved';
  threshold: number;
  agreementScore?: number | null;
  majorityLabels: string[];
  labelCounts: Array<{ name: string; count: number }>;
  annotatorSets: Array<{ annotatorId: string; labels: string[] }>;
  finalLabels: string[];
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetAssignmentAdjudicationSchema = new Schema<IDatasetAssignmentAdjudication>(
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
    status: {
      type: String,
      enum: ['pending', 'resolved'] as const,
      default: 'pending',
      index: true,
    },
    threshold: { type: Number, default: 0.6 },
    agreementScore: { type: Number, default: null },
    majorityLabels: { type: [String], default: [] },
    labelCounts: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            count: { type: Number, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    annotatorSets: {
      type: [
        new Schema(
          {
            annotatorId: { type: String, required: true },
            labels: { type: [String], default: [] },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    finalLabels: { type: [String], default: [] },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

DatasetAssignmentAdjudicationSchema.index(
  { datasetVersionId: 1, sampleId: 1, targetScope: 1, messageIndex: 1, messageRole: 1 },
  { unique: true }
);

export const DatasetAssignmentAdjudication = mongoose.model<IDatasetAssignmentAdjudication>(
  'DatasetAssignmentAdjudication',
  DatasetAssignmentAdjudicationSchema
);
