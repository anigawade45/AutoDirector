import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalysisResultDocument extends Document {
  assetId: mongoose.Types.ObjectId;
  version: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  silences: Array<{ startMs: number; endMs: number; avgDb: number }>;
  sceneCuts: Array<{ tMs: number; score: number }>;
  beats: {
    bpm: number;
    grid: number[];
  };
  loudness: {
    integratedLufs: number;
    truePeakDb: number;
  };
  transcriptRef?: mongoose.Types.ObjectId;
  highlights?: Array<{
    startMs: number;
    endMs: number;
    score: number;
    reason: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const AnalysisResultSchema = new Schema<IAnalysisResultDocument>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true, unique: true },
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'complete', 'failed'],
      default: 'pending',
    },
    silences: [
      {
        _id: false,
        startMs: { type: Number, required: true },
        endMs: { type: Number, required: true },
        avgDb: { type: Number, required: true },
      },
    ],
    sceneCuts: [
      {
        _id: false,
        tMs: { type: Number, required: true },
        score: { type: Number, required: true },
      },
    ],
    beats: {
      bpm: { type: Number, default: 120 },
      grid: [{ type: Number }],
    },
    loudness: {
      integratedLufs: { type: Number, default: -16 },
      truePeakDb: { type: Number, default: -1.5 },
    },
    transcriptRef: { type: Schema.Types.ObjectId, ref: 'CaptionSet' },
    highlights: [
      {
        _id: false,
        startMs: { type: Number, required: true },
        endMs: { type: Number, required: true },
        score: { type: Number, required: true },
        reason: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

export const AnalysisResultModel = mongoose.model<IAnalysisResultDocument>(
  'AnalysisResult',
  AnalysisResultSchema
);

