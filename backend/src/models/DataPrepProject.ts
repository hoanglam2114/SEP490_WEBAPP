import mongoose, { Document, Schema } from 'mongoose';

export type DataPrepSourceType = 'chat' | 'lesson';

export interface IDataPrepProject extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  sourceType: DataPrepSourceType;
  rootVersionId?: mongoose.Types.ObjectId;
  latestVersionId?: mongoose.Types.ObjectId;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DataPrepProjectSchema = new Schema<IDataPrepProject>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    sourceType: { type: String, enum: ['chat', 'lesson'], required: true, default: 'chat' },
    rootVersionId: { type: Schema.Types.ObjectId, ref: 'DatasetVersion' },
    latestVersionId: { type: Schema.Types.ObjectId, ref: 'DatasetVersion' },
    isArchived: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

DataPrepProjectSchema.index({ ownerId: 1, name: 1 });
DataPrepProjectSchema.index({ ownerId: 1, updatedAt: -1 });

export const DataPrepProject = mongoose.model<IDataPrepProject>('DataPrepProject', DataPrepProjectSchema);
