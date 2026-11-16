import { Request, Response, NextFunction } from 'express';
import { RenderJobModel } from '../models/RenderJob.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
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
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'canceled') {
        res.status(200).json({
          success: true,
          data: { accepted: true, duplicate: true, state: job.state },
          requestId: req.id,
        });
        return;
      }

      switch (eventType) {
        case 'render.progress': {
          await RenderJobLifecycle.transition(cleanJobId, 'processing', {
            percent: payload.progress?.percent || job.percent,
            outTimeMs: payload.progress?.outTimeMs,
            workerId: req.headers['x-worker-id'] as string,
          });
          break;
        }

        case 'render.completed': {
          const outKey = payload.result?.outputKey || payload.result?.key;
          await RenderJobLifecycle.transition(cleanJobId, 'completed', {
            percent: 100,
            output: {
              key: outKey,
              sizeBytes: payload.result?.sizeBytes || 0,
              durationMs: payload.result?.durationMs || 0,
              checksum: payload.result?.checksum,
            },
          });

          // If final export, update project's publishedVersion
          if (job.type === 'export' || job.type === 'render') {
            await ProjectModel.updateOne(
              { _id: job.projectId },
              { $set: { publishedVersion: job.timelineVersion, status: 'ready' } }
            );
          } else if (job.type === 'preview') {
            await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'ready' } });
          }
          break;
        }

        case 'render.failed': {
          await RenderJobLifecycle.transition(cleanJobId, 'failed', {
            error: payload.error,
          });

          await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'error' } });
          break;
        }

        case 'analysis.completed': {
          await RenderJobLifecycle.transition(cleanJobId, 'completed', {
            percent: 100,
          });

          await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'ready' } });
          break;
        }

        default:
          throw new AppError(400, 'UNKNOWN_EVENT_TYPE', `Unsupported worker event: ${eventType}`);
      }

      res.status(200).json({
        success: true,
        data: { accepted: true, duplicate: false },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
