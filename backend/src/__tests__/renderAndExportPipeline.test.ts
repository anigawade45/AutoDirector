import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RendersController } from '../controllers/rendersController.js';
import { JobsController } from '../controllers/jobsController.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { QuotaService } from '../services/auth/quotaService.js';
import { S3Service } from '../services/storage/s3Service.js';
import { previewQueue, renderQueue, JobEventsPublisher } from '../services/queue/queueService.js';
import { Request, Response } from 'express';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    findOne: vi.fn(),
  },
}));

vi.mock('../services/auth/quotaService.js', () => ({
  QuotaService: {
    checkRenderMinutesQuota: vi.fn().mockResolvedValue(true),
    incrementRenderMinutes: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    getPresignedDownloadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.amazonaws.com/test-bucket/final_render.mp4?expires=3600'),
  },
}));

vi.mock('../services/queue/queueService.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    previewQueue: {
      add: vi.fn().mockResolvedValue({ id: 'bull_preview_job_1' }),
    },
    renderQueue: {
      add: vi.fn().mockResolvedValue({ id: 'bull_export_job_1' }),
    },
    JobEventsPublisher: {
      publishProgress: vi.fn().mockResolvedValue(true),
    },
  };
});

describe('Asynchronous Render and Export Pipeline Suite', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: any;
  let jsonMock: any;
  let statusMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    nextFn = vi.fn();
  });

  describe('1. Preview Proxy Pipeline (POST /api/projects/:id/preview)', () => {
    it('enqueues a 480p preview job and returns 202 Accepted with eventsUrl', async () => {
      const mockProject: any = {
        _id: '672b11111111111111111111',
        publicId: 'prj_preview_test',
        headVersion: 2,
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const mockSnapshot: any = {
        projectId: mockProject._id,
        version: 2,
        snapshotHash: 'hash_abc123',
      };
      (TimelineVersionModel.findOne as any).mockResolvedValue(mockSnapshot);

      // No existing completed job for this snapshot
      (RenderJobModel.findOne as any).mockResolvedValue(null);

      const mockCreatedJob: any = {
        _id: '672b22222222222222222222',
        projectId: mockProject._id,
        save: vi.fn().mockResolvedValue(true),
      };
      (RenderJobModel.create as any).mockResolvedValue(mockCreatedJob);

      mockReq = {
        params: { id: 'prj_preview_test' },
        body: { planVersion: 2 },
        user: { _id: '672b99999999999999999999' } as any,
        id: 'req_prev_1',
      };

      await RendersController.enqueuePreview(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(202);
      expect(previewQueue.add).toHaveBeenCalledWith('render-preview', expect.objectContaining({
        projectId: 'prj_preview_test',
        planVersion: 2,
        profile: 'preview_480p',
        type: 'preview',
      }));
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          jobId: 'job_672b22222222222222222222',
          state: 'queued',
          type: 'preview',
          eventsUrl: '/api/jobs/job_672b22222222222222222222/events',
        }),
      }));
    });

    it('returns existing cached preview job (HTTP 200) when identical snapshot is already rendered', async () => {
      const mockProject: any = {
        _id: '672b11111111111111111111',
        publicId: 'prj_cached_test',
        headVersion: 1,
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      (TimelineVersionModel.findOne as any).mockResolvedValue({
        projectId: mockProject._id,
        version: 1,
        snapshotHash: 'identical_hash_123',
      });

      const existingCompletedJob: any = {
        _id: '672b88888888888888888888',
        state: 'completed',
        profile: 'preview_480p',
      };
      (RenderJobModel.findOne as any).mockResolvedValue(existingCompletedJob);

      mockReq = {
        params: { id: 'prj_cached_test' },
        body: {},
        user: { _id: '672b99999999999999999999' } as any,
        id: 'req_prev_reuse',
      };

      await RendersController.enqueuePreview(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(previewQueue.add).not.toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          jobId: 'job_672b88888888888888888888',
          state: 'completed',
          type: 'preview',
          downloadUrl: '/api/jobs/job_672b88888888888888888888/download',
        }),
      }));
    });
  });

  describe('2. Master Export Pipeline & Tier Governance (POST /api/projects/:id/export)', () => {
    it('restricts 4K export profile to Pro/Enterprise tiers and rejects Free tier with 403', async () => {
      const mockProject: any = {
        _id: '672b11111111111111111111',
        publicId: 'prj_4k_test',
        headVersion: 1,
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      mockReq = {
        params: { id: 'prj_4k_test' },
        body: { profile: 'final_4k' },
        user: { _id: '672b99999999999999999999', tier: 'free' } as any,
        id: 'req_4k_gate',
      };

      await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'UPGRADE_REQUIRED',
        })
      );
    });

    it('enqueues 1080p final export to renderQueue for valid tier with sufficient quota', async () => {
      const mockProject: any = {
        _id: '672b11111111111111111111',
        publicId: 'prj_export_ok',
        headVersion: 3,
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      (TimelineVersionModel.findOne as any).mockResolvedValue({
        projectId: mockProject._id,
        version: 3,
        snapshotHash: 'hash_v3',
      });

      const mockExportJob: any = {
        _id: '672b33333333333333333333',
        projectId: mockProject._id,
        save: vi.fn().mockResolvedValue(true),
      };
      (RenderJobModel.create as any).mockResolvedValue(mockExportJob);

      mockReq = {
        params: { id: 'prj_export_ok' },
        body: { profile: 'final_1080p' },
        user: { _id: '672b99999999999999999999', id: '672b99999999999999999999', tier: 'pro' } as any,
        id: 'req_export_1',
      };

      await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

      expect(QuotaService.checkRenderMinutesQuota).toHaveBeenCalledWith('672b99999999999999999999');
      expect(renderQueue.add).toHaveBeenCalledWith('render-export', expect.objectContaining({
        projectId: 'prj_export_ok',
        planVersion: 3,
        profile: 'final_1080p',
        type: 'export',
      }));
      expect(statusMock).toHaveBeenCalledWith(202);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          jobId: 'job_672b33333333333333333333',
          state: 'queued',
          type: 'render',
        }),
      }));
    });
  });

  describe('3. Job Status, Progress & Presigned Download Delivery', () => {
    it('returns 400 when attempting to download an incomplete job', async () => {
      const mockJob: any = {
        _id: '672b44444444444444444444',
        state: 'processing',
        userId: 'usr_owner_1',
      };
      (RenderJobModel.findOne as any).mockResolvedValue(mockJob);

      mockReq = {
        params: { id: 'job_672b44444444444444444444' },
        user: { _id: 'usr_owner_1' } as any,
        id: 'req_dl_1',
      };

      await JobsController.getJobDownload(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'JOB_NOT_READY',
        })
      );
    });

    it('generates a 3600s presigned download URL when job is completed', async () => {
      const mockJob: any = {
        _id: '672b55555555555555555555',
        state: 'completed',
        userId: 'usr_owner_1',
        output: {
          key: 'users/usr_owner_1/projects/prj_1/renders/job_final.mp4',
        },
      };
      (RenderJobModel.findOne as any).mockResolvedValue(mockJob);

      mockReq = {
        params: { id: 'job_672b55555555555555555555' },
        user: { _id: 'usr_owner_1' } as any,
        id: 'req_dl_ok',
      };

      await JobsController.getJobDownload(mockReq as Request, mockRes as Response, nextFn);

      expect(S3Service.getPresignedDownloadUrl).toHaveBeenCalledWith(
        'users/usr_owner_1/projects/prj_1/renders/job_final.mp4',
        3600
      );
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          url: expect.stringContaining('https://s3.amazonaws.com/test-bucket/final_render.mp4'),
          expiresInSeconds: 3600,
        }),
      }));
    });
  });

  describe('4. Lifecycle State Engine & Quota Accounting', () => {
    it('executes monotonic progression and increments render quota upon job completion', async () => {
      const startedAt = new Date(Date.now() - 30000);
      const mockJobDoc: any = {
        _id: '672b66666666666666666666',
        state: 'uploading_output',
        percent: 95,
        type: 'export',
        userId: '672b99999999999999999999',
        projectId: '672b11111111111111111111',
        timelineVersion: 3,
        timings: { queuedAt: new Date(Date.now() - 35000), startedAt },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJobDoc);

      const outputMeta = {
        key: 'users/u1/projects/p1/renders/out_1080p.mp4',
        sizeBytes: 25000000,
        durationMs: 120000, // 2 minutes video
      };

      const completed = await RenderJobLifecycle.transition(
        mockJobDoc._id,
        'completed',
        { output: outputMeta }
      );

      expect(completed?.state).toBe('completed');
      expect(completed?.percent).toBe(100);
      expect(mockJobDoc.save).toHaveBeenCalled();

      // Atomically records 2 minutes of render quota usage
      expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledWith(
        '672b99999999999999999999',
        2
      );

      // Synchronizes associated project
      expect(ProjectModel.updateOne).toHaveBeenCalledWith(
        { _id: mockJobDoc.projectId },
        { $set: { publishedVersion: 3, status: 'ready' } }
      );
    });
  });
});
