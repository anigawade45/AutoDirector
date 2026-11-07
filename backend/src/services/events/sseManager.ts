import { Response } from 'express';
import { createRedisConnection } from '../../config/redis.js';
import { IRenderJobDocument } from '../../models/RenderJob.js';

export class SSEManager {
  /**
   * Subscribes a client HTTP Response to live progress events over Redis pub/sub.
   * Emits events conforming strictly to API Contract §5.7:
   * event: progress | event: state | event: done | event: error
   */
  static subscribeToJob(
    jobId: string,
    res: Response,
    initialJob?: IRenderJobDocument | null
  ): () => void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const cleanJobId = jobId.replace(/^job_/, '');
    const formattedJobId = `job_${cleanJobId}`;
    const channel = `job:${cleanJobId}`;

    // Initial connection acknowledgement comment
    res.write(`: connected to ${channel}\n\n`);

    // If job is already in a terminal state when SSE connects, emit terminal event immediately
    if (initialJob) {
      if (initialJob.state === 'completed') {
        res.write(`event: done\n`);
        res.write(
          `data: ${JSON.stringify({
            jobId: formattedJobId,
            state: 'done',
            percent: 100,
            outputKey: initialJob.output?.key,
          })}\n\n`
        );
        res.end();
        return () => {};
      } else if (initialJob.state === 'failed') {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({
            jobId: formattedJobId,
            state: 'failed',
            code: initialJob.error?.code || 'RENDER_FAILED',
            message: initialJob.error?.message,
          })}\n\n`
        );
        res.end();
        return () => {};
      } else if (initialJob.state === 'uploading_output') {
        res.write(`event: state\n`);
        res.write(
          `data: ${JSON.stringify({
            jobId: formattedJobId,
            state: 'uploading_output',
            percent: initialJob.percent,
          })}\n\n`
        );
      } else {
        res.write(`event: progress\n`);
        res.write(
          `data: ${JSON.stringify({
            jobId: formattedJobId,
            state: initialJob.state,
            percent: initialJob.percent,
          })}\n\n`
        );
      }
    }

    const subClient = createRedisConnection();

    // Heartbeat comments every 15 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      if (subClient.status === 'ready') {
        subClient.unsubscribe(channel).catch(() => {});
        subClient.quit().catch(() => {});
      }
    };

    subClient.subscribe(channel, (err) => {
      if (err) {
        console.error(`[SSE] Failed to subscribe to channel ${channel}:`, err.message);
        res.end();
      }
    });

    subClient.on('message', (_chan, message) => {
      try {
        const payload = JSON.parse(message);
        const state = payload.state;

        // Classify event type matching API Contract §5.7
        let eventType = payload.eventType || payload.type;
        if (!eventType) {
          if (state === 'done' || state === 'completed') {
            eventType = 'done';
          } else if (state === 'failed') {
            eventType = 'error';
          } else if (state === 'uploading_output') {
            eventType = 'state';
          } else {
            eventType = 'progress';
          }
        }

        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);

        // Close stream on terminal states
        if (
          state === 'done' ||
          state === 'completed' ||
          state === 'failed' ||
          state === 'canceled'
        ) {
          cleanup();
          res.end();
        }
      } catch (err) {
        console.error('[SSE] Failed to serialize message:', err);
      }
    });

    res.on('close', cleanup);
    return cleanup;
  }
}
