import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessageDocument extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId?: mongoose.Types.ObjectId | string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  planId?: mongoose.Types.ObjectId | string;
  versionResult?: number;
  createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessageDocument>(
  {
    projectId: { type: Schema.Types.Mixed, ref: 'Project', required: true },
    userId: { type: Schema.Types.Mixed, ref: 'User' },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, required: true },
    planId: { type: Schema.Types.Mixed, ref: 'EditPlan' },
    versionResult: { type: Number },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ChatMessageSchema.index({ userId: 1, projectId: 1, createdAt: 1 });
ChatMessageSchema.index({ projectId: 1, createdAt: 1 });

export const ChatMessageModel = mongoose.model<IChatMessageDocument>(
  'ChatMessage',
  ChatMessageSchema
);
