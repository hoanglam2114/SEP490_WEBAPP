import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetVersion extends Document {
  ownerId: mongoose.Types.ObjectId;
  projectName: string;
  isPublic?: boolean;
  versionName: string;
  promptId?: mongoose.Types.ObjectId;
  promptContentSnapshot?: string;
  similarityThreshold: number;
  totalSamples: number;
  createdAt: Date;
  updatedAt?: Date;
}

const DatasetVersionSchema = new Schema<IDatasetVersion>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectName: { type: String, required: true, index: true, trim: true },
    isPublic: { type: Boolean, default: false, index: true },
    versionName: { type: String, required: true, trim: true },
    promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'DatasetPrompt' },
    promptContentSnapshot: { type: String },
    similarityThreshold: { type: Number, required: true, min: 0, max: 1 },
    totalSamples: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
  }
);

DatasetVersionSchema.index({ projectName: 1, createdAt: -1 });

export const DatasetVersion = mongoose.model<IDatasetVersion>('DatasetVersion', DatasetVersionSchema);
