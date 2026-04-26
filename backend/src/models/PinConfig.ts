import mongoose, { Schema, Document } from 'mongoose';

export interface IPinConfig extends Document {
  pinHash: string;       // scrypt hash của PIN
  pinSalt: string;       // salt dùng kèm scrypt
  failCount: number;     // tổng số lần sai (reset về 0 khi đúng)
  lockedUntil?: Date;    // null = không bị khoá
  updatedAt: Date;
}

const pinConfigSchema = new Schema<IPinConfig>(
  {
    pinHash: { type: String, required: true },
    pinSalt: { type: String, required: true },
    failCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Chỉ có 1 document duy nhất trong collection này
export const PinConfig = mongoose.model<IPinConfig>('PinConfig', pinConfigSchema);
