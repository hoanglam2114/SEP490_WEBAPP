import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetVersion extends Document {
  projectName: string;
  versionName: string;
  similarityThreshold: number;
  totalSamples: number;
  createdAt: Date;
  updatedAt?: Date;
}

const DatasetVersionSchema = new Schema<IDatasetVersion>(
  {
    projectName: { type: String, required: true, index: true, trim: true },
    versionName: { type: String, required: true, trim: true },
    similarityThreshold: { type: Number, required: true, min: 0, max: 1 },
    totalSamples: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
  }
);

DatasetVersionSchema.index({ projectName: 1, createdAt: -1 });

export const DatasetVersion = mongoose.model<IDatasetVersion>('DatasetVersion', DatasetVersionSchema);
