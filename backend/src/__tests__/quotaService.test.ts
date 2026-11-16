import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaService } from '../services/auth/quotaService.js';
import { UserModel } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import mongoose from 'mongoose';

vi.mock('../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

describe('QuotaService — Multi-Tenant Usage Accounting & Quota Enforcement', () => {
  const mockUserId = new mongoose.Types.ObjectId('672b00000000000000000001');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Storage Quota Accounting', () => {
    it('permits upload when requested bytes are within remaining allowance', async () => {
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { storageBytes: 5 * 1024 * 1024 * 1024 }, // 5 GB
        usage: { storageBytesUsed: 1 * 1024 * 1024 * 1024 }, // 1 GB used -> 4 GB left
      });

      await expect(
        QuotaService.checkStorageQuota(mockUserId, 500 * 1024 * 1024) // 500 MB
      ).resolves.toBeUndefined();
    });

    it('rejects upload with 403 QUOTA_EXCEEDED when requested bytes exceed allowance', async () => {
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { storageBytes: 5 * 1024 * 1024 * 1024 }, // 5 GB
        usage: { storageBytesUsed: 4.8 * 1024 * 1024 * 1024 }, // 4.8 GB used -> 200 MB left
      });

      await expect(
        QuotaService.checkStorageQuota(mockUserId, 500 * 1024 * 1024) // 500 MB requested
      ).rejects.toThrowError(
        expect.objectContaining({
          statusCode: 403,
          code: 'QUOTA_EXCEEDED',
        })
      );
    });

    it('atomically increments storageBytesUsed upon upload completion', async () => {
      await QuotaService.incrementStorageUsed(mockUserId, 15000000);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        { $inc: { 'usage.storageBytesUsed': 15000000 } }
      );
    });

    it('decrements storageBytesUsed upon asset/project deletion clamped to zero', async () => {
      (UserModel.findById as any).mockResolvedValue({
        usage: { storageBytesUsed: 50000000 },
      });

      await QuotaService.decrementStorageUsed(mockUserId, 30000000);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        { $set: { 'usage.storageBytesUsed': 20000000 } }
      );

      // Decrementing more than current used clamps to 0
      (UserModel.findById as any).mockResolvedValue({
        usage: { storageBytesUsed: 10000000 },
      });

      await QuotaService.decrementStorageUsed(mockUserId, 50000000);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        { $set: { 'usage.storageBytesUsed': 0 } }
      );
    });
  });

  describe('Render Minutes Quota Accounting', () => {
    it('permits render export when monthly render minutes quota has not been exceeded', async () => {
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { renderMinutes: 60 },
        usage: { renderMinutesUsed: 25 },
      });

      await expect(QuotaService.checkRenderMinutesQuota(mockUserId)).resolves.toBeUndefined();
    });

    it('blocks export with 403 QUOTA_EXCEEDED when monthly render minutes quota is exhausted', async () => {
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { renderMinutes: 60 },
        usage: { renderMinutesUsed: 60 },
      });

      await expect(QuotaService.checkRenderMinutesQuota(mockUserId)).rejects.toThrowError(
        expect.objectContaining({
          statusCode: 403,
          code: 'QUOTA_EXCEEDED',
        })
      );
    });

    it('atomically increments renderMinutesUsed when an export job finishes', async () => {
      await QuotaService.incrementRenderMinutes(mockUserId, 4);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        { $inc: { 'usage.renderMinutesUsed': 4 } }
      );
    });
  });

  describe('Daily Prompts Quota Accounting & Midnight Rollover', () => {
    it('permits AI prompt submission when daily quota is not exceeded', async () => {
      const todayDate = new Date().toISOString().split('T')[0];
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { promptsPerDay: 100 },
        usage: { promptsToday: 42, lastPromptDate: todayDate },
      });

      await expect(QuotaService.checkPromptQuota(mockUserId)).resolves.toBeUndefined();
    });

    it('blocks AI prompt with 429 QUOTA_EXCEEDED when daily limit is reached today', async () => {
      const todayDate = new Date().toISOString().split('T')[0];
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { promptsPerDay: 100 },
        usage: { promptsToday: 100, lastPromptDate: todayDate },
      });

      await expect(QuotaService.checkPromptQuota(mockUserId)).rejects.toThrowError(
        expect.objectContaining({
          statusCode: 429,
          code: 'QUOTA_EXCEEDED',
        })
      );
    });

    it('automatically rolls over promptsToday to 0 when calendar date changes', async () => {
      (UserModel.findById as any).mockResolvedValue({
        tier: 'free',
        quota: { promptsPerDay: 100 },
        usage: { promptsToday: 100, lastPromptDate: '2026-11-15' }, // Yesterday
      });

      const todayDate = new Date().toISOString().split('T')[0];

      // Because date changed, counter rolls over and request passes!
      await expect(QuotaService.checkPromptQuota(mockUserId)).resolves.toBeUndefined();

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        { $set: { 'usage.promptsToday': 0, 'usage.lastPromptDate': todayDate } }
      );
    });

    it('atomically increments promptsToday and timestamps lastPromptDate', async () => {
      const todayDate = new Date().toISOString().split('T')[0];
      await QuotaService.incrementPromptQuota(mockUserId);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId.toString() },
        {
          $inc: { 'usage.promptsToday': 1 },
          $set: { 'usage.lastPromptDate': todayDate },
        }
      );
    });
  });
});
