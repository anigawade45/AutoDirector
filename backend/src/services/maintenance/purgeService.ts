import { S3Service } from '../storage/s3Service.js';
import { StructuredLogger } from '../observability/logger.js';
import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { AssetModel } from '../../models/Asset.js';
import { AnalysisResultModel } from '../../models/AnalysisResult.js';
import { CaptionSetModel } from '../../models/CaptionSet.js';
import { EditPlanModel } from '../../models/EditPlan.js';
import { TimelineModel } from '../../models/Timeline.js';
import { TimelineVersionModel } from '../../models/TimelineVersion.js';
import { RenderJobModel } from '../../models/RenderJob.js';
import { ChatMessageModel } from '../../models/ChatMessage.js';
import { AppError } from '../../middleware/errorHandler.js';
import mongoose from 'mongoose';

export interface PurgeProjectResult {
  success: boolean;
  projectId: string;
  deletedS3Objects: number;
  deletedAssetsCount: number;
}

export interface PurgeUserResult {
  success: boolean;
  userId: string;
  deletedS3Objects: number;
  deletedProjectsCount: number;
  deletedAssetsCount: number;
}

export class PurgeService {
  /**
   * Performs an immediate, irreversible hard purge of a project and all its associated
   * raw media, proxy files, subtitle tracks, rendered previews, and database artifacts.
   */
  static async purgeProjectData(userId: string, projectId: string): Promise<PurgeProjectResult> {
    const userObjectId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;

    const project = await ProjectModel.findOne({
      publicId: projectId,
      userId: userObjectId,
    });

    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or access denied for deletion');
    }

    // 1. Purge S3 storage under per-project key prefix: users/{userId}/projects/{projectId}/
    const projectS3Prefix = `users/${userId}/projects/${projectId}/`;
    const deletedS3Objects = await S3Service.deleteObjectsByPrefix(projectS3Prefix);

    // 2. Cascade delete database records
    const assets = await AssetModel.find({ projectId: project._id });
    const assetIds = assets.map((a) => a._id);

    if (assetIds.length > 0) {
      await AnalysisResultModel.deleteMany({ assetId: { $in: assetIds } });
      await CaptionSetModel.deleteMany({ assetId: { $in: assetIds } });
      await AssetModel.deleteMany({ _id: { $in: assetIds } });
    }

    await EditPlanModel.deleteMany({ projectId: project._id });
    await TimelineModel.deleteMany({ projectId: project._id });
    await TimelineVersionModel.deleteMany({ projectId: project._id });
    await RenderJobModel.deleteMany({ projectId: project._id });
    await ChatMessageModel.deleteMany({ projectId: project._id });
    await ProjectModel.deleteOne({ _id: project._id });

    StructuredLogger.info(`[PURGE:PROJECT] Permanently purged project ${projectId} and ${deletedS3Objects} S3 object(s)`, {
      userId,
      projectId,
      deletedS3Objects,
      deletedAssetsCount: assetIds.length,
    });

    return {
      success: true,
      projectId,
      deletedS3Objects,
      deletedAssetsCount: assetIds.length,
    };
  }

  /**
   * Fulfills GDPR Right-to-be-Forgotten / Delete-on-Request by wiping all user media,
   * projects, timelines, credentials, and data records permanently from storage and databases.
   */
  static async purgeUserData(userId: string): Promise<PurgeUserResult> {
    const userObjectId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;

    // 1. Purge all S3 storage under user prefix: users/{userId}/
    const deletedS3Objects = await S3Service.purgeUserStorage(userId);

    // 2. Retrieve user projects for cascaded DB cleanup
    const userProjects = await ProjectModel.find({ userId: userObjectId });
    const projectIds = userProjects.map((p) => p._id);

    const userAssets = await AssetModel.find({ userId: userObjectId });
    const assetIds = userAssets.map((a) => a._id);

    if (assetIds.length > 0) {
      await AnalysisResultModel.deleteMany({ assetId: { $in: assetIds } });
      await CaptionSetModel.deleteMany({ assetId: { $in: assetIds } });
      await AssetModel.deleteMany({ _id: { $in: assetIds } });
    }

    if (projectIds.length > 0) {
      await EditPlanModel.deleteMany({ projectId: { $in: projectIds } });
      await TimelineModel.deleteMany({ projectId: { $in: projectIds } });
      await TimelineVersionModel.deleteMany({ projectId: { $in: projectIds } });
      await ChatMessageModel.deleteMany({ projectId: { $in: projectIds } });
      await ProjectModel.deleteMany({ _id: { $in: projectIds } });
    }

    await RenderJobModel.deleteMany({ userId: userObjectId });
    await UserModel.deleteOne({ _id: userObjectId });

    StructuredLogger.info(`[PURGE:USER] GDPR purge completed for user ${userId}: purged ${deletedS3Objects} S3 files across ${projectIds.length} projects`, {
      userId,
      deletedS3Objects,
      deletedProjectsCount: projectIds.length,
      deletedAssetsCount: assetIds.length,
    });

    return {
      success: true,
      userId,
      deletedS3Objects,
      deletedProjectsCount: projectIds.length,
      deletedAssetsCount: assetIds.length,
    };
  }
}
