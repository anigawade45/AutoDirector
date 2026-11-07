import mongoose, { Schema } from 'mongoose';
import { EditPlan } from '@ai-video/shared';

export interface IEditPlan {
  projectId: mongoose.Types.ObjectId;
  version: number;
  parentVersion?: number | null;
  prompt: string;
  plan: EditPlan;
  patch?: Array<Record<string, unknown>>;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  assumptions?: Record<string, unknown>;
  validation?: {
    repairAttempts: number;
    warnings: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const EditPlanSchema = new Schema<IEditPlan>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    version: { type: Number, required: true },
    parentVersion: { type: Number, default: null },
    prompt: { type: String, required: true },
    plan: { type: Schema.Types.Mixed, required: true },
    patch: [{ type: Schema.Types.Mixed }],
    model: { type: String, required: true },
    tokensIn: { type: Number },
    tokensOut: { type: Number },
    latencyMs: { type: Number },
    assumptions: { type: Schema.Types.Mixed, default: {} },
    validation: {
      repairAttempts: { type: Number, default: 0 },
      warnings: [{ type: String }],
    },
  },
  { timestamps: true }
);

EditPlanSchema.index({ projectId: 1, version: -1 }, { unique: true });

export const EditPlanModel = mongoose.model<IEditPlan>('EditPlan', EditPlanSchema);
