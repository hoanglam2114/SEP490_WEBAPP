import mongoose, { Schema, Document, Types } from 'mongoose';

export type AssignmentSubmissionStatus = 'draft' | 'submitted' | 'approved';

export interface IDatasetAssignmentSubmission extends Document {
  datasetVersionId: Types.ObjectId;
  assigneeId: Types.ObjectId;
  status: AssignmentSubmissionStatus;
  progressSnapshot?: Record<string, unknown>;
  submittedAt?: Date;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt?: Date;
}

const DatasetAssignmentSubmissionSchema = new Schema<IDatasetAssignmentSubmission>(
  {
    datasetVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DatasetVersion',
      required: true,
      index: true,
    },
    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved'] as const,
      default: 'draft',
      index: true,
    },
    progressSnapshot: { type: Schema.Types.Mixed },
    submittedAt: { type: Date },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

DatasetAssignmentSubmissionSchema.index({ datasetVersionId: 1, assigneeId: 1 }, { unique: true });

export const DatasetAssignmentSubmission = mongoose.model<IDatasetAssignmentSubmission>(
  'DatasetAssignmentSubmission',
  DatasetAssignmentSubmissionSchema
);
