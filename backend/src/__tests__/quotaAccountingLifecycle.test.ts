import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { QuotaService } from '../services/auth/quotaService.js';
import { UploadsController } from '../controllers/uploadsController.js';
import { RendersController } from '../controllers/rendersController.js';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { PurgeService } from '../services/maintenance/purgeService.js';
import { ProjectsController } from '../controllers/projectsController.js';
import { UserModel } from '../models/User.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { S3Service } from '../services/storage/s3Service.js';
import { UploadSessionStore } from '../services/storage/uploadSessionStore.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';

vi.mock('../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    findOne: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/ChatMessage.js', () => ({
  ChatMessageModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    createMultipartUpload: vi.fn(),
    completeMultipartUpload: vi
      .fn()
      .mockResolvedValue({ location: 'https://s3.example.com/asset.mp4' }),
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    deleteObjectsByPrefix: vi.fn().mockResolvedValue(3),
    fileExists: vi.fn().mockResolvedValue(true),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/download.mp4'),
  },
}));

vi.mock('../services/storage/uploadSessionStore.js', () => ({
  UploadSessionStore: {
    saveSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  analysisQueue: { add: vi.fn().mockResolvedValue({ id: 'bull_analysis_1' }) },
  previewQueue: { add: vi.fn().mockResolvedValue({ id: 'bull_preview_1' }) },
  renderQueue: { add: vi.fn().mockResolvedValue({ id: 'bull_render_1' }) },
  JobEventsPublisher: { publishProgress: vi.fn().mockResolvedValue(undefined) },
}));

describe('POT-002: Quota Accounting & Usage Lifecycle Integration Suite', () => {
  const userId = new mongoose.Types.ObjectId('672b11112222333344445555');
  const projectId = new mongoose.Types.ObjectId('672b99998888777766665555');
  const userObjectId = userId;

  let mockRes: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let nextFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    nextFn = vi.fn();

    (UserModel.findById as any).mockResolvedValue({
      _id: userId,
      tier: 'free',
      quota: {
        storageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
        renderMinutes: 60,
        promptsPerDay: 100,
      },
      usage: {
        storageBytesUsed: 1 * 1024 * 1024 * 1024, // 1 GB used
        renderMinutesUsed: 20,
        promptsToday: 10,
        lastPromptDate: new Date().toISOString().split('T')[0],
      },
    });
  });

  describe('1. Upload Completion Storage Quota Accounting', () => {
    it('atomically increments User.usage.storageBytesUsed on completeUpload', async () => {
      const uploadId = 'upload_session_abc123';
      const uploadBytes = 250 * 1024 * 1024; // 250 MB

      (UploadSessionStore.getSession as any).mockResolvedValue({
        userId: userId.toString(),
        projectId: 'prj_test_123',
        assetId: 'ast_test_123',
        rawKey: 'users/test/raw.mp4',
        sizeBytes: uploadBytes,
        contentType: 'video/mp4',
        totalParts: 2,
      });

      (ProjectModel.findOne as any).mockResolvedValue({
        _id: projectId,
        publicId: 'prj_test_123',
        save: vi.fn().mockResolvedValue(true),
      });

      (AssetModel.create as any).mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        publicId: 'ast_test_123',
      });

      (RenderJobModel.create as any).mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        save: vi.fn().mockResolvedValue(true),
      });

      const req = {
        params: { id: uploadId },
        body: {
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 2, etag: '"etag-2"' },
          ],
        },
        user: { _id: userId, id: userId.toString(), email: 'creator@studio.ai', tier: 'free' },
        id: 'req_upload_complete',
      } as unknown as Request;

      await UploadsController.completeUpload(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(S3Service.completeMultipartUpload).toHaveBeenCalledWith(
        'users/test/raw.mp4',
        uploadId,
        req.body.parts
      );

      // Verifies storage quota increment
      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId.toString() },
        { $inc: { 'usage.storageBytesUsed': uploadBytes } }
      );

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ assetId: 'ast_test_123' }),
        })
      );
    });

    it('rejects createUpload when requested file size exceeds remaining storage quota', async () => {
      (UserModel.findById as any).mockResolvedValue({
        _id: userId,
        tier: 'free',
        quota: { storageBytes: 5 * 1024 * 1024 * 1024 }, // 5 GB limit
        usage: { storageBytesUsed: 4.8 * 1024 * 1024 * 1024 }, // 4.8 GB used -> 200 MB remaining
      });

      (ProjectModel.findOne as any).mockResolvedValue({
        _id: projectId,
        publicId: 'prj_test_123',
      });

      const req = {
        body: {
          projectId: 'prj_test_123',
          fileName: 'large_video.mp4',
          contentType: 'video/mp4',
          sizeBytes: 500 * 1024 * 1024, // 500 MB requested (exceeds 200MB remaining)
        },
        user: { _id: userId, id: userId.toString(), email: 'creator@studio.ai', tier: 'free' },
        id: 'req_quota_check',
      } as unknown as Request;

      await UploadsController.createUpload(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'QUOTA_EXCEEDED',
          message: expect.stringContaining('Storage quota exceeded'),
        })
      );
      expect(S3Service.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('does not increment storage quota when upload is aborted', async () => {
      (UploadSessionStore.getSession as any).mockResolvedValue({
        userId: userId.toString(),
        rawKey: 'users/test/raw.mp4',
      });

      const req = {
        params: { id: 'upload_session_aborted' },
        user: { _id: userId, id: userId.toString(), email: 'creator@studio.ai', tier: 'free' },
        id: 'req_abort',
      } as unknown as Request;

      await UploadsController.abortUpload(req, mockRes as unknown as Response, nextFn);

      expect(S3Service.abortMultipartUpload).toHaveBeenCalledWith(
        'users/test/raw.mp4',
        'upload_session_aborted'
      );
      expect(UploadSessionStore.deleteSession).toHaveBeenCalledWith('upload_session_aborted');

      // Ensures zero storage increment on abort
      expect(UserModel.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $inc: expect.objectContaining({ 'usage.storageBytesUsed': expect.anything() }),
        })
      );
    });
  });

  describe('2. Render & Export Quota Accounting on Completion', () => {
    it('atomically increments renderMinutesUsed upon export completion via RenderJobLifecycle', async () => {
      const exportJobId = new mongoose.Types.ObjectId();
      const mockJobDocument = {
        _id: exportJobId,
        userId,
        projectId,
        type: 'export',
        profile: 'final_1080p',
        state: 'processing',
        percent: 60,
        timings: { startedAt: new Date(Date.now() - 150000) }, // 2.5 minutes elapsed
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJobDocument);

      // Transition to completed with output metadata: 180,000 ms duration = 3 minutes
      const result = await RenderJobLifecycle.transition(exportJobId.toString(), 'completed', {
        output: {
          key: 'users/export.mp4',
          sizeBytes: 15000000,
          durationMs: 180000, // 3 minutes rendered
        },
      });

      expect(result).toBeDefined();
      expect(mockJobDocument.save).toHaveBeenCalled();

      // Verifies 3 render minutes incremented on user model
      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId.toString() },
        { $inc: { 'usage.renderMinutesUsed': 3 } }
      );
    });

    it('atomically increments renderMinutesUsed for job.type === "render"', async () => {
      const renderJobId = new mongoose.Types.ObjectId();
      const mockJobDocument = {
        _id: renderJobId,
        userId,
        projectId,
        type: 'render',
        profile: 'final_1080p',
        state: 'processing',
        percent: 85,
        timings: { startedAt: new Date(Date.now() - 90000) },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJobDocument);

      await RenderJobLifecycle.transition(renderJobId.toString(), 'completed', {
        output: {
          key: 'users/render_out.mp4',
          sizeBytes: 20000000,
          durationMs: 120000, // 2 minutes
        },
      });

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId.toString() },
        { $inc: { 'usage.renderMinutesUsed': 2 } }
      );
    });

    it('does NOT increment render minutes when an export render fails', async () => {
      const failJobId = new mongoose.Types.ObjectId();
      const mockJobDocument = {
        _id: failJobId,
        userId,
        projectId,
        type: 'export',
        state: 'processing',
        percent: 40,
        timings: { startedAt: new Date() },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJobDocument);

      await RenderJobLifecycle.transition(failJobId.toString(), 'failed', {
        error: { code: 'FILTER_ERROR', message: 'FFmpeg filter graph failed' },
      });

      expect(mockJobDocument.save).toHaveBeenCalled();

      // Ensures no render minutes charged for failed render
      expect(UserModel.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $inc: expect.objectContaining({ 'usage.renderMinutesUsed': expect.anything() }),
        })
      );
    });

    it('blocks enqueueExport with HTTP 403 QUOTA_EXCEEDED when monthly limit is exhausted', async () => {
      (UserModel.findById as any).mockResolvedValue({
        _id: userId,
        tier: 'free',
        quota: { renderMinutes: 60 },
        usage: { renderMinutesUsed: 60 }, // 100% of quota exhausted
      });

      (ProjectModel.findOne as any).mockResolvedValue({
        _id: projectId,
        publicId: 'prj_test_export',
        headVersion: 1,
      });

      const req = {
        params: { id: 'prj_test_export' },
        body: { profile: 'final_1080p' },
        user: { _id: userId, id: userId.toString(), tier: 'free' },
        id: 'req_export_quota',
      } as unknown as Request;

      await RendersController.enqueueExport(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'QUOTA_EXCEEDED',
          message: expect.stringContaining('Monthly render quota of 60 minutes exceeded'),
        })
      );
    });
  });

  describe('3. Storage Quota Decrement on Project Purge', () => {
    it('decrements storageBytesUsed by the total media bytes of deleted assets upon purge', async () => {
      const asset1Bytes = 100 * 1024 * 1024;
      const asset2Bytes = 150 * 1024 * 1024;
      const totalFreed = asset1Bytes + asset2Bytes; // 250 MB

      (ProjectModel.findOne as any).mockResolvedValue({
        _id: projectId,
        publicId: 'prj_to_purge',
        userId,
      });

      (AssetModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId(), media: { sizeBytes: asset1Bytes } },
        { _id: new mongoose.Types.ObjectId(), media: { sizeBytes: asset2Bytes } },
      ]);

      (UserModel.findById as any).mockResolvedValue({
        _id: userId,
        usage: { storageBytesUsed: 500 * 1024 * 1024 }, // 500 MB used -> 250 MB after decrement
      });

      const purgeResult = await PurgeService.purgeProjectData(userId.toString(), 'prj_to_purge');

      expect(purgeResult.success).toBe(true);
      expect(S3Service.deleteObjectsByPrefix).toHaveBeenCalledWith(
        `users/${userId.toString()}/projects/prj_to_purge/`
      );

      // Verifies storage quota decremented to new balance (250 MB)
      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId.toString() },
        { $set: { 'usage.storageBytesUsed': 250 * 1024 * 1024 } }
      );
    });

    it('triggers immediate purge and storage reclamation when DELETE /api/projects/:id?purge=true is called', async () => {
      (ProjectModel.findOne as any).mockResolvedValue({
        _id: projectId,
        publicId: 'prj_query_purge',
        userId,
      });

      (AssetModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId(), media: { sizeBytes: 50000000 } },
      ]);

      (UserModel.findById as any).mockResolvedValue({
        _id: userId,
        usage: { storageBytesUsed: 100000000 },
      });

      const req = {
        params: { id: 'prj_query_purge' },
        query: { purge: 'true' },
        user: { _id: userId, id: userId.toString() },
        id: 'req_delete_purge',
      } as unknown as Request;

      await ProjectsController.deleteProject(req, mockRes as unknown as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ success: true, projectId: 'prj_query_purge' }),
        })
      );
    });
  });

  describe('4. Periodic & On-Demand Quota Reconciliation', () => {
    it('reconciles User.usage.storageBytesUsed against actual active assets in MongoDB', async () => {
      // Simulate drift: user document has 800 MB recorded, but actual active assets only equal 350 MB
      (AssetModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId(), media: { sizeBytes: 150 * 1024 * 1024 } },
        { _id: new mongoose.Types.ObjectId(), media: { sizeBytes: 200 * 1024 * 1024 } },
      ]);

      const reconciledBytes = await QuotaService.reconcileUserStorageQuota(userId);

      expect(reconciledBytes).toBe(350 * 1024 * 1024);
      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userObjectId },
        { $set: { 'usage.storageBytesUsed': 350 * 1024 * 1024 } }
      );
    });

    it('returns user quota and usage snapshot via getUserUsage', async () => {
      const usageSnapshot = await QuotaService.getUserUsage(userId);

      expect(usageSnapshot).not.toBeNull();
      expect(usageSnapshot?.tier).toBe('free');
      expect(usageSnapshot?.quota.storageBytes).toBe(5 * 1024 * 1024 * 1024);
      expect(usageSnapshot?.usage.renderMinutesUsed).toBe(20);
    });
  });
});
