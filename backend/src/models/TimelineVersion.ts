import mongoose, { Schema, Document } from 'mongoose';

export interface ITimelineVersion extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  version: number;
  parentVersion?: number | null;
  source: 'ai' | 'manual' | 'restore' | 'import';
  label: string;
  planId?: mongoose.Types.ObjectId;
  snapshot: Record<string, unknown>;
  diffSummary?: {
    clipsAdded?: number;
    clipsRemoved?: number;
    effectsChanged?: number;
  };
  snapshotHash: string;
  createdAt: Date;
}

const TimelineVersionSchema = new Schema<ITimelineVersion>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    version: { type: Number, required: true },
    parentVersion: { type: Number, default: null },
    source: { type: String, enum: ['ai', 'manual', 'restore', 'import'], default: 'ai' },
    label: { type: String, required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'EditPlan' },
    snapshot: { type: Schema.Types.Mixed, required: true },
    diffSummary: {
      clipsAdded: { type: Number, default: 0 },
      clipsRemoved: { type: Number, default: 0 },
      effectsChanged: { type: Number, default: 0 },
    },
    snapshotHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TimelineVersionSchema.index({ projectId: 1, version: -1 }, { unique: true });
TimelineVersionSchema.index({ projectId: 1, snapshotHash: 1 });

export const TimelineVersionModel = mongoose.model<ITimelineVersion>(
  'TimelineVersion',
  TimelineVersionSchema
);

