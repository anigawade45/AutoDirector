import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RenderJobLifecycle,
  VALID_STATE_TRANSITIONS,
  TERMINAL_STATES,
} from '../services/jobs/renderJobLifecycle.js';
import {
  QUEUE_CONFIGS,
  analysisQueue,
  previewQueue,
  renderQueue,
} from '../services/queue/queueService.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    JobEventsPublisher: {
      publishProgress: vi.fn().mockResolvedValue(true),
    },
  };
});

describe('Phase 3 Task 1: RenderJob Lifecycle & BullMQ Queue Configurations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BullMQ Queue Configuration & Policies (API Contract §5.1)', () => {
    it('configures analysis queue with concurrency 2, 20m timeout, and 2 retries with exponential backoff', () => {
      const cfg = QUEUE_CONFIGS.analysis;
      expect(cfg.name).toBe('analysis');
      expect(cfg.concurrency).toBe(2);
      expect(cfg.timeoutMs).toBe(20 * 60 * 1000); // 1,200,000 ms
      expect(cfg.attempts).toBe(3); // Initial + 2 retries
      expect(cfg.backoff.type).toBe('exponential');
      expect(cfg.backoff.delay).toBe(5000);
      expect(cfg.lockDurationMs).toBe(120000);
    });

    it('configures preview queue with concurrency 3, 5m timeout, and 1 retry', () => {
      const cfg = QUEUE_CONFIGS.preview;
      expect(cfg.name).toBe('preview');
      expect(cfg.concurrency).toBe(3);
      expect(cfg.timeoutMs).toBe(5 * 60 * 1000); // 300,000 ms
      expect(cfg.attempts).toBe(2); // Initial + 1 retry
      expect(cfg.backoff.type).toBe('fixed');
      expect(cfg.backoff.delay).toBe(3000);
      expect(cfg.lockDurationMs).toBe(60000);
    });

    it('configures render queue with concurrency 1, 60m timeout, and 1 retry', () => {
      const cfg = QUEUE_CONFIGS.render;
      expect(cfg.name).toBe('render');
      expect(cfg.concurrency).toBe(1);
      expect(cfg.timeoutMs).toBe(60 * 60 * 1000); // 3,600,000 ms
      expect(cfg.attempts).toBe(2); // Initial + 1 retry
      expect(cfg.backoff.type).toBe('fixed');
      expect(cfg.backoff.delay).toBe(10000);
      expect(cfg.lockDurationMs).toBe(180000);
    });
  });

  describe('Error Classification & Retryability (API Contract §7.2)', () => {
    it('classifies INPUT_CORRUPT and FILTER_ERROR as non-retryable', () => {
      const corrupt = RenderJobLifecycle.classifyError({
        code: 'INPUT_CORRUPT',
        message: 'Invalid video container',
      });
      expect(corrupt.code).toBe('INPUT_CORRUPT');
      expect(corrupt.retryable).toBe(false);

      const filter = RenderJobLifecycle.classifyError({
        code: 'FILTER_ERROR',
        message: 'FFmpeg filter graph compilation error',
      });
      expect(filter.code).toBe('FILTER_ERROR');
      expect(filter.retryable).toBe(false);
    });

    it('classifies OOM_OR_TIMEOUT and S3_TRANSIENT as retryable', () => {
      const oom = RenderJobLifecycle.classifyError({
        code: 'OOM_OR_TIMEOUT',
        message: 'Worker exceeded memory limit',
      });
      expect(oom.code).toBe('OOM_OR_TIMEOUT');
      expect(oom.retryable).toBe(true);

      const s3 = RenderJobLifecycle.classifyError({
        code: 'S3_TRANSIENT',
        message: 'Connection reset by peer on S3 upload',
      });
      expect(s3.code).toBe('S3_TRANSIENT');
      expect(s3.retryable).toBe(true);
    });
  });

  describe('RenderJob Lifecycle State Machine & Monotonic Transitions', () => {
    it('validates allowed monotonic transitions', () => {
      expect(RenderJobLifecycle.canTransition('queued', 'processing')).toBe(true);
      expect(RenderJobLifecycle.canTransition('processing', 'uploading_output')).toBe(true);
      expect(RenderJobLifecycle.canTransition('uploading_output', 'completed')).toBe(true);
      expect(RenderJobLifecycle.canTransition('processing', 'failed')).toBe(true);
      expect(RenderJobLifecycle.canTransition('queued', 'canceled')).toBe(true);

      // Regressive transitions must be disallowed
      expect(RenderJobLifecycle.canTransition('completed', 'processing')).toBe(false);
      expect(RenderJobLifecycle.canTransition('failed', 'queued')).toBe(false);
      expect(RenderJobLifecycle.canTransition('canceled', 'processing')).toBe(false);
    });

    it('transitions job from queued to processing and sets timings.startedAt', async () => {
      const mockJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'queued',
        percent: 0,
        timings: { queuedAt: new Date(Date.now() - 5000) },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJob);

      const updated = await RenderJobLifecycle.transition(mockJob._id, 'processing', {
        workerId: 'worker-node-01',
        percent: 10,
      });

      expect(updated?.state).toBe('processing');
      expect(updated?.percent).toBe(10);
      expect(updated?.workerId).toBe('worker-node-01');
      expect(updated?.timings.startedAt).toBeInstanceOf(Date);
      expect(mockJob.save).toHaveBeenCalled();
      expect(JobEventsPublisher.publishProgress).toHaveBeenCalledWith(
        mockJob._id,
        expect.objectContaining({ state: 'processing', percent: 10 })
      );
    });

    it('transitions job to completed, sets finishedAt and calculates durationMs', async () => {
      const startedAt = new Date(Date.now() - 15000);
      const mockJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'uploading_output',
        percent: 90,
        timings: { queuedAt: new Date(Date.now() - 20000), startedAt },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJob);

      const outputData = {
        key: 'users/u1/projects/p1/renders/out.mp4',
        sizeBytes: 15400000,
        durationMs: 60000,
      };

      const updated = await RenderJobLifecycle.transition(mockJob._id, 'completed', {
        output: outputData,
      });

      expect(updated?.state).toBe('completed');
      expect(updated?.percent).toBe(100);
      expect(updated?.output).toEqual(outputData);
      expect(updated?.timings.finishedAt).toBeInstanceOf(Date);
      expect(updated?.timings.durationMs).toBeGreaterThanOrEqual(14000);
      expect(mockJob.save).toHaveBeenCalled();
      expect(JobEventsPublisher.publishProgress).toHaveBeenCalledWith(
        mockJob._id,
        expect.objectContaining({ state: 'done', percent: 100, outputKey: outputData.key })
      );
    });

    it('terminal guard: ignores late progress events on already completed or failed jobs', async () => {
      const mockJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'completed',
        percent: 100,
        timings: { finishedAt: new Date() },
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJob);

      // Late progress event from slow worker node
      const result = await RenderJobLifecycle.transition(mockJob._id, 'processing', {
        percent: 45,
      });

      // Must NOT regress
      expect(result?.state).toBe('completed');
      expect(result?.percent).toBe(100);
      expect(mockJob.save).not.toHaveBeenCalled();
    });

    it('rejects invalid state jumps and throws 409 INVALID_STATE_TRANSITION', async () => {
      const mockJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'queued',
        percent: 0,
        timings: {},
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJob);

      // Cannot jump from queued straight to uploading_output
      await expect(
        RenderJobLifecycle.transition(mockJob._id, 'uploading_output', { percent: 90 })
      ).rejects.toThrow('Cannot transition RenderJob');
    });
  });
});
