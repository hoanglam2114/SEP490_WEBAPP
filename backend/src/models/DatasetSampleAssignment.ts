import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDatasetSampleAssignment extends Document {
  datasetVersionId: Types.ObjectId;
  sampleId: Types.ObjectId;
  assigneeId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  sampleIndex: number;
  createdAt: Date;
  updatedAt?: Date;
}

const DatasetSampleAssignmentSchema = new Schema<IDatasetSampleAssignment>(
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
      unique: true,
      index: true,
    },
    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sampleIndex: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

DatasetSampleAssignmentSchema.index({ datasetVersionId: 1, assigneeId: 1, sampleIndex: 1 });
DatasetSampleAssignmentSchema.index({ datasetVersionId: 1, sampleIndex: 1 });

export const DatasetSampleAssignment = mongoose.model<IDatasetSampleAssignment>(
  'DatasetSampleAssignment',
  DatasetSampleAssignmentSchema
);
