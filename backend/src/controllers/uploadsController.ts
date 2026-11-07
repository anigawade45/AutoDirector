import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { S3Service } from '../services/storage/s3Service.js';
import { UploadSessionStore } from '../services/storage/uploadSessionStore.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { analysisQueue } from '../services/queue/queueService.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
];

export const MIN_UPLOAD_SIZE_BYTES = 1024; // 1 KB minimum for valid video container
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export class UploadsController {
  static async createUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId, fileName, contentType, sizeBytes, checksumSha256 } = req.body;

      if (!projectId || !fileName || sizeBytes === undefined || sizeBytes === null) {
        throw new AppError(400, 'BAD_REQUEST', 'Missing required fields: projectId, fileName, sizeBytes');
      }

      // Validate sizeBytes is a positive integer
      if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new AppError(400, 'INVALID_FILE_SIZE', 'File size must be a positive number greater than 0 bytes');
      }

      // Minimum upload size (1 KB)
      if (sizeBytes < MIN_UPLOAD_SIZE_BYTES) {
        throw new AppError(
          400,
          'FILE_TOO_SMALL',
          `Uploaded video size (${sizeBytes} bytes) is below minimum required size of ${MIN_UPLOAD_SIZE_BYTES} bytes`
        );
      }

      // Max upload size 5GB
      if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
        throw new AppError(413, 'UPLOAD_TOO_LARGE', 'Uploaded video exceeds 5GB maximum limit');
      }

      // Validate MIME / Content-Type
      if (!contentType || !ALLOWED_VIDEO_MIME_TYPES.includes(contentType.toLowerCase())) {
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          `Unsupported content type '${contentType}'. Supported video formats: video/mp4, video/quicktime, video/webm`
        );
      }

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project does not exist or unauthorized');
      }

      // Check upload deduplication by checksumSha256
      if (checksumSha256) {
        const existingAsset = await AssetModel.findOne({
          userId: req.user!._id,
          checksum: checksumSha256,
          status: 'ready',
        });

        if (existingAsset) {
          project.baseAssetId = existingAsset._id as any;
          project.status = 'ready';
          await project.save();

          res.status(200).json({
            success: true,
            data: {
              deduplicated: true,
              assetId: existingAsset.publicId,
              message: 'Existing identical video reused via SHA-256 deduplication',
            },
            requestId: req.id,
          });
          return;
        }
      }

      const assetId = `ast_${nanoid(10)}`;
      const session = await S3Service.createMultipartUpload(
        req.user!.id,
        projectId,
        assetId,
        sizeBytes,
        contentType
      );

      // Persist session to Redis with 24-hour TTL
      await UploadSessionStore.saveSession(session.uploadId, {
        userId: req.user!.id,
        projectId,
        assetId,
        rawKey: session.rawKey,
        sizeBytes,
        contentType,
        totalParts: session.parts.length,
        checksumSha256: checksumSha256 || undefined,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        success: true,
        data: {
          uploadId: session.uploadId,
          assetId,
          partSizeBytes: session.partSizeBytes,
          parts: session.parts,
          expiresAt: session.expiresAt,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async completeUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const uploadId = req.params.id;
      const { parts } = req.body;

      if (!Array.isArray(parts) || parts.length === 0) {
        throw new AppError(400, 'INVALID_PARTS', 'Upload completion requires a non-empty array of parts');
      }

      // Retrieve session from Redis
      const session = await UploadSessionStore.getSession(uploadId);
      if (!session) {
        throw new AppError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session expired or invalid');
      }

      // Enforce tenant ownership
      if (session.userId !== req.user!.id && session.userId !== req.user!._id?.toString()) {
        throw new AppError(403, 'FORBIDDEN', 'Unauthorized: You do not own this upload session');
      }

      // Verify exact totalParts count
      if (parts.length !== session.totalParts) {
        throw new AppError(
          400,
          'INCOMPLETE_PARTS',
          `Expected ${session.totalParts} parts, but received ${parts.length} parts`
        );
      }

      // Verify parts sequence (1 to N without gaps)
      const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      for (let i = 0; i < sortedParts.length; i++) {
        if (sortedParts[i].partNumber !== i + 1) {
          throw new AppError(400, 'INVALID_PART_SEQUENCE', `Missing part number ${i + 1} in upload parts`);
        }
        if (!sortedParts[i].etag) {
          throw new AppError(400, 'MISSING_ETAG', `Part ${i + 1} is missing an ETag`);
        }
      }

      // Complete S3 multipart
      await S3Service.completeMultipartUpload(session.rawKey, uploadId, parts);
      await UploadSessionStore.deleteSession(uploadId);

      const project = await ProjectModel.findOne({ publicId: session.projectId });

      // Create Asset document with checksum
      const asset = await AssetModel.create({
        publicId: session.assetId,
        projectId: project!._id,
        userId: req.user!._id,
        kind: 'video',
        source: 'upload',
        checksum: session.checksumSha256 || undefined,
        s3: {
          bucket: env.S3_BUCKET_NAME,
          rawKey: session.rawKey,
        },
        status: 'processing',
      });

      // Update project's baseAssetId
      if (project) {
        project.baseAssetId = asset._id as any;
        project.status = 'analyzing';
        await project.save();
      }

      // Create RenderJob for analysis
      const analysisJob = await RenderJobModel.create({
        projectId: project!._id,
        userId: req.user!._id,
        timelineVersion: 0,
        type: 'analysis',
        profile: 'preview_480p',
        state: 'queued',
        percent: 0,
        timings: { queuedAt: new Date() },
      });

      // Enqueue to BullMQ
      const bullJob = await analysisQueue.add('analyze', {
        jobId: analysisJob._id.toString(),
        projectId: session.projectId,
        assetId: session.assetId,
        rawKey: session.rawKey,
        userId: req.user!.id,
      });

      analysisJob.queueJobId = bullJob.id;
      await analysisJob.save();

      res.status(202).json({
        success: true,
        data: {
          assetId: session.assetId,
          analysisJobId: `job_${analysisJob._id.toString()}`,
          state: 'queued',
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async abortUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const uploadId = req.params.id;
      const session = await UploadSessionStore.getSession(uploadId);

      if (session) {
        // Enforce tenant ownership
        if (session.userId !== req.user!.id && session.userId !== req.user!._id?.toString()) {
          throw new AppError(403, 'FORBIDDEN', 'Unauthorized: You do not own this upload session');
        }

        try {
          await S3Service.abortMultipartUpload(session.rawKey, uploadId);
        } catch (s3Err: any) {
          console.warn('[Uploads] Error aborting S3 multipart upload:', s3Err.message);
        }
        await UploadSessionStore.deleteSession(uploadId);
      }

      res.status(200).json({
        success: true,
        data: { aborted: true, uploadId },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}



