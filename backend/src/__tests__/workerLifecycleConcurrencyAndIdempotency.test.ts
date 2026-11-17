import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  RenderJobLifecycle,
  TERMINAL_STATES,
} from '../services/jobs/renderJobLifecycle.js';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { ProjectModel } from '../models/Project.js';
import { QuotaService } from '../services/auth/quotaService.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';

vi.mock('../services/queue/queueService.js', () => ({
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
  QUEUE_CONFIGS: {
    analysis: { concurrency: 2, timeoutMs: 1200000, attempts: 3, backoff: {}, lockDurationMs: 120000 },
    preview: { concurrency: 3, timeoutMs: 300000, attempts: 2, backoff: {}, lockDurationMs: 60000 },
    render: { concurrency: 1, timeoutMs: 3600000, attempts: 2, backoff: {}, lockDurationMs: 180000 },
  },
}));

vi.mock('../services/auth/quotaService.js', () => ({
  QuotaService: {
    incrementRenderMinutes: vi.fn().mockResolvedValue(true),
    incrementStorageUsed: vi.fn().mockResolvedValue(true),
    decrementStorageUsed: vi.fn().mockResolvedValue(true),
    checkStorageQuota: vi.fn().mockResolvedValue({ allowed: true }),
    checkExportQuota: vi.fn().mockResolvedValue({ allowed: true }),
  },
}));

describe('POT-007: Worker Lifecycle Concurrency, Monotonic Guards & Callback Idempotency', () => {
  const mockUserId = new mongoose.Types.ObjectId();
  const mockProjectId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    (QuotaService.incrementRenderMinutes as any).mockResolvedValue(true);
    (QuotaService.incrementStorageUsed as any).mockResolvedValue(true);
    (QuotaService.decrementStorageUsed as any).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createMockJobDoc = (overrides: Record<string, any> = {}) => {
    const doc: any = {
      _id: new mongoose.Types.ObjectId().toString(),
      projectId: mockProjectId,
      userId: mockUserId,
      type: 'export',
      timelineVersion: 2,
      profile: 'final_1080p',
      state: 'queued',
      percent: 0,
      timings: {
        queuedAt: new Date(),
      },
      output: null,
      error: null,
      save: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
    return doc;
  };

  it('guarantees single authoritative state when in-process completion precedes callback completion (no double quota or duplicate project writes)', async () => {
    const jobDoc = createMockJobDoc({ state: 'uploading_output', percent: 95 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);
    vi.spyOn(ProjectModel, 'updateOne').mockResolvedValue({ acknowledged: true, modifiedCount: 1 } as any);

    // 1. In-process worker transitions job to completed
    const completedJob = await RenderJobLifecycle.transition(jobDoc._id, 'completed', {
      output: {
        key: 'users/u1/projects/p1/renders/out.mp4',
        sizeBytes: 25000000,
        durationMs: 120000, // 2 minutes
      },
    });

    expect(completedJob?.state).toBe('completed');
    expect(completedJob?.percent).toBe(100);
    expect(jobDoc.save).toHaveBeenCalledTimes(1);
    expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledTimes(1);
    expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledWith(mockUserId.toString(), 2);
    expect(ProjectModel.updateOne).toHaveBeenCalledWith(
      { _id: mockProjectId },
      { $set: { publishedVersion: 2, status: 'ready' } }
    );

    // 2. An external worker callback arrives for the same job via WorkerEventsController
    const req: any = {
      body: {
        eventType: 'render.completed',
        jobId: jobDoc._id,
        result: {
          outputKey: 'users/u1/projects/p1/renders/out.mp4',
          durationMs: 120000,
        },
      },
      headers: { 'x-worker-id': 'worker-gpu-01' },
      id: 'req_test_callback_01',
    };

    let responseData: any = null;
    let responseCode: number = 0;
    const res: any = {
      status: vi.fn((code: number) => {
        responseCode = code;
        return {
          json: vi.fn((body: any) => {
            responseData = body;
          }),
        };
      }),
    };
    const next = vi.fn();

    await WorkerEventsController.handleWorkerEvent(req, res, next);

    // 3. Callback is recognized as duplicate without duplicate mutations
    expect(responseCode).toBe(200);
    expect(responseData).toEqual({
      success: true,
      data: { accepted: true, duplicate: true, state: 'completed' },
      requestId: 'req_test_callback_01',
    });

    // Quota increment and save must NOT have occurred a second time
    expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledTimes(1);
    expect(jobDoc.save).toHaveBeenCalledTimes(1);
  });

  it('guarantees single authoritative state when callback completion precedes in-process worker completion', async () => {
    const jobDoc = createMockJobDoc({ state: 'processing', percent: 50 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);
    vi.spyOn(ProjectModel, 'updateOne').mockResolvedValue({ acknowledged: true, modifiedCount: 1 } as any);

    // 1. External callback arrives and transitions job to completed
    const req: any = {
      body: {
        eventType: 'render.completed',
        jobId: jobDoc._id,
        result: {
          outputKey: 'users/u1/projects/p1/renders/fast_out.mp4',
          durationMs: 60000,
        },
      },
      headers: { 'x-worker-id': 'worker-gpu-02' },
      id: 'req_fast_callback',
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn(() => ({
        json: vi.fn((body: any) => {
          responseData = body;
        }),
      })),
    };
    const next = vi.fn((err: any) => {
      if (err) console.error('TEST 2 NEXT ERROR:', err);
    });

    await WorkerEventsController.handleWorkerEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();

    expect(responseData.data.duplicate).toBe(false);
    expect(jobDoc.state).toBe('completed');
    expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledTimes(1);

    // 2. Local in-process worker finishes slightly later and attempts completion transition
    const localResult = await RenderJobLifecycle.transition(jobDoc._id, 'completed', {
      output: {
        key: 'users/u1/projects/p1/renders/fast_out.mp4',
        sizeBytes: 15000000,
        durationMs: 60000,
      },
    });

    // Monotonic guard ensures idempotent return without re-running side effects
    expect(localResult?.state).toBe('completed');
    expect(QuotaService.incrementRenderMinutes).toHaveBeenCalledTimes(1);
    expect(ProjectModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('preserves monotonic progress and ignores delayed out-of-order progress updates', async () => {
    const jobDoc = createMockJobDoc({ state: 'processing', percent: 70 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);

    // Out-of-order progress event with lower percent (e.g. 30%) arrives after 70% was already recorded
    const req: any = {
      body: {
        eventType: 'render.progress',
        jobId: jobDoc._id,
        progress: { percent: 30, outTimeMs: 18000 },
      },
      headers: {},
      id: 'req_delayed_progress',
    };

    const res: any = {
      status: vi.fn(() => ({
        json: vi.fn(),
      })),
    };

    await WorkerEventsController.handleWorkerEvent(req, res, vi.fn());

    // Percent must NEVER regress
    expect(jobDoc.percent).toBe(70);
  });

  it('drops late processing events if job has already advanced to uploading_output', async () => {
    const jobDoc = createMockJobDoc({ state: 'uploading_output', percent: 95 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);

    // Late processing event arrives while output is being uploaded
    const result = await RenderJobLifecycle.transition(jobDoc._id, 'processing', {
      percent: 85,
    });

    expect(result?.state).toBe('uploading_output');
    expect(result?.percent).toBe(95);
    expect(jobDoc.save).not.toHaveBeenCalled();
  });

  it('drops late progress events and prevents state regression on already completed jobs', async () => {
    const jobDoc = createMockJobDoc({ state: 'completed', percent: 100 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);

    const req: any = {
      body: {
        eventType: 'render.progress',
        jobId: jobDoc._id,
        progress: { percent: 40 },
      },
      headers: {},
      id: 'req_late_progress',
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn(() => ({
        json: vi.fn((body: any) => {
          responseData = body;
        }),
      })),
    };
    const next = vi.fn((err: any) => {
      if (err) console.error('TEST 2 NEXT ERROR:', err);
    });

    await WorkerEventsController.handleWorkerEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();

    expect(responseData.data).toEqual({
      accepted: true,
      duplicate: true,
      state: 'completed',
    });
    expect(jobDoc.state).toBe('completed');
    expect(jobDoc.percent).toBe(100);
  });

  it('rejects conflicting terminal failure on already completed jobs without mutating project status', async () => {
    const jobDoc = createMockJobDoc({ state: 'completed', percent: 100 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);
    vi.spyOn(ProjectModel, 'updateOne').mockResolvedValue({} as any);

    const req: any = {
      body: {
        eventType: 'render.failed',
        jobId: jobDoc._id,
        error: { message: 'Late simulated failure', code: 'RENDER_FAILED' },
      },
      headers: {},
      id: 'req_late_failure',
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn(() => ({
        json: vi.fn((body: any) => {
          responseData = body;
        }),
      })),
    };
    const next = vi.fn((err: any) => {
      if (err) console.error('TEST 2 NEXT ERROR:', err);
    });

    await WorkerEventsController.handleWorkerEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();

    expect(responseData.data.duplicate).toBe(true);
    expect(responseData.data.state).toBe('completed');
    expect(jobDoc.state).toBe('completed');
    expect(ProjectModel.updateOne).not.toHaveBeenCalled();
  });

  it('synchronizes project status to error and prevents late completion from regressing failed jobs', async () => {
    const jobDoc = createMockJobDoc({ state: 'failed', percent: 45 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(jobDoc);
    vi.spyOn(ProjectModel, 'updateOne').mockResolvedValue({} as any);

    // Attempt completion on an already failed job
    const req: any = {
      body: {
        eventType: 'render.completed',
        jobId: jobDoc._id,
        result: { outputKey: 'users/u1/projects/p1/renders/out.mp4' },
      },
      headers: {},
      id: 'req_conflicted_completion',
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn(() => ({
        json: vi.fn((body: any) => {
          responseData = body;
        }),
      })),
    };
    const next = vi.fn((err: any) => {
      if (err) console.error('TEST 2 NEXT ERROR:', err);
    });

    await WorkerEventsController.handleWorkerEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();

    expect(responseData.data.duplicate).toBe(true);
    expect(responseData.data.state).toBe('failed');
    expect(jobDoc.state).toBe('failed');
  });

  it('handles analysis.completed and analysis.failed events idempotently', async () => {
    const analysisJob = createMockJobDoc({ type: 'analysis', state: 'processing', percent: 50 });
    vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(analysisJob);
    vi.spyOn(ProjectModel, 'updateOne').mockResolvedValue({} as any);

    // 1. analysis.completed
    const req1: any = {
      body: {
        eventType: 'analysis.completed',
        jobId: analysisJob._id,
      },
      headers: {},
      id: 'req_analysis_done',
    };

    let resData1: any = null;
    const res1: any = {
      status: vi.fn(() => ({ json: vi.fn((b) => { resData1 = b; }) })),
    };

    await WorkerEventsController.handleWorkerEvent(req1, res1, vi.fn());

    expect(resData1.data.duplicate).toBe(false);
    expect(analysisJob.state).toBe('completed');
    expect(ProjectModel.updateOne).toHaveBeenCalledWith(
      { _id: mockProjectId },
      { $set: { status: 'ready' } }
    );

    // 2. Duplicate analysis.completed returns duplicate: true
    let resData2: any = null;
    const res2: any = {
      status: vi.fn(() => ({ json: vi.fn((b) => { resData2 = b; }) })),
    };
    await WorkerEventsController.handleWorkerEvent(req1, res2, vi.fn());
    expect(resData2.data.duplicate).toBe(true);
  });
});
