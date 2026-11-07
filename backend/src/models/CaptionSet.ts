import mongoose, { Schema, Document } from 'mongoose';

const WordTimingSchema = new Schema(
  {
    w: { type: String, required: true },
    s: { type: Number, required: true },
    e: { type: Number, required: true },
    conf: { type: Number, default: 1 },
  },
  { _id: false }
);

const CaptionCueSchema = new Schema(
  {
    id: { type: String, required: true },
    startMs: { type: Number, required: true },
    endMs: { type: Number, required: true },
    text: { type: String, required: true },
    speaker: { type: String, default: null },
    words: [WordTimingSchema],
  },
  { _id: false }
);

export interface ICaptionSetDocument extends Document {
  projectId: mongoose.Types.ObjectId;
  assetId: mongoose.Types.ObjectId;
  language: string;
  origin: 'whisper' | 'manual' | 'imported';
  basedOn?: mongoose.Types.ObjectId | null;
  cues: Array<{
    id: string;
    startMs: number;
    endMs: number;
    text: string;
    speaker?: string | null;
    words: Array<{ w: string; s: number; e: number; conf: number }>;
  }>;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const CaptionSetSchema = new Schema<ICaptionSetDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    language: { type: String, default: 'en' },
    origin: { type: String, enum: ['whisper', 'manual', 'imported'], default: 'whisper' },
    basedOn: { type: Schema.Types.ObjectId, ref: 'CaptionSet', default: null },
    cues: [CaptionCueSchema],
    contentHash: { type: String, required: true },
  },
  { timestamps: true }
);

CaptionSetSchema.index({ projectId: 1, assetId: 1 });
CaptionSetSchema.index({ contentHash: 1 });

export const CaptionSetModel = mongoose.model<ICaptionSetDocument>('CaptionSet', CaptionSetSchema);

