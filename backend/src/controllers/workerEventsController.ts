import { Request, Response, NextFunction } from 'express';
import { RenderJobModel } from '../models/RenderJob.js';
import { RenderJobLifecycle, TERMINAL_STATES } from '../services/jobs/renderJobLifecycle.js';
import { AppError } from '../middleware/errorHandler.js';

export class WorkerEventsController {
  static async handleWorkerEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;
      const { eventType, jobId } = payload;

      const cleanJobId = jobId.replace(/^job_/, '');
      const job = await RenderJobModel.findById(cleanJobId);

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Worker reported event for non-existent job ID');
      }

      // Replay / terminal guard: a late progress event must not move a completed/failed job
      if (TERMINAL_STATES.includes(job.state)) {
        res.status(200).json({
          success: true,
          data: { accepted: true, duplicate: true, state: job.state },
          requestId: req.id,
        });
        return;
      }

      const initialJobState = job.state;
      let updatedJob = null;

      switch (eventType) {
        case 'render.progress': {
          updatedJob = await RenderJobLifecycle.transition(cleanJobId, 'processing', {
            percent:
              payload.progress?.percent !== undefined ? payload.progress.percent : job.percent,
            outTimeMs: payload.progress?.outTimeMs,
            workerId: (req.headers['x-worker-id'] as string) || payload.workerId,
          });
          break;
        }

        case 'render.completed': {
          const outKey = payload.result?.outputKey || payload.result?.key;
          updatedJob = await RenderJobLifecycle.transition(cleanJobId, 'completed', {
            percent: 100,
            output: {
              key: outKey,
              sizeBytes: payload.result?.sizeBytes || 0,
              durationMs: payload.result?.durationMs || 0,
              checksum: payload.result?.checksum,
            },
          });
          break;
        }

        case 'render.failed': {
          updatedJob = await RenderJobLifecycle.transition(cleanJobId, 'failed', {
            error: payload.error,
          });
          break;
        }

        case 'analysis.completed': {
          updatedJob = await RenderJobLifecycle.transition(cleanJobId, 'completed', {
            percent: 100,
          });
          break;
        }

        case 'analysis.failed': {
          updatedJob = await RenderJobLifecycle.transition(cleanJobId, 'failed', {
            error: payload.error,
          });
          break;
        }

        default:
          throw new AppError(400, 'UNKNOWN_EVENT_TYPE', `Unsupported worker event: ${eventType}`);
      }

      const isDuplicate =
        !updatedJob || (initialJobState === updatedJob.state && eventType !== 'render.progress');

      res.status(200).json({
        success: true,
        data: {
          accepted: true,
          duplicate: isDuplicate,
          state: updatedJob?.state || job.state,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
