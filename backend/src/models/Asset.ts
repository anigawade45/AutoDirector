import mongoose, { Schema, Document } from 'mongoose';

export interface IAsset extends Document {
  publicId: string;
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  kind: 'video' | 'audio' | 'image' | 'font' | 'lut';
  source: 'upload' | 'library' | 'generated';
  s3: {
    bucket: string;
    rawKey: string;
    proxyKey?: string;
    audioKey?: string;
    posterKey?: string;
  };
  media?: {
    durationMs: number;
    width: number;
    height: number;
    fps: number;
    videoCodec?: string;
    audioCodec?: string;
    sampleRate?: number;
    channels?: number;
    bitrate?: number;
    sizeBytes: number;
    rotation?: number;
  };
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  checksum?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<IAsset>(
  {
    publicId: { type: String, required: true, unique: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['video', 'audio', 'image', 'font', 'lut'], default: 'video' },
    source: { type: String, enum: ['upload', 'library', 'generated'], default: 'upload' },
    s3: {
      bucket: { type: String, required: true },
      rawKey: { type: String, required: true },
      proxyKey: { type: String },
      audioKey: { type: String },
      posterKey: { type: String },
    },
    media: {
      durationMs: { type: Number },
      width: { type: Number },
      height: { type: Number },
      fps: { type: Number },
      videoCodec: { type: String },
      audioCodec: { type: String },
      sampleRate: { type: Number },
      channels: { type: Number },
      bitrate: { type: Number },
      sizeBytes: { type: Number },
      rotation: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['uploading', 'processing', 'ready', 'failed'],
      default: 'uploading',
    },
    checksum: { type: String },
  },
  { timestamps: true }
);

AssetSchema.index({ projectId: 1, kind: 1 });
AssetSchema.index({ userId: 1, checksum: 1 });

export const AssetModel = mongoose.model<IAsset>('Asset', AssetSchema);
