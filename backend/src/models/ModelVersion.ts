import mongoose, { Schema, Document } from 'mongoose';

export enum ModelVersionStatus {
  DEVELOPMENT = 'Development',
  STAGING = 'Staging',
  PRODUCTION = 'Production',
  ARCHIVED = 'Archived',
}

export interface IModelVersion extends Document {
  modelRegistryId: mongoose.Types.ObjectId;
  version: string; // e.g., "v1.0.0"
  trainingHistoryId?: mongoose.Types.ObjectId;
  evaluationId?: mongoose.Types.ObjectId;
  hfRepoId?: string;
  status: ModelVersionStatus;
  metrics?: {
    loss?: number;
    accuracy?: number;
    overallScore?: number;
    [key: string]: any;
  };
  configSnapshot?: any;
  datasetInfo?: {
    name: string;
    source: string;
    [key: string]: any;
  };
  promptVersion?: string;
  notes?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModelVersionSchema = new Schema<IModelVersion>(
  {
    modelRegistryId: { type: Schema.Types.ObjectId, ref: 'ModelRegistry', required: true },
    version: { type: String, required: true },
    trainingHistoryId: { type: Schema.Types.ObjectId, ref: 'TrainingHistory' },
    evaluationId: { type: Schema.Types.ObjectId, ref: 'ModelEvaluation' },
    hfRepoId: { type: String },
    status: {
      type: String,
      enum: Object.values(ModelVersionStatus),
      default: ModelVersionStatus.DEVELOPMENT,
    },
    metrics: { type: Schema.Types.Mixed },
    configSnapshot: { type: Schema.Types.Mixed },
    datasetInfo: {
      name: { type: String },
      source: { type: String },
    },
    promptVersion: { type: String },
    notes: { type: String },
    createdBy: { type: String },
  },
  {
    timestamps: true,
  }
);

// Ensure unique version per model registry
ModelVersionSchema.index({ modelRegistryId: 1, version: 1 }, { unique: true });

export const ModelVersion = mongoose.model<IModelVersion>('ModelVersion', ModelVersionSchema);
