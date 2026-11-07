import { Request, Response, NextFunction } from 'express';
import { RenderJobModel } from '../models/RenderJob.js';
import { S3Service } from '../services/storage/s3Service.js';
import { SSEManager } from '../services/events/sseManager.js';
import { AppError } from '../middleware/errorHandler.js';

export class JobsController {
  static async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const cleanId = id.replace(/^job_/, '');

      const job = await RenderJobModel.findOne({
        _id: cleanId,
        userId: req.user!._id,
      });

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found or access denied');
      }

      res.status(200).json({
        success: true,
        data: {
          jobId: `job_${job._id.toString()}`,
          type: job.type,
          profile: job.profile,
          state: job.state,
          percent: job.percent,
          etaSec: job.etaSec,
          error: job.error,
          output: job.output,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getJobEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const cleanId = id.replace(/^job_/, '');

      const job = await RenderJobModel.findOne({
        _id: cleanId,
        userId: req.user!._id,
      });

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
      }

      SSEManager.subscribeToJob(cleanId, res, job);
    } catch (err) {
      next(err);
    }
  }

  static async getJobDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const cleanId = id.replace(/^job_/, '');

      const job = await RenderJobModel.findOne({
        _id: cleanId,
        userId: req.user!._id,
      });

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
      }

      if (job.state !== 'completed') {
        throw new AppError(
          400,
          'JOB_NOT_READY',
          `Cannot download output when job state is ${job.state}`
        );
      }

      if (!job.output?.key) {
        throw new AppError(404, 'OUTPUT_KEY_NOT_FOUND', 'Render output key missing');
      }

      const signedUrl = await S3Service.getPresignedDownloadUrl(job.output.key, 3600);

      res.status(200).json({
        success: true,
        data: {
          url: signedUrl,
          expiresInSeconds: 3600,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
