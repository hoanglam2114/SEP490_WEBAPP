import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProcessedDatasetItem extends Document {
  datasetVersionId: Types.ObjectId;
  sampleId: string;
  sourceSampleId?: Types.ObjectId;
  rootSampleKey?: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

const ProcessedDatasetItemSchema = new Schema<IProcessedDatasetItem>(
  {
    datasetVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DatasetVersion',
      required: true,
      index: true,
    },
    sampleId: { type: String, required: true, trim: true },
    sourceSampleId: {
      type: Schema.Types.ObjectId,
      ref: 'ProcessedDatasetItem',
      index: true,
    },
    rootSampleKey: { type: String, trim: true, index: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  }
);

ProcessedDatasetItemSchema.index({ datasetVersionId: 1, sampleId: 1 }, { unique: true });

export const ProcessedDatasetItem = mongoose.model<IProcessedDatasetItem>('ProcessedDatasetItem', ProcessedDatasetItemSchema);
