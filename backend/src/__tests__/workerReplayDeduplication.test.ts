import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Request, Response } from 'express';
import {
  verifyWorkerSignature,
  checkAndMarkWorkerEventProcessed,
  resetWorkerAuthReplayCache,
  getInMemoryFallbackReplaySize,
} from '../middleware/workerAuth.js';
import { env } from '../config/env.js';
import { redisConnection } from '../config/redis.js';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
  },
}));

vi.mock('../services/jobs/renderJobLifecycle.js', () => ({
  RenderJobLifecycle: {
    transition: vi.fn(),
  },
  TERMINAL_STATES: ['completed', 'failed', 'canceled'],
}));

describe('SEC-004: Distributed Worker Event Replay Deduplication & Idempotency Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkerAuthReplayCache();
  });

  describe('1. Distributed Redis SET NX Deduplication', () => {
    it('calls Redis SET with EX 600 and NX flag and correctly flags duplicates', async () => {
      const eventId = 'evt_redis_nx_test_01';
      const redisStore = new Set<string>();

      const mockRedisSet = vi.fn(
        async (key: string, val: string, exFlag: string, ttl: number, nxFlag: string) => {
          if (nxFlag === 'NX' && redisStore.has(key)) {
            return null; // Key already exists (duplicate)
          }
          redisStore.add(key);
          return 'OK'; // Key newly set
        }
      );

      const originalSet = (redisConnection as any).set;
      (redisConnection as any).set = mockRedisSet;

      try {
        // First delivery: not a replay
        const firstIsReplay = await checkAndMarkWorkerEventProcessed(eventId);
        expect(firstIsReplay).toBe(false);
        expect(mockRedisSet).toHaveBeenCalledWith(`worker:event:${eventId}`, '1', 'EX', 600, 'NX');

        // Second delivery: replay detected
        const secondIsReplay = await checkAndMarkWorkerEventProcessed(eventId);
        expect(secondIsReplay).toBe(true);
      } finally {
        (redisConnection as any).set = originalSet;
      }
    });

    it('handles Redis error or timeout gracefully by falling back to local sliding cache', async () => {
      const eventId = 'evt_redis_error_test_02';

      const mockRedisSet = vi.fn().mockRejectedValue(new Error('Redis connection refused'));
      const originalSet = (redisConnection as any).set;
      (redisConnection as any).set = mockRedisSet;

      try {
        // First delivery: fallback stores in memory
        const firstIsReplay = await checkAndMarkWorkerEventProcessed(eventId);
        expect(firstIsReplay).toBe(false);
        expect(getInMemoryFallbackReplaySize()).toBeGreaterThanOrEqual(1);

        // Second delivery: fallback detects duplicate from memory
        const secondIsReplay = await checkAndMarkWorkerEventProcessed(eventId);
        expect(secondIsReplay).toBe(true);
      } finally {
        (redisConnection as any).set = originalSet;
      }
    });
  });

  describe('2. Cross-Instance & Process Restart Verification', () => {
    it('detects replay across separate server instances even after local cache is wiped', async () => {
      const sharedRedisStore = new Map<string, string>();

      const mockRedisSet = vi.fn(
        async (key: string, val: string, _ex: string, _ttl: number, nx: string) => {
          if (nx === 'NX' && sharedRedisStore.has(key)) {
            return null;
          }
          sharedRedisStore.set(key, val);
          return 'OK';
        }
      );

      const originalSet = (redisConnection as any).set;
      (redisConnection as any).set = mockRedisSet;

      try {
        const now = Math.floor(Date.now() / 1000);
        const eventId = `evt_cluster_node_${Date.now()}`;
        const body = {
          eventType: 'render.progress',
          jobId: 'job_cross_instance_test',
          progress: { percent: 45 },
        };
        const rawBody = JSON.stringify(body);
        const signature = crypto
          .createHmac('sha256', env.INTERNAL_WORKER_SECRET)
          .update(rawBody)
          .digest('hex');

        // Instance 1 processes the event
        const req1 = {
          headers: {
            'x-worker-id': 'worker-node-alpha',
            'x-event-id': eventId,
            'x-event-timestamp': String(now),
            'x-event-signature': `sha256=${signature}`,
          },
          body,
          id: 'req_inst_alpha',
        } as unknown as Request;

        let instance1Next = false;
        const res1 = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response;

        await verifyWorkerSignature(req1, res1, () => {
          instance1Next = true;
        });

        expect(instance1Next).toBe(true);
        expect(sharedRedisStore.has(`worker:event:${eventId}`)).toBe(true);

        // Simulate Instance 2 receiving the duplicate event (fresh process with empty local cache)
        resetWorkerAuthReplayCache();
        expect(getInMemoryFallbackReplaySize()).toBe(0);

        const req2 = {
          headers: {
            'x-worker-id': 'worker-node-beta',
            'x-event-id': eventId,
            'x-event-timestamp': String(now),
            'x-event-signature': `sha256=${signature}`,
          },
          body,
          id: 'req_inst_beta',
        } as unknown as Request;

        let instance2Next = false;
        const res2 = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response;

        await verifyWorkerSignature(req2, res2, () => {
          instance2Next = true;
        });

        // Instance 2 must intercept duplicate without invoking next()
        expect(instance2Next).toBe(false);
        expect(res2.status).toHaveBeenCalledWith(200);
        expect(res2.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: { accepted: true, duplicate: true },
          })
        );
      } finally {
        (redisConnection as any).set = originalSet;
      }
    });
  });

  describe('3. Cryptographic Signature & Clock Skew Guardrails', () => {
    it('rejects worker events missing mandatory headers with HTTP 401 WORKER_AUTH_MISSING_HEADERS', async () => {
      const req = {
        headers: {
          'x-worker-id': 'worker-01',
          // Missing x-event-id, x-event-timestamp, x-event-signature
        },
        body: {},
      } as unknown as Request;

      let nextErr: any = null;
      await verifyWorkerSignature(req, {} as Response, (err) => {
        nextErr = err;
      });

      expect(nextErr).toBeDefined();
      expect(nextErr.statusCode).toBe(401);
      expect(nextErr.code).toBe('WORKER_AUTH_MISSING_HEADERS');
    });

    it('rejects worker events with timestamp exceeding 5-minute clock skew window', async () => {
      const now = Math.floor(Date.now() / 1000);
      const staleTimestamp = now - 305; // 305 seconds ago (> 300s window)

      const req = {
        headers: {
          'x-worker-id': 'worker-01',
          'x-event-id': 'evt_stale_skew',
          'x-event-timestamp': String(staleTimestamp),
          'x-event-signature': 'sha256=abcdef123456',
        },
        body: {},
      } as unknown as Request;

      let nextErr: any = null;
      await verifyWorkerSignature(req, {} as Response, (err) => {
        nextErr = err;
      });

      expect(nextErr).toBeDefined();
      expect(nextErr.statusCode).toBe(401);
      expect(nextErr.code).toBe('WORKER_AUTH_CLOCK_SKEW');
    });

    it('rejects worker events with forged or tampered HMAC signature', async () => {
      const now = Math.floor(Date.now() / 1000);

      const req = {
        headers: {
          'x-worker-id': 'worker-01',
          'x-event-id': 'evt_forged_sig',
          'x-event-timestamp': String(now),
          'x-event-signature':
            'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body: { eventType: 'render.completed', jobId: 'job_123' },
      } as unknown as Request;

      let nextErr: any = null;
      await verifyWorkerSignature(req, {} as Response, (err) => {
        nextErr = err;
      });

      expect(nextErr).toBeDefined();
      expect(nextErr.statusCode).toBe(401);
      expect(nextErr.code).toBe('WORKER_AUTH_INVALID_SIGNATURE');
    });
  });

  describe('4. Idempotent Controller & Terminal State Machine Guard', () => {
    it('returns 200 with duplicate=true and prevents state regressions when job is already in a terminal state', async () => {
      (RenderJobModel.findById as any).mockResolvedValue({
        _id: 'target_job_completed',
        state: 'completed',
        percent: 100,
      });

      const req = {
        body: {
          eventType: 'render.progress',
          jobId: 'job_target_job_completed',
          progress: { percent: 60 },
        },
        headers: { 'x-worker-id': 'worker-01' },
        id: 'req_terminal_guard',
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const nextFn = vi.fn();

      await WorkerEventsController.handleWorkerEvent(req, res, nextFn);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            accepted: true,
            duplicate: true,
            state: 'completed',
          }),
        })
      );
      expect(RenderJobLifecycle.transition).not.toHaveBeenCalled();
      expect(nextFn).not.toHaveBeenCalled();
    });
  });
});
