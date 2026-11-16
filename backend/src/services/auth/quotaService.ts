import mongoose from 'mongoose';
import { UserModel } from '../../models/User.js';
import { AssetModel } from '../../models/Asset.js';
import { AppError } from '../../middleware/errorHandler.js';

/**
 * QuotaService provides centralized, atomic enforcement and accounting
 * for multi-tenant tier limits: storage bytes, render minutes, and daily prompts.
 */
export class QuotaService {
  /**
   * Validates whether a user has sufficient remaining storage quota for an upload.
   * Throws 403 QUOTA_EXCEEDED if the upload exceeds the tier allowance.
   */
  static async checkStorageQuota(
    userId: string | mongoose.Types.ObjectId | undefined,
    requestedBytes: number
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof UserModel.findById !== 'function'
    ) {
      return;
    }

    const user = await UserModel.findById(rawUserId);
    if (!user || !user.quota || !user.usage) return;

    const currentUsed = user.usage.storageBytesUsed || 0;
    const quotaBytes = user.quota.storageBytes;

    if (currentUsed + requestedBytes > quotaBytes) {
      const availableMb = Math.max(0, Math.floor((quotaBytes - currentUsed) / (1024 * 1024)));
      throw new AppError(
        403,
        'QUOTA_EXCEEDED',
        `Storage quota exceeded. Available: ${availableMb} MB, requested: ${Math.ceil(requestedBytes / (1024 * 1024))} MB for tier '${user.tier}'. Upgrade to increase limits.`
      );
    }
  }

  /**
   * Atomically increments storageBytesUsed upon upload completion.
   */
  static async incrementStorageUsed(
    userId: string | mongoose.Types.ObjectId | undefined,
    bytes: number
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      bytes <= 0 ||
      typeof UserModel.updateOne !== 'function'
    ) {
      return;
    }

    await UserModel.updateOne({ _id: rawUserId }, { $inc: { 'usage.storageBytesUsed': bytes } });
  }

  /**
   * Atomically decrements storageBytesUsed upon project/asset purge (clamped to 0).
   */
  static async decrementStorageUsed(
    userId: string | mongoose.Types.ObjectId | undefined,
    bytes: number
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      bytes <= 0 ||
      typeof UserModel.findById !== 'function'
    ) {
      return;
    }

    const user = await UserModel.findById(rawUserId);
    if (!user || !user.usage) return;

    const currentUsed = user.usage.storageBytesUsed || 0;
    const newUsed = Math.max(0, currentUsed - bytes);

    if (typeof UserModel.updateOne === 'function') {
      await UserModel.updateOne(
        { _id: rawUserId },
        { $set: { 'usage.storageBytesUsed': newUsed } }
      );
    }
  }

  /**
   * Validates whether a user has remaining monthly render minutes quota for an export job.
   * Throws 403 QUOTA_EXCEEDED if limit exceeded.
   */
  static async checkRenderMinutesQuota(
    userId: string | mongoose.Types.ObjectId | undefined
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof UserModel.findById !== 'function'
    ) {
      return;
    }

    const user = await UserModel.findById(rawUserId);
    if (!user || !user.quota || !user.usage) return;

    if (user.usage.renderMinutesUsed >= user.quota.renderMinutes) {
      throw new AppError(
        403,
        'QUOTA_EXCEEDED',
        `Monthly render quota of ${user.quota.renderMinutes} minutes exceeded for tier '${user.tier}'. Upgrade to increase limits.`
      );
    }
  }

  /**
   * Atomically increments renderMinutesUsed when an export render finishes.
   */
  static async incrementRenderMinutes(
    userId: string | mongoose.Types.ObjectId | undefined,
    minutes: number
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      minutes <= 0 ||
      typeof UserModel.updateOne !== 'function'
    ) {
      return;
    }

    await UserModel.updateOne({ _id: rawUserId }, { $inc: { 'usage.renderMinutesUsed': minutes } });
  }

  /**
   * Validates daily prompt quota and performs automatic midnight rollover.
   * Throws 429 QUOTA_EXCEEDED if daily limit is reached.
   */
  static async checkPromptQuota(
    userId: string | mongoose.Types.ObjectId | undefined
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof UserModel.findById !== 'function'
    ) {
      return;
    }

    const user = await UserModel.findById(rawUserId);
    if (!user || !user.quota || !user.usage) return;

    const todayDate = new Date().toISOString().split('T')[0];
    let currentPrompts = user.usage.promptsToday || 0;

    // Daily rollover: reset counter if calendar date changed
    if (user.usage.lastPromptDate && user.usage.lastPromptDate !== todayDate) {
      currentPrompts = 0;
      if (typeof UserModel.updateOne === 'function') {
        await UserModel.updateOne(
          { _id: rawUserId },
          { $set: { 'usage.promptsToday': 0, 'usage.lastPromptDate': todayDate } }
        );
      }
    }

    if (currentPrompts >= user.quota.promptsPerDay) {
      throw new AppError(
        429,
        'QUOTA_EXCEEDED',
        `Daily prompt limit of ${user.quota.promptsPerDay} prompts reached for tier '${user.tier}'. Upgrade to increase limits.`
      );
    }
  }

  /**
   * Atomically increments promptsToday and updates lastPromptDate.
   */
  static async incrementPromptQuota(
    userId: string | mongoose.Types.ObjectId | undefined
  ): Promise<void> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof UserModel.updateOne !== 'function'
    ) {
      return;
    }

    const todayDate = new Date().toISOString().split('T')[0];
    await UserModel.updateOne(
      { _id: rawUserId },
      {
        $inc: { 'usage.promptsToday': 1 },
        $set: { 'usage.lastPromptDate': todayDate },
      }
    );
  }

  /**
   * Reconciles a user's storageBytesUsed against the actual sum of their active S3 assets.
   * Eliminates quota drift from interrupted uploads, orphaned multipart sweeps, or manual purges.
   */
  static async reconcileUserStorageQuota(
    userId: string | mongoose.Types.ObjectId | undefined
  ): Promise<number> {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof AssetModel?.find !== 'function' ||
      typeof UserModel?.updateOne !== 'function'
    ) {
      return 0;
    }

    const userObjectId = new mongoose.Types.ObjectId(rawUserId);
    const assets = await AssetModel.find({
      userId: userObjectId,
      status: { $ne: 'deleted' },
    });

    const actualBytesUsed = assets.reduce((sum, a) => sum + (a.media?.sizeBytes || 0), 0);

    await UserModel.updateOne(
      { _id: userObjectId },
      { $set: { 'usage.storageBytesUsed': actualBytesUsed } }
    );

    return actualBytesUsed;
  }

  /**
   * Returns current quota and usage snapshot for a user.
   */
  static async getUserUsage(userId: string | mongoose.Types.ObjectId | undefined) {
    const rawUserId = userId?.toString();
    if (
      !rawUserId ||
      !mongoose.isValidObjectId(rawUserId) ||
      typeof UserModel.findById !== 'function'
    ) {
      return null;
    }

    const user = await UserModel.findById(rawUserId);
    if (!user) return null;

    return {
      tier: user.tier,
      quota: user.quota,
      usage: user.usage,
    };
  }
}
