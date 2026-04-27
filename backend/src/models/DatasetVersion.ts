import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetVersion extends Document {
  projectId?: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  projectName: string;
  isPublic?: boolean;
  sharedWithUserIds?: mongoose.Types.ObjectId[];
  parentVersionId?: mongoose.Types.ObjectId;
  createdFromVersionId?: mongoose.Types.ObjectId;
  versionNo?: number;
  versionName: string;
  operationType?: 'upload' | 'clean' | 'cluster' | 'refine_approved' | 'manual_edit' | 'legacy';
  operationParams?: Record<string, unknown>;
  promptId?: mongoose.Types.ObjectId;
  promptContentSnapshot?: string;
  similarityThreshold: number;
  totalSamples: number;
  createdAt: Date;
  updatedAt?: Date;
}

const DatasetVersionSchema = new Schema<IDatasetVersion>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'DataPrepProject', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectName: { type: String, required: true, index: true, trim: true },
    isPublic: { type: Boolean, default: false, index: true },
    sharedWithUserIds: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    parentVersionId: { type: Schema.Types.ObjectId, ref: 'DatasetVersion', index: true },
    createdFromVersionId: { type: Schema.Types.ObjectId, ref: 'DatasetVersion', index: true },
    versionNo: { type: Number, min: 1 },
    versionName: { type: String, required: true, trim: true },
    operationType: {
      type: String,
      enum: ['upload', 'clean', 'cluster', 'refine_approved', 'manual_edit', 'legacy'],
      default: 'legacy',
    },
    operationParams: { type: Schema.Types.Mixed },
    promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromptLibraryItem' },
    promptContentSnapshot: { type: String },
    similarityThreshold: { type: Number, required: true, min: 0, max: 1 },
    totalSamples: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
  }
);

DatasetVersionSchema.index({ projectName: 1, createdAt: -1 });
DatasetVersionSchema.index({ projectId: 1, versionNo: 1 }, { unique: true, sparse: true });

export const DatasetVersion = mongoose.model<IDatasetVersion>('DatasetVersion', DatasetVersionSchema);
