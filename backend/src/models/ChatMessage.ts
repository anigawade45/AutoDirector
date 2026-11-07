import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessageDocument extends Document {
  projectId: mongoose.Types.ObjectId;
  role: 'user' | 'assistant' | 'system';
  text: string;
  planId?: mongoose.Types.ObjectId;
  versionResult?: number;
  createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessageDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'EditPlan' },
    versionResult: { type: Number },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ChatMessageSchema.index({ projectId: 1, createdAt: 1 });

export const ChatMessageModel = mongoose.model<IChatMessageDocument>(
  'ChatMessage',
  ChatMessageSchema
);
