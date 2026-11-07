import mongoose, { Schema } from 'mongoose';

const EffectSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['color', 'blur', 'vignette', 'grain', 'speed_ramp', 'denoise', 'normalize', 'stabilize'],
      required: true,
    },
    enabled: { type: Boolean, default: true },
    params: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const ClipSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['video', 'audio', 'music', 'subtitle', 'text', 'overlay', 'intro', 'outro'],
      required: true,
    },
    startMs: { type: Number, required: true, min: 0 },
    durMs: { type: Number, required: true, min: 1 },
    enabled: { type: Boolean, default: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    catalogId: { type: String },
    captionSetId: { type: Schema.Types.ObjectId, ref: 'CaptionSet' },
    templateId: { type: String },
    srcInMs: { type: Number },
    srcOutMs: { type: Number },
    speed: { type: Number, default: 1, min: 0.25, max: 4 },
    audioGainDb: { type: Number },
    reverse: { type: Boolean, default: false },
    transform: { type: Schema.Types.Mixed },
    style: { type: Schema.Types.Mixed },
    params: { type: Schema.Types.Mixed },
    effects: [EffectSchema],
    keyframes: { type: Schema.Types.Mixed },
    transitionOut: {
      type: new Schema(
        {
          type: { type: String, required: true },
          durMs: { type: Number, required: true },
          easing: { type: String, default: 'ease_in_out' },
        },
        { _id: false }
      ),
      default: null,
    },
    origin: {
      layerId: { type: String },
      source: { type: String, default: 'ai' },
    },
  },
  { _id: false }
);

const TrackSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: {
      type: String,
      enum: ['video', 'audio', 'music', 'subtitle', 'text', 'overlay'],
      required: true,
    },
    order: { type: Number, required: true },
    name: { type: String, required: true },
    locked: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    volumeDb: { type: Number, default: 0 },
    clips: [ClipSchema],
  },
  { _id: false }
);

export interface ITimeline {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  rev: number;
  version: number;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  tracks: any[];
  markers: any[];
  globalEffects: any[];
  sourcePlanId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const TimelineSchema = new Schema<ITimeline>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rev: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    fps: { type: Number, default: 30 },
    width: { type: Number, default: 1920 },
    height: { type: Number, default: 1080 },
    durationMs: { type: Number, default: 0 },
    tracks: [TrackSchema],
    markers: [Schema.Types.Mixed],
    globalEffects: [EffectSchema],
    sourcePlanId: { type: Schema.Types.ObjectId, ref: 'EditPlan', default: null },
  },
  { timestamps: true, minimize: false }
);

export const TimelineModel = mongoose.model<ITimeline>('Timeline', TimelineSchema);
