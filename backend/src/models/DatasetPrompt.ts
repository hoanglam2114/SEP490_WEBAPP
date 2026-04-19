import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetPrompt extends Document {
  projectName: string;
  version: number;
  content: string;
  description?: string;
  createdAt: Date;
}

const DatasetPromptSchema = new Schema<IDatasetPrompt>(
  {
    projectName: { type: String, required: true, index: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    content: { type: String, required: true },
    description: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

DatasetPromptSchema.index({ projectName: 1, version: 1 }, { unique: true });
DatasetPromptSchema.index({ projectName: 1, createdAt: -1 });

export const DatasetPrompt = mongoose.model<IDatasetPrompt>('DatasetPrompt', DatasetPromptSchema);