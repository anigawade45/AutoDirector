import { Request, Response, NextFunction } from 'express';
import { RenderJobModel } from '../models/RenderJob.js';
import { ProjectModel } from '../models/Project.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';
import { AppError } from '../middleware/errorHandler.js';

export class WorkerEventsController {
  static async handleWorkerEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;
      const { eventType, jobId, projectId } = payload;

      const cleanJobId = jobId.replace(/^job_/, '');
      const job = await RenderJobModel.findById(cleanJobId);

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Worker reported event for non-existent job ID');
      }

      // Replay / terminal guard: a late progress event must not move a completed/failed job
      if (job.state === 'completed' || job.state === 'failed') {
        res.status(200).json({
          success: true,
          data: { accepted: true, duplicate: true, state: job.state },
          requestId: req.id,
        });
        return;
      }

      switch (eventType) {
        case 'render.progress': {
          job.state = 'processing';
          job.percent = payload.progress?.percent || job.percent;
          await job.save();

          await JobEventsPublisher.publishProgress(cleanJobId, {
            jobId,
            state: 'processing',
            percent: job.percent,
            outTimeMs: payload.progress?.outTimeMs,
          });
          break;
        }

        case 'render.completed': {
          const outKey = payload.result?.outputKey || payload.result?.key;
          job.state = 'completed';
          job.percent = 100;
          job.output = {
            key: outKey,
            sizeBytes: payload.result?.sizeBytes || 0,
            durationMs: payload.result?.durationMs || 0,
            checksum: payload.result?.checksum,
          };
          job.timings.finishedAt = new Date();
          await job.save();

          // If final export, update project's publishedVersion
          if (job.type === 'export' || job.type === 'render') {
            await ProjectModel.updateOne(
              { _id: job.projectId },
              { $set: { publishedVersion: job.timelineVersion, status: 'ready' } }
            );
          } else if (job.type === 'preview') {
            await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'ready' } });
          }

          await JobEventsPublisher.publishProgress(cleanJobId, {
            jobId,
            state: 'done',
            percent: 100,
            outputKey: outKey,
          });
          break;
        }

        case 'render.failed': {
          job.state = 'failed';
          job.error = payload.error;
          job.timings.finishedAt = new Date();
          await job.save();

          await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'error' } });

          await JobEventsPublisher.publishProgress(cleanJobId, {
            jobId,
            state: 'failed',
            code: payload.error?.code,
            message: payload.error?.message,
          });
          break;
        }

        case 'analysis.completed': {
          job.state = 'completed';
          job.percent = 100;
          job.timings.finishedAt = new Date();
          await job.save();

          await ProjectModel.updateOne({ _id: job.projectId }, { $set: { status: 'ready' } });

          await JobEventsPublisher.publishProgress(cleanJobId, {
            jobId,
            state: 'done',
            percent: 100,
            assetId: payload.assetId,
            analysisResultId: payload.analysisResultId,
          });
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

