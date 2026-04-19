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
    projectName: { type: String, required: true, trim: true },
    version: { type: Number, required: true },
    content: { type: String, required: true },
    description: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  }
);

DatasetPromptSchema.index({ projectName: 1, version: 1 }, { unique: true });

export const DatasetPrompt = mongoose.model<IDatasetPrompt>('DatasetPrompt', DatasetPromptSchema);