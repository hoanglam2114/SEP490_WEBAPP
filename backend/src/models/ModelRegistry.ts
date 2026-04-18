import mongoose, { Schema, Document } from 'mongoose';

export interface IModelRegistry extends Document {
  name: string;
  description?: string;
  baseModel: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModelRegistrySchema = new Schema<IModelRegistry>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String },
    baseModel: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

export const ModelRegistry = mongoose.model<IModelRegistry>('ModelRegistry', ModelRegistrySchema);
