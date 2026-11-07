import { Request, Response, NextFunction } from 'express';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { previewQueue, renderQueue } from '../services/queue/queueService.js';
import { AppError } from '../middleware/errorHandler.js';

export class RendersController {
  static async enqueuePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId } = req.params;
      const { planVersion } = req.body;

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      const version = planVersion || project.headVersion;
      const snapshot = await TimelineVersionModel.findOne({
        projectId: project._id,
        version,
      });

      if (!snapshot) {
        throw new AppError(404, 'VERSION_NOT_FOUND', `Timeline version ${version} not found`);
      }

      // Check if already rendered with matching snapshotHash (Render Reuse)
      const existingJob = await RenderJobModel.findOne({
        projectId: project._id,
        snapshotHash: snapshot.snapshotHash,
        profile: 'preview_480p',
        state: 'completed',
      });

      if (existingJob) {
        res.status(200).json({
          success: true,
          data: {
            jobId: `job_${existingJob._id.toString()}`,
            type: 'preview',
            state: 'completed',
            eventsUrl: `/api/jobs/job_${existingJob._id.toString()}/events`,
            downloadUrl: `/api/jobs/job_${existingJob._id.toString()}/download`,
          },
          requestId: req.id,
        });
        return;
      }

      const job = await RenderJobModel.create({
        projectId: project._id,
        userId: req.user!._id,
        timelineVersion: version,
        snapshotHash: snapshot.snapshotHash,
        type: 'preview',
        profile: 'preview_480p',
        state: 'queued',
        percent: 0,
        timings: { queuedAt: new Date() },
      });

      const bullJob = await previewQueue.add('render-preview', {
        jobId: job._id.toString(),
        projectId: project.publicId,
        planVersion: version,
        type: 'preview',
        profile: 'preview_480p',
      });

      job.queueJobId = bullJob.id;
      await job.save();

      res.status(202).json({
        success: true,
        data: {
          jobId: `job_${job._id.toString()}`,
          type: 'preview',
          state: 'queued',
          eventsUrl: `/api/jobs/job_${job._id.toString()}/events`,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async enqueueExport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId } = req.params;
      const { planVersion, profile = 'final_1080p' } = req.body;

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      // Validate export profile (Spec §4.6)
      const allowedProfiles = ['final_1080p', 'final_4k', 'preview_480p'];
      if (!allowedProfiles.includes(profile)) {
        throw new AppError(
          400,
          'INVALID_PROFILE',
          `Invalid export profile: ${profile}. Allowed profiles: ${allowedProfiles.join(', ')}`
        );
      }

      // Enforce 4K tier entitlement (Phase 7 Task 4 / Spec §4.6: "final_4k: paid tier, 4K only if tier/worker capacity permits")
      if (profile === 'final_4k') {
        const userTier = req.user?.tier || 'free';
        if (userTier === 'free') {
          throw new AppError(
            403,
            'UPGRADE_REQUIRED',
            '4K export profile is reserved for Pro and Enterprise tiers. Please upgrade your plan.'
          );
        }
      }

      const version = planVersion || project.headVersion;
      const snapshot = await TimelineVersionModel.findOne({
        projectId: project._id,
        version,
      });

      if (!snapshot) {
        throw new AppError(404, 'VERSION_NOT_FOUND', `Timeline version ${version} not found`);
      }

      const job = await RenderJobModel.create({
        projectId: project._id,
        userId: req.user!._id,
        timelineVersion: version,
        snapshotHash: snapshot.snapshotHash,
        type: 'export',
        profile: profile as any,
        state: 'queued',
        percent: 0,
        timings: { queuedAt: new Date() },
      });

      const bullJob = await renderQueue.add('render-export', {
        jobId: job._id.toString(),
        projectId: project.publicId,
        planVersion: version,
        type: 'export',
        profile,
      });

      job.queueJobId = bullJob.id;
      await job.save();

      res.status(202).json({
        success: true,
        data: {
          jobId: `job_${job._id.toString()}`,
          type: 'render',
          state: 'queued',
          eventsUrl: `/api/jobs/job_${job._id.toString()}/events`,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}

