import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { TimelineModel } from '../models/Timeline.js';
import { S3Service } from '../services/storage/s3Service.js';
import { StorageKeys } from '../config/s3.js';
import { PurgeService } from '../services/maintenance/purgeService.js';
import { AppError } from '../middleware/errorHandler.js';

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

      if (project.baseAssetId) {
        const baseAsset = project.baseAssetId as any;

        // Check for rendered captioned preview first, then fall back to 480p proxy, then raw video
        const previewKey = StorageKeys.previewVideo(
          req.user!._id.toString(),
          project.publicId,
          project.headVersion || 1
        );
        let keyToSign = baseAsset.s3?.proxyKey || baseAsset.s3?.rawKey;

        try {
          const hasPreview = await S3Service.fileExists(previewKey);
          if (hasPreview) {
            keyToSign = previewKey;
          }
        } catch {
          // Keep proxy fallback
        }

        if (keyToSign) {
          try {
            previewUrl = await S3Service.getPresignedDownloadUrl(keyToSign, 7200);
          } catch (s3Err) {
            console.warn('[ProjectsController] Presigned URL notice:', s3Err);
          }
        }

        const [analysis, captionSet] = await Promise.all([
          AnalysisResultModel.findOne({ assetId: project.baseAssetId }),
          CaptionSetModel.findOne({ projectId: project._id, assetId: project.baseAssetId }),
        ]);

        if (analysis) {
          const cues = captionSet?.cues || [];
          const totalWords = cues.reduce((sum: number, c: any) => sum + (c.words?.length || 0), 0);
          const snippet = cues
            .slice(0, 3)
            .map((c: any) => c.text)
            .join(' ');

          analysisSummary = {
            durationMs: baseAsset.media?.durationMs || 0,
            silencesCount: analysis.silences?.length || 0,
            sceneCutsCount: analysis.sceneCuts?.length || 0,
            bpm: analysis.beats?.bpm || 120,
            integratedLufs: analysis.loudness?.integratedLufs ?? -16.0,
            truePeakDb: analysis.loudness?.truePeakDb ?? -1.0,
            status: analysis.status,
            cuesCount: cues.length,
            wordCount: totalWords,
            transcriptSnippet: snippet || undefined,
          };
        }
      }

      res.status(200).json({
        success: true,
        data: {
          project,
          previewUrl,
          analysisSummary,
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
}
