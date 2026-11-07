import { Request, Response, NextFunction } from 'express';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { ChatMessageModel } from '../models/ChatMessage.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { CatalogModel } from '../models/Catalog.js';
import { PlannerService } from '../services/planner/plannerService.js';
import { PlanResolver } from '../services/resolver/planResolver.js';
import { previewQueue } from '../services/queue/queueService.js';
import { AppError } from '../middleware/errorHandler.js';
import crypto from 'crypto';

const plannerService = new PlannerService();

export class PromptsController {
  static async submitPrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId } = req.params;
      const { prompt, baseVersion, requestPreview = true } = req.body;

      if (!prompt) {
        throw new AppError(400, 'BAD_REQUEST', 'Prompt string is required');
      }

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      if (!project.baseAssetId) {
        throw new AppError(
          400,
          'NO_BASE_ASSET',
          'Project does not have an uploaded video asset yet'
        );
      }

      const asset = await AssetModel.findById(project.baseAssetId);
      const analysis = await AnalysisResultModel.findOne({ assetId: project.baseAssetId });

      if (!asset || !analysis) {
        throw new AppError(
          400,
          'ANALYSIS_NOT_READY',
          'Video analysis is still in progress or failed'
        );
      }

      // Check optimistic concurrency if baseVersion provided
      if (baseVersion !== undefined && baseVersion !== project.headVersion) {
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          `Base version ${baseVersion} is stale; current project version is ${project.headVersion}`
        );
      }

      // Fetch current plan if present
      let currentPlan = undefined;
      if (project.headVersion > 0) {
        const lastPlanDoc = await EditPlanModel.findOne({
          projectId: project._id,
          version: project.headVersion,
        });
        if (lastPlanDoc) {
          currentPlan = lastPlanDoc.plan;
        }
      }

      // Fetch active catalog
      const catalogItems = await CatalogModel.find({ active: true });
      const allowedCatalog = {
        templates: catalogItems
          .filter((c) => c.kind === 'template')
          .map((c) => ({ id: c.key, name: c.name })),
        luts: catalogItems
          .filter((c) => c.kind === 'lut')
          .map((c) => ({ id: c.key, name: c.name })),
        music: catalogItems
          .filter((c) => c.kind === 'music')
          .map((c) => ({ id: c.key, name: c.name, mood: (c.meta as any)?.mood || 'general' })),
        fonts: ['Montserrat', 'Inter', 'Roboto', 'Playfair'],
      };

      // Populate transcript excerpts from CaptionSet if available
      let transcriptExcerpt: Array<{ startMs: number; endMs: number; text: string }> = [];
      if (analysis.transcriptRef) {
        const captionDoc = await CaptionSetModel.findById(analysis.transcriptRef);
        if (captionDoc?.cues?.length) {
          transcriptExcerpt = captionDoc.cues.slice(0, 50).map((cue) => ({
            startMs: cue.startMs,
            endMs: cue.endMs,
            text: cue.text,
          }));
        }
      }

      const compactSummary = {
        durationMs: asset.media?.durationMs || 60000,
        width: asset.media?.width || 1920,
        height: asset.media?.height || 1080,
        fps: asset.media?.fps || 30,
        silences: analysis.silences || [],
        sceneCuts: analysis.sceneCuts || [],
        beats: analysis.beats || { bpm: 120, grid: [] },
        loudness: analysis.loudness || { integratedLufs: -16, truePeakDb: -1.5 },
        transcriptExcerpt,
      };

      // Record user chat message
      await ChatMessageModel.create({
        projectId: project._id,
        role: 'user',
        text: prompt,
      });

      // Call AI planner
      const nextVersion = project.headVersion + 1;
      const { plan, tokensIn, tokensOut, repairAttempts, patch } = await plannerService.plan(
        prompt,
        projectId,
        asset.publicId,
        project.headVersion,
        compactSummary,
        allowedCatalog,
        currentPlan
      );

      // Persist immutable EditPlan
      const planDoc = await EditPlanModel.create({
        projectId: project._id,
        version: nextVersion,
        parentVersion: project.headVersion > 0 ? project.headVersion : null,
        prompt,
        plan,
        patch: patch || [],
        model: plan.meta.model,
        tokensIn,
        tokensOut,
        validation: {
          repairAttempts,
          warnings: [],
        },
      });

      // Record assistant chat message
      await ChatMessageModel.create({
        projectId: project._id,
        role: 'assistant',
        text: `Generated edit plan v${nextVersion}`,
        planId: planDoc._id,
        versionResult: nextVersion,
      });

      // Deterministically resolve plan into output Timeline
      const resolvedTimeline = PlanResolver.resolve({
        plan,
        assetDurationMs: asset.media?.durationMs || 60000,
        sourcePlanObjectId: planDoc._id,
      });

      const snapshotHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(resolvedTimeline))
        .digest('hex');

      // Update head timeline
      await TimelineModel.updateOne(
        { projectId: project._id },
        {
          $set: {
            version: nextVersion,
            tracks: resolvedTimeline.tracks,
            globalEffects: resolvedTimeline.globalEffects,
            durationMs: resolvedTimeline.durationMs,
            sourcePlanId: planDoc._id,
          },
          $inc: { rev: 1 },
        }
      );

      // Save immutable snapshot in timelineVersions
      await TimelineVersionModel.create({
        projectId: project._id,
        userId: req.user!._id,
        version: nextVersion,
        parentVersion: project.headVersion,
        source: 'ai',
        label: prompt.slice(0, 40),
        planId: planDoc._id,
        snapshot: resolvedTimeline,
        snapshotHash,
      });

      // Update project headVersion and version list index
      project.headVersion = nextVersion;
      project.versions.push({
        version: nextVersion,
        label: prompt.slice(0, 40),
        source: 'ai',
        planId: planDoc._id as any,
        createdAt: new Date(),
      });
      if (project.versions.length > 50) {
        project.versions.shift();
      }
      await project.save();

      // Optionally enqueue 480p preview
      let previewJobId: string | undefined = undefined;
      if (requestPreview) {
        const previewJob = await RenderJobModel.create({
          projectId: project._id,
          userId: req.user!._id,
          timelineVersion: nextVersion,
          snapshotHash,
          type: 'preview',
          profile: 'preview_480p',
          state: 'queued',
          percent: 0,
          timings: { queuedAt: new Date() },
        });

        const bullJob = await previewQueue.add('render-preview', {
          jobId: previewJob._id.toString(),
          projectId: project.publicId,
          planVersion: nextVersion,
          type: 'preview',
          profile: 'preview_480p',
        });

        previewJob.queueJobId = bullJob.id;
        await previewJob.save();
        previewJobId = `job_${previewJob._id.toString()}`;
      }

      res.status(200).json({
        success: true,
        data: {
          planId: `pln_${planDoc._id.toString()}`,
          version: nextVersion,
          parentVersion: project.headVersion > 1 ? project.headVersion - 1 : null,
          state: 'planned',
          plan,
          previewJobId,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
