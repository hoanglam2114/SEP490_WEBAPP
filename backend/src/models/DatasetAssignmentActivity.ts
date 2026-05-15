import mongoose, { Document, Schema, Types } from 'mongoose';

export type DatasetAssignmentActivityType = 'assign' | 'unassign';

export interface IDatasetAssignmentActivity extends Document {
  datasetVersionId: Types.ObjectId;
  sampleId: Types.ObjectId;
  annotatorId: Types.ObjectId;
  labelName: string;
  labelType: 'hard' | 'soft';
  targetScope: 'sample' | 'message';
  messageIndex?: number | null;
  messageRole?: 'user' | 'assistant' | null;
  activityType: DatasetAssignmentActivityType;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetAssignmentActivitySchema = new Schema<IDatasetAssignmentActivity>(
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
    annotatorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    labelName: { type: String, required: true, trim: true },
    labelType: {
      type: String,
      enum: ['hard', 'soft'] as const,
      required: true,
    },
    targetScope: {
      type: String,
      enum: ['sample', 'message'] as const,
      required: true,
    },
    messageIndex: { type: Number, min: 0, default: null },
    messageRole: {
      type: String,
      enum: ['user', 'assistant'] as const,
      default: null,
    },
    activityType: {
      type: String,
      enum: ['assign', 'unassign'] as const,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

DatasetAssignmentActivitySchema.index({ datasetVersionId: 1, annotatorId: 1, createdAt: -1 });

export const DatasetAssignmentActivity = mongoose.model<IDatasetAssignmentActivity>(
  'DatasetAssignmentActivity',
  DatasetAssignmentActivitySchema
);
