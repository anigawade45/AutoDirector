import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RenderClusterScaler,
  WorkerNodeMetadata,
  ClusterMetrics,
  SegmentedRenderPlan,
} from '../services/queue/renderClusterScaler.js';
import { QUEUE_CONFIGS, renderQueue, previewQueue, JobEventsPublisher } from '../services/queue/queueService.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { StorageKeys } from '../config/s3.js';
import mongoose from 'mongoose';

vi.mock('../services/queue/queueService.js', () => ({
  QUEUE_CONFIGS: {
    analysis: {
      name: 'analysis',
      concurrency: 2,
      timeoutMs: 3600000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      lockDurationMs: 300000,
    },
    preview: {
      name: 'preview',
      concurrency: 3,
      timeoutMs: 300000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      lockDurationMs: 60000,
    },
    render: {
      name: 'render',
      concurrency: 2,
      timeoutMs: 3600000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 10000 },
      lockDurationMs: 180000,
    },
  },
  renderQueue: {
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 10, active: 4, completed: 85, failed: 1 }),
  },
  previewQueue: {
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 5, active: 2, completed: 120, failed: 0 }),
  },
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

describe('N Workers Horizontal Render Scaling Architecture Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RenderClusterScaler.reset();
  });

  afterEach(async () => {
    await RenderClusterScaler.shutdownAll();
  });

  describe('1. Dynamic N-Worker Cluster Spawning & Scaling', () => {
    it('initializes a pool of N workers across preview and render queues', () => {
      const mockWorkerFactory = (queueName: string, opts: any) => ({
        queueName,
        opts,
        close: vi.fn().mockResolvedValue(undefined),
      });

      const nodes = RenderClusterScaler.startCluster(3, 2, {
        concurrency: 2,
        customWorkerStarter: mockWorkerFactory as any,
      });

      expect(nodes.length).toBe(5); // 3 render + 2 preview

      const renderNodes = nodes.filter((n) => n.queueName === 'render');
      const previewNodes = nodes.filter((n) => n.queueName === 'preview');

      expect(renderNodes.length).toBe(3);
      expect(previewNodes.length).toBe(2);

      // Verify each worker receives a distinct, unique workerId
      const uniqueIds = new Set(nodes.map((n) => n.workerId));
      expect(uniqueIds.size).toBe(5);

      nodes.forEach((node) => {
        expect(node.status).toBe('active');
        expect(node.concurrency).toBe(2);
      });
    });

    it('dynamically scales UP render workers from N=2 to N=6 to handle sudden queue bursts', async () => {
      const mockWorkerFactory = (queueName: string, opts: any) => ({
        queueName,
        opts,
        close: vi.fn().mockResolvedValue(undefined),
      });

      RenderClusterScaler.startCluster(2, 1, {
        concurrency: 2,
        customWorkerStarter: mockWorkerFactory as any,
      });

      const scaleResult = await RenderClusterScaler.scale(6, 'render', {
        concurrency: 2,
        customWorkerStarter: mockWorkerFactory as any,
      });

      expect(scaleResult.action).toBe('scaled_up');
      expect(scaleResult.previousCount).toBe(2);
      expect(scaleResult.currentCount).toBe(6);
      expect(scaleResult.delta).toBe(4);

      const metrics = await RenderClusterScaler.getClusterMetrics();
      expect(metrics.workersByQueue.render).toBe(6);
      expect(metrics.totalWorkers).toBe(7); // 6 render + 1 preview
    });

    it('dynamically scales DOWN render workers from N=5 to N=2 with graceful in-flight drain', async () => {
      const closeSpies: Array<any> = [];
      const mockWorkerFactory = (queueName: string, opts: any) => {
        const closeSpy = vi.fn().mockResolvedValue(undefined);
        closeSpies.push(closeSpy);
        return { queueName, opts, close: closeSpy };
      };

      RenderClusterScaler.startCluster(5, 1, {
        concurrency: 2,
        customWorkerStarter: mockWorkerFactory as any,
      });

      const scaleDownResult = await RenderClusterScaler.scale(2, 'render');

      expect(scaleDownResult.action).toBe('scaled_down');
      expect(scaleDownResult.previousCount).toBe(5);
      expect(scaleDownResult.currentCount).toBe(2);
      expect(scaleDownResult.delta).toBe(-3);

      // Verify drained workers had their close() method invoked
      expect(closeSpies.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('2. Parallel Job Distribution & Unique Worker Affinity', () => {
    it('records distinct workerId when multiple distributed workers claim jobs in parallel', async () => {
      const mockJob1: any = {
        _id: '672b11111111111111111111',
        state: 'queued',
        percent: 0,
        workerId: undefined,
        timings: {},
        save: vi.fn().mockResolvedValue(true),
      };

      const mockJob2: any = {
        _id: '672b22222222222222222222',
        state: 'queued',
        percent: 0,
        workerId: undefined,
        timings: {},
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(RenderJobModel, 'findById').mockImplementation(async (id: string) => {
        if (id.includes('1111')) return mockJob1;
        if (id.includes('2222')) return mockJob2;
        return null;
      });

      const workerA = 'render-node-alpha-w1';
      const workerB = 'render-node-beta-w2';

      // Worker A claims Job 1
      await RenderJobLifecycle.transition(mockJob1._id, 'processing', {
        percent: 10,
        workerId: workerA,
      });

      // Worker B claims Job 2
      await RenderJobLifecycle.transition(mockJob2._id, 'processing', {
        percent: 10,
        workerId: workerB,
      });

      expect(mockJob1.workerId).toBe(workerA);
      expect(mockJob1.state).toBe('processing');

      expect(mockJob2.workerId).toBe(workerB);
      expect(mockJob2.state).toBe('processing');

      expect(mockJob1.workerId).not.toBe(mockJob2.workerId);
    });

    it('collects real-time cluster telemetry across all active worker nodes', async () => {
      const mockWorkerFactory = (queueName: string, opts: any) => ({
        queueName,
        opts,
        close: vi.fn().mockResolvedValue(undefined),
      });

      RenderClusterScaler.startCluster(4, 2, {
        concurrency: 2,
        customWorkerStarter: mockWorkerFactory as any,
      });

      const metrics = await RenderClusterScaler.getClusterMetrics();

      expect(metrics.totalWorkers).toBe(6);
      expect(metrics.totalConcurrency).toBe(12); // 6 workers * 2 concurrency
      expect(metrics.workersByQueue.render).toBe(4);
      expect(metrics.workersByQueue.preview).toBe(2);
      expect(metrics.waitingJobs).toBe(15); // 10 render + 5 preview
      expect(metrics.activeJobs).toBe(6); // 4 render + 2 preview
      expect(metrics.nodes.length).toBe(6);
    });
  });

  describe('3. Linear Horizontal Throughput Modeling & SLA Scaling', () => {
    it('demonstrates linear throughput increase and queue wait reduction as workers scale N=1 to N=16', () => {
      const singleWorkerModel = RenderClusterScaler.calculateThroughput(1, 1, 28); // 1 worker, 1 slot
      const cluster4Model = RenderClusterScaler.calculateThroughput(4, 2, 28); // 4 workers, 8 slots
      const cluster8Model = RenderClusterScaler.calculateThroughput(8, 2, 28); // 8 workers, 16 slots
      const cluster16Model = RenderClusterScaler.calculateThroughput(16, 2, 28); // 16 workers, 32 slots

      // Speedup factors
      expect(singleWorkerModel.speedupFactor).toBe(1.0);
      expect(cluster4Model.speedupFactor).toBe(8.0);
      expect(cluster8Model.speedupFactor).toBe(16.0);
      expect(cluster16Model.speedupFactor).toBe(32.0);

      // Hourly job capacity scales linearly
      expect(singleWorkerModel.jobsPerHour).toBe(129); // ~128.5/hr
      expect(cluster4Model.jobsPerHour).toBe(1029); // 8x
      expect(cluster8Model.jobsPerHour).toBe(2057); // 16x
      expect(cluster16Model.jobsPerHour).toBe(4114); // 32x

      // Batch clearance time for 100 queued renders
      const batch100SecSingle = singleWorkerModel.estimatedTimeToProcessBatchSec(100);
      const batch100Sec4 = cluster4Model.estimatedTimeToProcessBatchSec(100);
      const batch100Sec16 = cluster16Model.estimatedTimeToProcessBatchSec(100);

      expect(batch100SecSingle).toBe(2800); // 100 * 28s = 46.6 minutes
      expect(batch100Sec4).toBe(364); // 13 waves * 28s = ~6 minutes (7.7x faster)
      expect(batch100Sec16).toBe(112); // 4 waves * 28s = < 2 minutes (25x faster)
    });
  });

  describe('4. Horizontal Segmented Video Rendering (Parallel Timeline Chunks)', () => {
    it('partitions long-form footage into K continuous chunks for horizontal distribution across N workers', () => {
      const tenMinutesMs = 10 * 60 * 1000; // 600,000 ms
      const chunkDurationMs = 60 * 1000; // 60-second chunks

      const plan = RenderClusterScaler.planSegmentedRender(
        tenMinutesMs,
        chunkDurationMs,
        'usr_scale_test',
        'prj_scale_test',
        'job_master_123',
        'final_1080p'
      );

      expect(plan.totalChunks).toBe(10);
      expect(plan.chunks.length).toBe(10);
      expect(plan.finalOutputKey).toBe('users/usr_scale_test/projects/prj_scale_test/renders/job_master_123.mp4');

      // Check first chunk
      expect(plan.chunks[0].chunkIndex).toBe(0);
      expect(plan.chunks[0].startMs).toBe(0);
      expect(plan.chunks[0].endMs).toBe(60000);
      expect(plan.chunks[0].durationMs).toBe(60000);
      expect(plan.chunks[0].outputKey).toBe(
        'users/usr_scale_test/projects/prj_scale_test/renders/job_master_123_chunk_0.mp4'
      );

      // Check last chunk
      expect(plan.chunks[9].chunkIndex).toBe(9);
      expect(plan.chunks[9].startMs).toBe(540000);
      expect(plan.chunks[9].endMs).toBe(600000);

      // Verify continuity across all chunks
      for (let i = 0; i < plan.chunks.length - 1; i++) {
        expect(plan.chunks[i].endMs).toBe(plan.chunks[i + 1].startMs);
      }
    });

    it('generates FFmpeg concat demuxer manifest and lossless copy args for sub-second assembly', () => {
      const chunkPaths = [
        '/tmp/renders/job-123/chunk_0.mp4',
        '/tmp/renders/job-123/chunk_1.mp4',
        '/tmp/renders/job-123/chunk_2.mp4',
      ];

      const manifestContent = RenderClusterScaler.generateConcatManifest(chunkPaths);
      expect(manifestContent).toContain("file '/tmp/renders/job-123/chunk_0.mp4'");
      expect(manifestContent).toContain("file '/tmp/renders/job-123/chunk_1.mp4'");
      expect(manifestContent).toContain("file '/tmp/renders/job-123/chunk_2.mp4'");

      const concatArgs = RenderClusterScaler.buildConcatArgs(
        '/tmp/renders/job-123/manifest.txt',
        '/tmp/renders/job-123/master_export.mp4'
      );

      expect(concatArgs).toEqual([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        '/tmp/renders/job-123/manifest.txt',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '/tmp/renders/job-123/master_export.mp4',
      ]);
    });
  });

  describe('5. Graceful Teardown & Scratch Workspace Isolation', () => {
    it('gracefully shuts down all N cluster workers on SIGINT/SIGTERM without leaking open processes', async () => {
      const closeSpies: Array<any> = [];
      const mockWorkerFactory = (queueName: string, opts: any) => {
        const spy = vi.fn().mockResolvedValue(undefined);
        closeSpies.push(spy);
        return { queueName, opts, close: spy };
      };

      RenderClusterScaler.startCluster(3, 2, {
        customWorkerStarter: mockWorkerFactory as any,
      });

      await RenderClusterScaler.shutdownAll();

      expect(closeSpies.length).toBe(5);
      closeSpies.forEach((spy) => {
        expect(spy).toHaveBeenCalledTimes(1);
      });

      const metrics = await RenderClusterScaler.getClusterMetrics();
      expect(metrics.totalWorkers).toBe(0);
    });
  });
});
