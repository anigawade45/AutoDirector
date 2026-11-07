import mongoose, { Schema, Document } from 'mongoose';

export type JobState =
  'queued' | 'active' | 'processing' | 'uploading_output' | 'completed' | 'failed' | 'canceled';

export type JobType = 'analysis' | 'preview' | 'render' | 'export';

export type JobProfile = 'preview_480p' | 'final_1080p' | 'final_4k';

export interface IRenderJobDocument extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  timelineVersion: number;
  snapshotHash?: string;
  type: JobType;
  profile: JobProfile;
  state: JobState;
  percent: number;
  etaSec?: number;
  queueJobId?: string;
  workerId?: string;
  output?: {
    key: string;
    sizeBytes: number;
    durationMs: number;
    checksum?: string;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: any;
  };
  timings: {
    queuedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
    durationMs?: number;
    cpuSec?: number;
  };
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const RenderJobSchema = new Schema<IRenderJobDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    timelineVersion: { type: Number, required: true },
    snapshotHash: { type: String },
    type: {
      type: String,
      enum: ['analysis', 'preview', 'render', 'export'],
      required: true,
    },
    profile: {
      type: String,
      enum: ['preview_480p', 'final_1080p', 'final_4k'],
      default: 'preview_480p',
    },
    state: {
      type: String,
      enum: [
        'queued',
        'active',
        'processing',
        'uploading_output',
        'completed',
        'failed',
        'canceled',
      ],
      default: 'queued',
      index: true,
    },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    etaSec: { type: Number },
    queueJobId: { type: String },
    workerId: { type: String },
    output: {
      key: { type: String },
      sizeBytes: { type: Number },
      durationMs: { type: Number },
      checksum: { type: String },
    },
    error: {
      code: { type: String },
      message: { type: String },
      retryable: { type: Boolean, default: false },
      details: { type: Schema.Types.Mixed },
    },
    timings: {
      queuedAt: { type: Date, default: Date.now },
      startedAt: { type: Date },
      finishedAt: { type: Date },
      durationMs: { type: Number },
      cpuSec: { type: Number },
    },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

RenderJobSchema.index({ projectId: 1, createdAt: -1 });
RenderJobSchema.index({ state: 1, type: 1 });
RenderJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL for preview cleanup

export const RenderJobModel = mongoose.model<IRenderJobDocument>('RenderJob', RenderJobSchema);
