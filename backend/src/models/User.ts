import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  name: string;
  authProvider: 'local' | 'google' | 'github';
  tier: 'free' | 'pro' | 'enterprise';
  quota: {
    storageBytes: number;
    renderMinutes: number;
    promptsPerDay: number;
  };
  usage: {
    storageBytesUsed: number;
    renderMinutesUsed: number;
    promptsToday: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    authProvider: { type: String, enum: ['local', 'google', 'github'], default: 'local' },
    tier: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    quota: {
      storageBytes: { type: Number, default: 5 * 1024 * 1024 * 1024 }, // 5 GB
      renderMinutes: { type: Number, default: 60 },
      promptsPerDay: { type: Number, default: 100 },
    },
    usage: {
      storageBytesUsed: { type: Number, default: 0 },
      renderMinutesUsed: { type: Number, default: 0 },
      promptsToday: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model<IUser>('User', UserSchema);

