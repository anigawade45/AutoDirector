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
import { UserModel } from '../models/User.js';
import { QuotaService } from '../services/auth/quotaService.js';
import mongoose from 'mongoose';
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
      const { prompt, baseVersion, requestPreview = true, model, strictLlm } = req.body;

      if (!prompt) {
        throw new AppError(400, 'BAD_REQUEST', 'Prompt string is required');
      }

      // Tier prompt quota enforcement
      const rawUserId = req.user?.id || req.user?._id;
      await QuotaService.checkPromptQuota(rawUserId);

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: projectId,
          userId: req.user!._id,
          deletedAt: null,
        }));
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

      const asset =
        (await AssetModel.findById(project.baseAssetId)) ||
        (await AssetModel.findOne({ publicId: project.baseAssetId }));
      const analysis = await AnalysisResultModel.findOne({
        assetId: {
          $in: [project.baseAssetId, asset?._id, asset?.publicId].filter(Boolean),
        },
      });

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
        projectId: project._id || project.publicId,
        userId: rawUserId,
        role: 'user',
        text: prompt,
      });

      // Call AI planner
      const nextVersion = project.headVersion + 1;
      const {
        plan,
        tokensIn,
        tokensOut,
        repairAttempts,
        patch,
        executionMode,
        isFallback,
        requestedModel,
        fallbackReason,
      } = await plannerService.plan(
        prompt,
        projectId,
        asset.publicId,
        project.headVersion,
        compactSummary,
        allowedCatalog,
        currentPlan,
        model,
        { strictLlm: Boolean(strictLlm) }
      );

      // Persist immutable EditPlan (with duplicate-key resilience for crashed/replayed transactions)
      let planDoc: any;
      try {
        planDoc = await EditPlanModel.create({
          projectId: project._id,
          version: nextVersion,
          parentVersion: project.headVersion > 0 ? project.headVersion : null,
          prompt,
          plan,
          patch: patch || [],
          model: plan.meta.model,
          tokensIn,
          tokensOut,
          assumptions: {
            executionMode,
            isFallback,
            requestedModel,
            fallbackReason,
          },
          validation: {
            repairAttempts,
            warnings: isFallback && fallbackReason ? [fallbackReason] : [],
          },
        });
      } catch (err: any) {
        if (err.code === 11000 && typeof EditPlanModel.findOneAndUpdate === 'function') {
          planDoc = await EditPlanModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                parentVersion: project.headVersion > 0 ? project.headVersion : null,
                prompt,
                plan,
                patch: patch || [],
                model: plan.meta.model,
                tokensIn,
                tokensOut,
                assumptions: {
                  executionMode,
                  isFallback,
                  requestedModel,
                  fallbackReason,
                },
                validation: {
                  repairAttempts,
                  warnings: isFallback && fallbackReason ? [fallbackReason] : [],
                },
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

      // Record assistant chat message with explicit fallback notices
      let assistantText = (plan.meta as any)?.rationale;
      if (!assistantText) {
        if (executionMode === 'heuristic_fallback') {
          assistantText = `⚠️ Notice: Upstream AI was unavailable (${fallbackReason || 'connection error'}). Applied a deterministic rule-based edit plan v${nextVersion}. Quota was not deducted. You can retry with an alternate model.`;
        } else if (isFallback) {
          assistantText = `Created EditPlan v${nextVersion} using fallback model ${plan.meta.model} (requested ${requestedModel}). Configured ${plan.layers?.length || 0} active layers.`;
        } else {
          assistantText = `Created EditPlan v${nextVersion}. Configured ${plan.layers?.length || 0} active layers.`;
        }
      }

      await ChatMessageModel.create({
        projectId: project._id || project.publicId,
        userId: rawUserId,
        role: 'assistant',
        text: assistantText,
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

      // Save immutable snapshot in timelineVersions (with duplicate-key resilience)
      try {
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
      } catch (err: any) {
        if (err.code === 11000 && typeof TimelineVersionModel.findOneAndUpdate === 'function') {
          await TimelineVersionModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                userId: req.user!._id,
                parentVersion: project.headVersion,
                source: 'ai',
                label: prompt.slice(0, 40),
                planId: planDoc._id,
                snapshot: resolvedTimeline,
                snapshotHash,
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

      // Update project headVersion and version list index
      project.headVersion = nextVersion;
      project.versions = project.versions.filter((v) => v.version !== nextVersion);
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

      // Record prompt usage for tier quota tracking ONLY if not a heuristic fallback
      if (executionMode !== 'heuristic_fallback') {
        await QuotaService.incrementPromptQuota(rawUserId);
      } else {
        console.info(
          `[QuotaService] Waived prompt quota for user ${rawUserId} on project ${project.publicId} due to heuristic fallback`
        );
      }

      res.status(200).json({
        success: true,
        data: {
          planId: `pln_${planDoc._id.toString()}`,
          version: nextVersion,
          parentVersion: project.headVersion > 1 ? project.headVersion - 1 : null,
          state: 'planned',
          executionMode,
          fallback: {
            isFallback,
            requestedModel,
            usedModel: plan.meta.model,
            reason: fallbackReason || null,
          },
          plan,
          previewJobId,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getChatHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const rawUserId = req.user?._id;

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: id,
          userId: rawUserId,
          deletedAt: null,
        }));

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} not found or unauthorized`);
      }

      const messages = await ChatMessageModel.find({
        projectId: project._id || project.publicId,
        $or: [{ userId: rawUserId }, { userId: { $exists: false } }],
      }).sort({ createdAt: 1 });

      const formatted = messages.map((m) => ({
        id: m._id.toString(),
        projectId: project.publicId || project._id.toString(),
        role: m.role,
        text: m.text,
        planId: m.planId?.toString(),
        versionResult: m.versionResult,
        planVersion: m.versionResult,
        timestamp: m.createdAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
      }));

      res.status(200).json({
        success: true,
        data: {
          projectId: project.publicId || project._id.toString(),
          messages: formatted,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async postChatMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { text, role = 'user' } = req.body;
      const rawUserId = req.user?._id;

      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new AppError(400, 'INVALID_MESSAGE', 'Message text must be a non-empty string');
      }

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: id,
          userId: rawUserId,
          deletedAt: null,
        }));

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} not found or unauthorized`);
      }

      const msg = await ChatMessageModel.create({
        projectId: project._id || project.publicId,
        userId: rawUserId,
        role: ['user', 'assistant', 'system'].includes(role) ? role : 'user',
        text: text.trim(),
      });

      res.status(201).json({
        success: true,
        data: {
          id: msg._id.toString(),
          projectId: project.publicId || project._id.toString(),
          role: msg.role,
          text: msg.text,
          timestamp: msg.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: msg.createdAt.toISOString(),
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
