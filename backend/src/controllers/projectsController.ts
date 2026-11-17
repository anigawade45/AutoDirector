import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { nanoid } from '../utils/id.js';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { TimelineModel } from '../models/Timeline.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { ChatMessageModel } from '../models/ChatMessage.js';
import { S3Service } from '../services/storage/s3Service.js';
import { StorageKeys } from '../config/s3.js';
import { PurgeService } from '../services/maintenance/purgeService.js';
import { AppError } from '../middleware/errorHandler.js';
import { EditPlan } from '@ai-video/shared';

export class ProjectsController {
  static async createProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, settings } = req.body;
      const publicId = `prj_${nanoid(8)}`;

      const project = await ProjectModel.create({
        publicId,
        userId: req.user!._id,
        title: title || 'Untitled Project',
        status: 'draft',
        settings: settings || {
          aspect: '16:9',
          fps: 30,
          width: 1920,
          height: 1080,
          language: 'en',
        },
      });

      // Create initial head timeline
      const timeline = await TimelineModel.create({
        projectId: project._id,
        userId: req.user!._id,
        rev: 0,
        version: 0,
        fps: project.settings.fps,
        width: project.settings.width,
        height: project.settings.height,
        durationMs: 0,
        tracks: [],
      });

      project.timelineId = timeline._id as any;
      await project.save();

      res.status(201).json({
        success: true,
        data: project,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async listProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = req.query;
      const filter: Record<string, any> = {
        userId: req.user!._id,
        deletedAt: null,
      };

      if (status === 'archived') {
        filter.status = 'archived';
      } else if (status === 'active') {
        filter.status = { $ne: 'archived' };
      } else if (status && typeof status === 'string' && status !== 'all') {
        filter.status = status;
      }

      const projects = await ProjectModel.find(filter)
        .populate('baseAssetId', 'media status')
        .sort({ updatedAt: -1 })
        .limit(50);

      res.status(200).json({
        success: true,
        data: projects,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const project = await ProjectModel.findOne({
        publicId: id,
        userId: req.user!._id,
        deletedAt: null,
      }).populate('baseAssetId timelineId');

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or unauthorized');
      }

      let analysisSummary = null;
      let previewUrl = null;
      let baseProxyUrl = null;
      let isRenderedPreview = false;

      if (project.baseAssetId) {
        const baseAsset = project.baseAssetId as any;

        const cleanProxyKey = baseAsset.s3?.proxyKey || baseAsset.s3?.rawKey;
        if (cleanProxyKey) {
          try {
            baseProxyUrl = await S3Service.getPresignedDownloadUrl(cleanProxyKey, 7200);
          } catch (s3Err) {
            console.warn('[ProjectsController] Base proxy Presigned URL notice:', s3Err);
          }
        }

        // Check for rendered captioned preview first, then fall back to 480p proxy, then raw video
        const previewKey = StorageKeys.previewVideo(
          req.user!._id.toString(),
          project.publicId,
          project.headVersion || 1
        );
        let keyToSign = cleanProxyKey;

        try {
          const hasPreview = await S3Service.fileExists(previewKey);
          if (hasPreview) {
            keyToSign = previewKey;
            isRenderedPreview = true;
          }
        } catch {
          // Keep proxy fallback
        }

        if (keyToSign) {
          if (keyToSign === cleanProxyKey && baseProxyUrl) {
            previewUrl = baseProxyUrl;
          } else {
            try {
              previewUrl = await S3Service.getPresignedDownloadUrl(keyToSign, 7200);
            } catch (s3Err) {
              console.warn('[ProjectsController] Presigned URL notice:', s3Err);
            }
          }
        }

        const assetDocId = baseAsset._id || project.baseAssetId;
        const lookupIds: any[] = [assetDocId];
        if (baseAsset.publicId) {
          lookupIds.push(baseAsset.publicId);
        }

        const captionQuery = CaptionSetModel.findOne({
          $or: [
            { projectId: { $in: [project._id, project.publicId] } },
            { assetId: { $in: lookupIds } },
          ],
        });
        const captionPromise =
          typeof (captionQuery as any)?.sort === 'function'
            ? (captionQuery as any).sort({ updatedAt: -1 })
            : captionQuery;

        const [analysis, captionSet] = await Promise.all([
          AnalysisResultModel.findOne({ assetId: { $in: lookupIds } }),
          captionPromise,
        ]);

        if (analysis || captionSet) {
          const cues = captionSet?.cues || [];
          const totalWords = cues.reduce((sum: number, c: any) => sum + (c.words?.length || 0), 0);
          const snippet = cues
            .slice(0, 3)
            .map((c: any) => c.text)
            .join(' ');

          analysisSummary = {
            durationMs:
              baseAsset.media?.durationMs ||
              ((project as any).durationSec
                ? (project as any).durationSec * 1000
                : project.stats?.durationMs || 0),
            silencesCount: analysis?.silences?.length || 0,
            sceneCutsCount: analysis?.sceneCuts?.length || 0,
            bpm: analysis?.beats?.bpm || 120,
            integratedLufs: analysis?.loudness?.integratedLufs ?? -16.0,
            truePeakDb: analysis?.loudness?.truePeakDb ?? -1.0,
            status: analysis?.status || 'ready',
            cuesCount: cues.length,
            wordCount: totalWords,
            transcriptSnippet: snippet || undefined,
            cues: cues.map((c: any, cIdx: number) => ({
              id: c.id || `cue_${cIdx + 1}`,
              startMs: c.startMs,
              endMs: c.endMs,
              text: c.text,
              words: (c.words || []).map((w: any) => ({
                word: w.w || w.word || '',
                startMs: w.s !== undefined ? w.s : w.startMs || 0,
                endMs: w.e !== undefined ? w.e : w.endMs || 0,
                score: w.conf ?? w.score ?? 1,
              })),
            })),
          };
        }
      }

      let headPlan = null;
      let headPlanDoc = await EditPlanModel.findOne({
        projectId: project._id,
        version: project.headVersion > 0 ? project.headVersion : 1,
      });

      if (!headPlanDoc) {
        headPlanDoc = await EditPlanModel.findOne({
          projectId: project._id,
        }).sort({ version: -1 });
      }

      if (headPlanDoc) {
        headPlan = headPlanDoc.plan;
        if (project.headVersion !== headPlanDoc.version) {
          project.headVersion = headPlanDoc.version;
          if (typeof project.save === 'function') {
            await project.save();
          }
        }
      } else {
        // Auto-bootstrap baseline plan v1 so newly opened projects immediately have a valid EditPlan
        const baselinePlan: EditPlan = {
          schemaVersion: '1.0',
          projectId: project.publicId,
          baseAssetId:
            (project.baseAssetId as any)?._id?.toString() ||
            project.baseAssetId?.toString() ||
            'ast_base',
          version: 1,
          parentVersion: null,
          global: {
            aspect: project.settings?.aspect || '16:9',
            fps: project.settings?.fps || 30,
            resolution: '1080p',
          },
          layers: [
            {
              id: 'lyr_c1',
              layer: 'color',
              enabled: true,
              timebase: 'global',
              params: {
                preset: 'cinematic',
                contrast: 1.15,
                saturation: 0.95,
                vignette: 0.25,
              },
            },
          ],
          meta: {
            prompt: 'Initial project baseline',
            model: 'system-bootstrap',
            createdAt: new Date().toISOString(),
          },
        };

        try {
          const createdDoc = await EditPlanModel.create({
            projectId: project._id,
            version: 1,
            parentVersion: null,
            prompt: 'Initial project baseline',
            plan: baselinePlan,
            model: 'system-bootstrap',
          });
          headPlan = createdDoc.plan;
          project.headVersion = 1;
          if (typeof project.save === 'function') {
            await project.save();
          }
        } catch (planCreateErr: any) {
          if (planCreateErr.code === 11000) {
            const existing = await EditPlanModel.findOne({ projectId: project._id, version: 1 });
            if (existing) {
              headPlan = existing.plan;
              project.headVersion = 1;
              if (typeof project.save === 'function') {
                await project.save();
              }
            }
          }
        }
      }

      let chatMessages: any[] = [];
      try {
        const msgs = await ChatMessageModel.find({
          projectId: project._id || project.publicId,
          $or: [{ userId: req.user!._id }, { userId: { $exists: false } }],
        }).sort({ createdAt: 1 });

        chatMessages = msgs.map((m) => ({
          id: m._id ? m._id.toString() : `msg_${Date.now()}`,
          projectId: project.publicId || project._id.toString(),
          role: m.role,
          text: m.text,
          planId: m.planId?.toString(),
          versionResult: m.versionResult,
          planVersion: m.versionResult,
          timestamp: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
          createdAt: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
        }));
      } catch (chatErr) {
        console.warn('[ProjectsController] Chat messages load warning:', chatErr);
      }

      res.status(200).json({
        success: true,
        data: {
          project,
          plan: headPlan,
          previewUrl,
          baseProxyUrl: baseProxyUrl || previewUrl,
          isRenderedPreview,
          analysisSummary,
          chatMessages,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { title, settings, status } = req.body;

      const project = await ProjectModel.findOne({
        publicId: id,
        userId: req.user!._id,
        deletedAt: null,
      });

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or unauthorized');
      }

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          throw new AppError(400, 'INVALID_TITLE', 'Project title must be a non-empty string');
        }
        project.title = title.trim();
      }

      if (status !== undefined) {
        const validStatuses = [
          'draft',
          'uploading',
          'analyzing',
          'ready',
          'rendering',
          'error',
          'archived',
        ];
        if (!validStatuses.includes(status)) {
          throw new AppError(
            400,
            'INVALID_STATUS',
            `Status must be one of: ${validStatuses.join(', ')}`
          );
        }
        project.status = status;
      }

      if (settings) {
        project.settings = {
          ...project.settings,
          ...settings,
        };
      }

      await project.save();

      res.status(200).json({
        success: true,
        data: project,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async archiveProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const project = await ProjectModel.findOne({
        publicId: id,
        userId: req.user!._id,
        deletedAt: null,
      });

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or unauthorized');
      }

      project.status = 'archived';
      await project.save();

      res.status(200).json({
        success: true,
        data: project,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async unarchiveProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (req.query?.purge === 'true' || req.query?.permanent === 'true') {
        return ProjectsController.purgeProject(req, res, next);
      }

      const project = await ProjectModel.findOne({
        publicId: id,
        userId: req.user!._id,
        deletedAt: null,
      });

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or unauthorized');
      }

      project.status = project.baseAssetId ? 'ready' : 'draft';
      await project.save();

      res.status(200).json({
        success: true,
        data: project,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (req.query?.purge === 'true' || req.query?.permanent === 'true') {
        return ProjectsController.purgeProject(req, res, next);
      }

      const project = await ProjectModel.findOne({
        publicId: id,
        userId: req.user!._id,
        deletedAt: null,
      });

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found or unauthorized');
      }

      project.deletedAt = new Date();
      await project.save();

      res.status(200).json({
        success: true,
        data: { deleted: true, publicId: id },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async purgeProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await PurgeService.purgeProjectData(req.user!.id, id);
      res.status(200).json({
        success: true,
        data: result,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateCaptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { cues, language } = req.body;
      const rawUserId = req.user?._id;

      const project =
        (req as any).project ||
        (await ProjectModel.findOne({
          publicId: id,
          userId: rawUserId,
          deletedAt: null,
        }));

      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${id} not found or unauthorized`);
      }

      if (!Array.isArray(cues)) {
        throw new AppError(400, 'INVALID_CUES', 'cues must be an array of caption cues');
      }

      const normalizedCues = cues.map((cue: any, idx: number) => {
        const text = String(cue.text || '').trim();
        const startMs = Math.max(0, Math.round(Number(cue.startMs) || 0));
        const endMs = Math.max(startMs + 100, Math.round(Number(cue.endMs) || startMs + 1000));
        const tokens = text.split(/\s+/).filter(Boolean);

        let words: Array<{ w: string; s: number; e: number; conf: number }> = [];

        if (Array.isArray(cue.words) && cue.words.length === tokens.length && tokens.length > 0) {
          words = cue.words.map((w: any, wIdx: number) => ({
            w: String(w.w || w.word || tokens[wIdx] || ''),
            s: Math.max(
              0,
              Math.round(
                Number(w.s !== undefined ? w.s : w.startMs !== undefined ? w.startMs : startMs)
              )
            ),
            e: Math.max(
              0,
              Math.round(Number(w.e !== undefined ? w.e : w.endMs !== undefined ? w.endMs : endMs))
            ),
            conf: Number(w.conf ?? w.score ?? 1),
          }));
        } else if (tokens.length > 0) {
          const totalDur = endMs - startMs;
          const perWordDur = Math.max(100, Math.floor(totalDur / tokens.length));
          words = tokens.map((token, tIdx) => {
            const s = startMs + tIdx * perWordDur;
            const e = tIdx === tokens.length - 1 ? endMs : s + perWordDur;
            return {
              w: token,
              s,
              e: Math.max(s + 50, e),
              conf: 1,
            };
          });
        }

        return {
          id: String(cue.id || `cue_${idx + 1}`),
          startMs,
          endMs,
          text,
          speaker: cue.speaker || null,
          words,
        };
      });

      const captionSet = await CaptionSetModel.findOneAndUpdate(
        {
          $or: [
            { projectId: { $in: [project._id, project.publicId] } },
            ...(project.baseAssetId ? [{ assetId: project.baseAssetId }] : []),
          ],
        },
        {
          $set: {
            projectId: project._id,
            ...(project.baseAssetId ? { assetId: project.baseAssetId } : {}),
            cues: normalizedCues,
            origin: 'manual',
            ...(language ? { language } : {}),
            contentHash: crypto
              .createHash('sha256')
              .update(JSON.stringify(normalizedCues))
              .digest('hex'),
          },
        },
        { new: true, upsert: true }
      );

      // Return both raw doc and normalized frontend cues
      const formattedCues = normalizedCues.map((c) => ({
        id: c.id,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        words: c.words.map((w) => ({
          word: w.w,
          startMs: w.s,
          endMs: w.e,
          score: w.conf,
        })),
      }));

      res.status(200).json({
        success: true,
        data: {
          ...captionSet.toObject(),
          formattedCues,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
