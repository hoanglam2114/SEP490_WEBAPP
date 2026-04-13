import mongoose, { Schema, Document } from 'mongoose';

export interface ITrainingHistory extends Document {
  jobId: string;
  projectName: string;
  baseModel: string;
  datasetSource: string;       // 'local' | 'hub'
  datasetName: string;         // filename hoặc HuggingFace Hub ID
  columnMapping: string;
  parameters: {
    batchSize: number;
    epochs: number;
    learningRate: number;
    blockSize: number;
    modelMaxLength: number;
    r: number;                          // LoRA attention dimension
    lora_alpha: number;                 // Alpha parameter for LoRA scaling
    lora_dropout: number;               // Dropout probability for LoRA
    random_state: number;               // Random state seed
    gradient_accumulation_steps: number; // Gradient accumulation steps
    warmup_steps: number;               // LR warmup steps
    weight_decay: number;               // Weight decay for AdamW
    seed: number;                       // Random seed
    early_stopping_loss: number;        // Stop if loss < this
    early_stopping_patience: number;    // Steps to wait for loss decrease
    optim: string;                      // Optimizer type
    lr_scheduler_type: string;          // LR scheduler type
  };
  pushToHub: boolean;
  hfRepoId: string;
  hfToken: string;
  status: string;              // 'COMPLETED' | 'STOPPED' | 'FAILED'
  finalMetrics?: {
    loss: number;
    accuracy: number;
    vram: number;
    gpu_util: number;
  };
  lastLogLine?: string;         // e.g. "Epoch 3/3 [Step 150/150] loss: 0.1693 - acc: 94.36%"
  trainingDuration: number;    // thời gian thực tế (milliseconds)
  startedAt: Date;
  completedAt?: Date;
  lossHistory?: { progress: number; loss: number }[];
  evalLossHistory?: { progress: number; loss: number }[];
  createdAt: Date;
  updatedAt: Date;

  // Model Evaluation
  pinnedEvalId?: string;       // modelEvalId của eval được chọn làm official (hiển thị trên leaderboard)

  // Added for Resume Checkpoint
  latest_checkpoint_file_id?: string;
  drive_folder_id?: string;
  config_snapshot?: any;
  datasetPath?: string;
  workerUrl?: string;
}

const TrainingHistorySchema = new Schema<ITrainingHistory>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    projectName: { type: String, required: true },
    baseModel: { type: String, required: true, index: true },
    datasetSource: { type: String, required: true },
    datasetName: { type: String, required: true },
    columnMapping: { type: String, default: 'text' },
    parameters: {
      batchSize: { type: Number, required: true },
      epochs: { type: Number, required: true },
      learningRate: { type: Number, required: true },
      blockSize: { type: Number, required: true },
      modelMaxLength: { type: Number, required: true },
      r: { type: Number, default: 8 },
      lora_alpha: { type: Number, default: 8 },
      lora_dropout: { type: Number, default: 0 },
      random_state: { type: Number, default: 3407 },
      gradient_accumulation_steps: { type: Number, default: 4 },
      warmup_steps: { type: Number, default: 5 },
      weight_decay: { type: Number, default: 0.01 },
      seed: { type: Number, default: 3407 },
      early_stopping_loss: { type: Number, default: 0.5 },
      early_stopping_patience: { type: Number, default: 100 },
      optim: { type: String, default: 'adamw_8bit' },
      lr_scheduler_type: { type: String, default: 'linear' },
    },
    pushToHub: { type: Boolean, default: false },
    hfRepoId: { type: String, default: '' },
    hfToken: { type: String, default: '' },
    status: { type: String, required: true },
    finalMetrics: {
      loss: { type: Number },
      accuracy: { type: Number },
      vram: { type: Number },
      gpu_util: { type: Number },
    },
    lastLogLine: { type: String, default: '' },
    trainingDuration: { type: Number, default: 0 },  // ms
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    lossHistory: [
      {
        progress: { type: Number },
        loss: { type: Number },
      },
    ],
    evalLossHistory: [
      {
        progress: { type: Number },
        loss: { type: Number },
      },
    ],

    // Model Evaluation
    pinnedEvalId: { type: String, default: null },

    // Added for Resume Checkpoint
    latest_checkpoint_file_id: { type: String },
    drive_folder_id: { type: String },
    config_snapshot: { type: Schema.Types.Mixed }, // Store arbitrary JSON config
    datasetPath: { type: String },
    workerUrl: { type: String },
  },
  {
    timestamps: true, // tự tạo createdAt, updatedAt
  }
);

export const TrainingHistory = mongoose.model<ITrainingHistory>(
  'TrainingHistory',
  TrainingHistorySchema
);
