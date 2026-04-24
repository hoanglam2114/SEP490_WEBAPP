import mongoose, { Schema, Document } from 'mongoose';

export interface IModelRegistry extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  baseModel: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModelRegistrySchema = new Schema<IModelRegistry>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    baseModel: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

ModelRegistrySchema.index({ ownerId: 1, name: 1 }, { unique: true });

export const ModelRegistry = mongoose.model<IModelRegistry>('ModelRegistry', ModelRegistrySchema);
