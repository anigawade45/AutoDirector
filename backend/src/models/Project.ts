import mongoose, { Schema, Document } from 'mongoose';

export interface IProjectVersionIndex {
  version: number;
  label: string;
  source: 'ai' | 'manual' | 'restore' | 'import';
  planId?: mongoose.Types.ObjectId;
  thumbKey?: string;
  createdAt: Date;
}

export interface IProject extends Document {
  publicId: string;
  userId: mongoose.Types.ObjectId;
  title: string;
  status: 'draft' | 'uploading' | 'analyzing' | 'ready' | 'rendering' | 'error' | 'archived';
  settings: {
    aspect: '16:9' | '9:16' | '1:1' | '4:5';
    fps: 24 | 25 | 30 | 60;
    width: number;
    height: number;
    language: string;
    brandKitId?: mongoose.Types.ObjectId;
  };
  baseAssetId?: mongoose.Types.ObjectId;
  timelineId?: mongoose.Types.ObjectId;
  headVersion: number;
  publishedVersion?: number | null;
  versions: IProjectVersionIndex[];
  stats: {
    durationMs: number;
    assetCount: number;
    renderCount: number;
    storageBytes: number;
  };
  thumbnailKey?: string;
  tags?: string[];
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    publicId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 120 },
    status: {
      type: String,
      enum: ['draft', 'uploading', 'analyzing', 'ready', 'rendering', 'error', 'archived'],
      default: 'draft',
    },
    settings: {
      aspect: { type: String, enum: ['16:9', '9:16', '1:1', '4:5'], default: '16:9' },
      fps: { type: Number, enum: [24, 25, 30, 60], default: 30 },
      width: { type: Number, default: 1920 },
      height: { type: Number, default: 1080 },
      language: { type: String, default: 'en' },
      brandKitId: { type: Schema.Types.ObjectId, ref: 'Catalog' },
    },
    baseAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    timelineId: { type: Schema.Types.ObjectId, ref: 'Timeline' },
    headVersion: { type: Number, default: 0 },
    publishedVersion: { type: Number, default: null },
    versions: [
      {
        _id: false,
        version: { type: Number, required: true },
        label: { type: String, required: true },
        source: { type: String, enum: ['ai', 'manual', 'restore', 'import'], default: 'ai' },
        planId: { type: Schema.Types.ObjectId, ref: 'EditPlan' },
        thumbKey: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    stats: {
      durationMs: { type: Number, default: 0 },
      assetCount: { type: Number, default: 0 },
      renderCount: { type: Number, default: 0 },
      storageBytes: { type: Number, default: 0 },
    },
    thumbnailKey: { type: String },
    tags: [{ type: String }],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProjectSchema.index({ userId: 1, updatedAt: -1 });

export const ProjectModel = mongoose.model<IProject>('Project', ProjectSchema);

