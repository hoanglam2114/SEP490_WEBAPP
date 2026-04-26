import mongoose, { Schema, Document } from 'mongoose';

export interface IApiKeyConfig extends Document {
  name: string;            // tên biến, vd: OPENAI_KEY
  encryptedValue: string;
  iv: string;
  authTag: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

const apiKeyConfigSchema = new Schema<IApiKeyConfig>(
  {
    name: { type: String, required: true, unique: true, uppercase: true, trim: true },
    encryptedValue: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

export const ApiKeyConfig = mongoose.model<IApiKeyConfig>('ApiKeyConfig', apiKeyConfigSchema);
