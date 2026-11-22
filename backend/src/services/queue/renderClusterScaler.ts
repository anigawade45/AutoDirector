import { Worker } from 'bullmq';
import crypto from 'crypto';
import { QUEUE_CONFIGS, renderQueue, previewQueue } from './queueService.js';
import { redisConnection } from '../../config/redis.js';
import { startRenderWorker } from '../../workers/renderWorker.js';
import { StorageKeys } from '../../config/s3.js';
import { env } from '../../config/env.js';

export interface WorkerNodeMetadata {
  workerId: string;
  queueName: 'preview' | 'render';
  concurrency: number;
  status: 'active' | 'draining' | 'stopped';
  startedAt: Date;
  processedCount: number;
}

export interface ClusterStatusMetrics {
  totalWorkers: number;
  totalConcurrency: number;
  workersByQueue: {
    render: number;
    preview: number;
  };
  activeJobs: number;
  waitingJobs: number;
  completedJobs: number;
  failedJobs: number;
  nodes: WorkerNodeMetadata[];
}

export type ClusterMetrics = ClusterStatusMetrics;

export interface RenderChunkSpec {
  chunkIndex: number;
  totalChunks: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  outputKey: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  assignedWorkerId?: string;
}

export interface SegmentedRenderPlan {
  parentJobId: string;
  projectId: string;
  userId: string;
  profile: 'preview_480p' | 'final_1080p' | 'final_4k';
  totalDurationMs: number;
  chunkDurationMs: number;
  totalChunks: number;
  chunks: RenderChunkSpec[];
  finalOutputKey: string;
}

export interface ThroughputModel {
  workerCount: number;
  concurrencyPerWorker: number;
  totalClusterConcurrency: number;
  avgJobRenderSec: number;
  jobsPerHour: number;
  jobsPerMinute: number;
  speedupFactor: number;
  estimatedTimeToProcessBatchSec: (batchSize: number) => number;
}

export class RenderClusterScaler {
  private static workerPool: Map<
    string,
    {
      workerId: string;
      queueName: 'preview' | 'render';
      worker: any;
      concurrency: number;
      status: 'active' | 'draining' | 'stopped';
      startedAt: Date;
      processedCount: number;
    }
  > = new Map();

  /**
   * Spawns an initial pool of N workers across preview and render queues.
   */
  static startCluster(
    renderWorkerCount: number = 2,
    previewWorkerCount: number = 2,
    options?: {
      concurrency?: number;
      customWorkerStarter?: (queueName: 'preview' | 'render', opts: any) => any;
    }
  ): WorkerNodeMetadata[] {
    const startedNodes: WorkerNodeMetadata[] = [];
    const starter = options?.customWorkerStarter || startRenderWorker;

    // 1. Spawn N render workers
    for (let i = 0; i < renderWorkerCount; i++) {
      const workerId = `render-node-${process.pid}-w${i + 1}-${crypto.randomBytes(3).toString('hex')}`;
      const concurrency =
        options?.concurrency ?? env.WORKER_CONCURRENCY ?? QUEUE_CONFIGS.render.concurrency;

      const workerInstance = starter('render', {
        concurrency,
        workerId,
      });

      const nodeMeta: WorkerNodeMetadata = {
        workerId,
        queueName: 'render',
        concurrency,
        status: 'active',
        startedAt: new Date(),
        processedCount: 0,
      };

      this.workerPool.set(workerId, {
        ...nodeMeta,
        worker: workerInstance,
      });

      startedNodes.push(nodeMeta);
    }

    // 2. Spawn N preview workers
    for (let i = 0; i < previewWorkerCount; i++) {
      const workerId = `preview-node-${process.pid}-w${i + 1}-${crypto.randomBytes(3).toString('hex')}`;
      const concurrency =
        options?.concurrency ?? env.WORKER_CONCURRENCY ?? QUEUE_CONFIGS.preview.concurrency;

      const workerInstance = starter('preview', {
        concurrency,
        workerId,
      });

      const nodeMeta: WorkerNodeMetadata = {
        workerId,
        queueName: 'preview',
        concurrency,
        status: 'active',
        startedAt: new Date(),
        processedCount: 0,
      };

      this.workerPool.set(workerId, {
        ...nodeMeta,
        worker: workerInstance,
      });

      startedNodes.push(nodeMeta);
    }

    console.log(
      `[RenderClusterScaler] Initialized cluster with ${this.workerPool.size} workers (render: ${renderWorkerCount}, preview: ${previewWorkerCount})`
    );

    return startedNodes;
  }

  /**
   * Dynamically scales the active worker count for a given queue up or down to targetCount.
   */
  static async scale(
    targetCount: number,
    queueName: 'preview' | 'render' = 'render',
    options?: {
      concurrency?: number;
      customWorkerStarter?: (queueName: 'preview' | 'render', opts: any) => any;
    }
  ): Promise<{
    queueName: string;
    previousCount: number;
    currentCount: number;
    action: 'scaled_up' | 'scaled_down' | 'no_op';
    delta: number;
  }> {
    const starter = options?.customWorkerStarter || startRenderWorker;
    const currentQueueWorkers = Array.from(this.workerPool.values()).filter(
      (w) => w.queueName === queueName && w.status === 'active'
    );
    const previousCount = currentQueueWorkers.length;

    if (targetCount === previousCount) {
      return {
        queueName,
        previousCount,
        currentCount: previousCount,
        action: 'no_op',
        delta: 0,
      };
    }

    if (targetCount > previousCount) {
      // Scale UP: spawn additional workers
      const toAdd = targetCount - previousCount;
      for (let i = 0; i < toAdd; i++) {
        const workerId = `${queueName}-node-${process.pid}-scale-${Date.now()}-${i + 1}`;
        const concurrency =
          options?.concurrency ?? env.WORKER_CONCURRENCY ?? QUEUE_CONFIGS[queueName].concurrency;

        const workerInstance = starter(queueName, {
          concurrency,
          workerId,
        });

        this.workerPool.set(workerId, {
          workerId,
          queueName,
          concurrency,
          status: 'active',
          startedAt: new Date(),
          processedCount: 0,
          worker: workerInstance,
        });
      }

      console.log(
        `[RenderClusterScaler] Scaled UP queue "${queueName}" from ${previousCount} to ${targetCount} workers (+${toAdd})`
      );

      return {
        queueName,
        previousCount,
        currentCount: targetCount,
        action: 'scaled_up',
        delta: toAdd,
      };
    } else {
      // Scale DOWN: gracefully drain workers
      const toRemove = previousCount - targetCount;
      const workersToDrain = currentQueueWorkers.slice(-toRemove);

      const drainPromises = workersToDrain.map(async (w) => {
        w.status = 'draining';
        try {
          if (w.worker && typeof w.worker.close === 'function') {
            await w.worker.close();
          }
        } catch (err: any) {
          console.warn(`[RenderClusterScaler] Worker drain notice (${w.workerId}):`, err.message);
        } finally {
          w.status = 'stopped';
          this.workerPool.delete(w.workerId);
        }
      });

      await Promise.all(drainPromises);

      console.log(
        `[RenderClusterScaler] Scaled DOWN queue "${queueName}" from ${previousCount} to ${targetCount} workers (-${toRemove})`
      );

      return {
        queueName,
        previousCount,
        currentCount: targetCount,
        action: 'scaled_down',
        delta: -toRemove,
      };
    }
  }

  /**
   * Computes cluster capacity and queue telemetry metrics.
   */
  static async getClusterMetrics(): Promise<ClusterMetrics> {
    const activeNodes = Array.from(this.workerPool.values()).filter((w) => w.status === 'active');
    const totalWorkers = activeNodes.length;
    const totalConcurrency = activeNodes.reduce((sum, n) => sum + n.concurrency, 0);

    const workersByQueue = {
      render: activeNodes.filter((n) => n.queueName === 'render').length,
      preview: activeNodes.filter((n) => n.queueName === 'preview').length,
    };

    let waitingJobs = 0;
    let activeJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;

    try {
      if (renderQueue && typeof renderQueue.getJobCounts === 'function') {
        const renderCounts = await renderQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed'
        );
        waitingJobs += renderCounts.waiting || 0;
        activeJobs += renderCounts.active || 0;
        completedJobs += renderCounts.completed || 0;
        failedJobs += renderCounts.failed || 0;
      }
      if (previewQueue && typeof previewQueue.getJobCounts === 'function') {
        const previewCounts = await previewQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed'
        );
        waitingJobs += previewCounts.waiting || 0;
        activeJobs += previewCounts.active || 0;
        completedJobs += previewCounts.completed || 0;
        failedJobs += previewCounts.failed || 0;
      }
    } catch {
      // In isolated mock environments without live Redis
    }

    return {
      totalWorkers,
      totalConcurrency,
      workersByQueue,
      activeJobs,
      waitingJobs,
      completedJobs,
      failedJobs,
      nodes: activeNodes.map((w) => ({
        workerId: w.workerId,
        queueName: w.queueName,
        concurrency: w.concurrency,
        status: w.status,
        startedAt: w.startedAt,
        processedCount: w.processedCount,
      })),
    };
  }

  /**
   * Models the theoretical and empirical throughput scaling for N workers.
   * Demonstrates linear scaling: speedup = N, queue wait time = 1 / N.
   */
  static calculateThroughput(
    workerCount: number,
    concurrencyPerWorker: number = 2,
    avgJobRenderSec: number = 28
  ): ThroughputModel {
    const totalClusterConcurrency = Math.max(1, workerCount * concurrencyPerWorker);
    const jobsPerSecond = totalClusterConcurrency / Math.max(1, avgJobRenderSec);
    const jobsPerHour = Math.round(jobsPerSecond * 3600);
    const jobsPerMinute = Number((jobsPerSecond * 60).toFixed(1));
    const baselineConcurrency = 1; // 1 worker, concurrency 1
    const speedupFactor = Number((totalClusterConcurrency / baselineConcurrency).toFixed(2));

    return {
      workerCount,
      concurrencyPerWorker,
      totalClusterConcurrency,
      avgJobRenderSec,
      jobsPerHour,
      jobsPerMinute,
      speedupFactor,
      estimatedTimeToProcessBatchSec: (batchSize: number) => {
        const waves = Math.ceil(batchSize / totalClusterConcurrency);
        return waves * avgJobRenderSec;
      },
    };
  }

  /**
   * Plans a segmented horizontal render for long-form video (e.g. 10m to 3h).
   * Partitions timeline into K parallel render slices for concurrent worker execution.
   */
  static planSegmentedRender(
    totalDurationMs: number,
    chunkDurationMs: number = 60000, // 60-second chunks
    userId: string = 'usr_prod_1',
    projectId: string = 'prj_prod_1',
    parentJobId: string = 'job_master_1',
    profile: 'preview_480p' | 'final_1080p' | 'final_4k' = 'final_1080p'
  ): SegmentedRenderPlan {
    const totalChunks = Math.max(1, Math.ceil(totalDurationMs / chunkDurationMs));
    const chunks: RenderChunkSpec[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startMs = i * chunkDurationMs;
      const endMs = Math.min((i + 1) * chunkDurationMs, totalDurationMs);
      const durationMs = endMs - startMs;
      const outputKey = StorageKeys.renderChunk(userId, projectId, parentJobId, i);

      chunks.push({
        chunkIndex: i,
        totalChunks,
        startMs,
        endMs,
        durationMs,
        outputKey,
        status: 'pending',
      });
    }

    const finalOutputKey = StorageKeys.finalRender(userId, projectId, parentJobId);

    return {
      parentJobId,
      projectId,
      userId,
      profile,
      totalDurationMs,
      chunkDurationMs,
      totalChunks,
      chunks,
      finalOutputKey,
    };
  }

  /**
   * Generates FFmpeg concat demuxer manifest file content from rendered chunk paths.
   */
  static generateConcatManifest(chunkLocalPaths: string[]): string {
    return chunkLocalPaths
      .map((filePath) => {
        const cleanPath = filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
        return `file '${cleanPath}'`;
      })
      .join('\n');
  }

  /**
   * Builds FFmpeg lossless copy concatenation arguments.
   * Concatenates rendered video slices in seconds without re-encoding.
   */
  static buildConcatArgs(manifestPath: string, outputPath: string): string[] {
    const cleanManifest = manifestPath.replace(/\\/g, '/');
    return [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      cleanManifest,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  }

  /**
   * Gracefully drains and terminates all active workers in the cluster.
   */
  static async shutdownAll(): Promise<void> {
    const activeWorkers = Array.from(this.workerPool.values());
    console.log(`[RenderClusterScaler] Shutting down ${activeWorkers.length} cluster workers...`);

    const drainPromises = activeWorkers.map(async (w) => {
      w.status = 'draining';
      try {
        if (w.worker && typeof w.worker.close === 'function') {
          await w.worker.close();
        }
      } catch (err: any) {
        console.warn(`[RenderClusterScaler] Worker shutdown notice (${w.workerId}):`, err.message);
      } finally {
        w.status = 'stopped';
      }
    });

    await Promise.all(drainPromises);
    this.workerPool.clear();
    console.log('[RenderClusterScaler] All cluster workers shut down cleanly.');
  }

  /**
   * Resets internal worker pool for isolated test teardowns.
   */
  static reset(): void {
    this.workerPool.clear();
  }
}
