import mongoose, { Schema, Document } from 'mongoose';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'TOGGLE' | 'IMPORT';

export interface IApiKeyAuditLog extends Document {
  action: AuditAction;
  keyName: string;
  detail?: string;       // mô tả thêm, vd: "isActive: true → false"
  createdAt: Date;
}

const auditLogSchema = new Schema<IApiKeyAuditLog>(
  {
    action: {
      type: String,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'TOGGLE', 'IMPORT'],
      required: true,
    },
    keyName: { type: String, required: true },
    detail: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Tự xoá log sau 90 ngày
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const ApiKeyAuditLog = mongoose.model<IApiKeyAuditLog>('ApiKeyAuditLog', auditLogSchema);
