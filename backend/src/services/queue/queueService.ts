import { Queue } from 'bullmq';
import { redisConnection, createRedisConnection } from '../../config/redis.js';

export interface QueueConfig {
  name: string;
  concurrency: number;
  timeoutMs: number;
  attempts: number;
  backoff: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  lockDurationMs: number;
}

export const QUEUE_CONFIGS: Record<'analysis' | 'preview' | 'render', QueueConfig> = {
  analysis: {
    name: 'analysis',
    concurrency: 2,
    timeoutMs: 20 * 60 * 1000, // 20 minutes
    attempts: 3, // 2 retries, exponential backoff
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    lockDurationMs: 120000, // 2 minutes with auto-renewal
  },
  preview: {
    name: 'preview',
    concurrency: 3,
    timeoutMs: 5 * 60 * 1000, // 5 minutes
    attempts: 2, // 1 retry
    backoff: {
      type: 'fixed',
      delay: 3000,
    },
    lockDurationMs: 60000, // 1 minute with auto-renewal
  },
  render: {
    name: 'render',
    concurrency: 1,
    timeoutMs: 60 * 60 * 1000, // 60 minutes
    attempts: 2, // 1 retry
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    lockDurationMs: 180000, // 3 minutes with auto-renewal
  },
};

export const analysisQueue = new Queue('analysis', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: QUEUE_CONFIGS.analysis.attempts,
    backoff: QUEUE_CONFIGS.analysis.backoff,
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const previewQueue = new Queue('preview', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: QUEUE_CONFIGS.preview.attempts,
    backoff: QUEUE_CONFIGS.preview.backoff,
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const renderQueue = new Queue('render', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: QUEUE_CONFIGS.render.attempts,
    backoff: QUEUE_CONFIGS.render.backoff,
    removeOnComplete: 50,
    removeOnFail: 200,
  },
});

// Dedicated publisher redis client for pub/sub progress events
const pubClient = createRedisConnection();

export class JobEventsPublisher {
  static async publishProgress(jobId: string, event: Record<string, unknown>): Promise<void> {
    const channel = `job:${jobId}`;
    if (pubClient.status === 'ready') {
      try {
        await pubClient.publish(channel, JSON.stringify(event));
      } catch (err: any) {
        console.warn(`[JobEventsPublisher] Redis publish notice: ${err.message}`);
      }
    }
  }
}
