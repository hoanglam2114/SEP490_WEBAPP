import mongoose, { Schema, Document } from 'mongoose';

export interface IPromptLibraryItem extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  content: string;
  description?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PromptLibraryItemSchema = new Schema<IPromptLibraryItem>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    description: { type: String, default: '' },
    isPublic: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

PromptLibraryItemSchema.index({ ownerId: 1, name: 1 }, { unique: true });
PromptLibraryItemSchema.index({ createdAt: -1 });

export const PromptLibraryItem = mongoose.model<IPromptLibraryItem>('PromptLibraryItem', PromptLibraryItemSchema);