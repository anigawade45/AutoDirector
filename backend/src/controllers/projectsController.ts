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
import { TranscriptionService } from '../services/ai/transcriptionService.js';
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

  static async createDemoProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const publicId = `prj_demo_${nanoid(8)}`;
      const assetPublicId = `ast_demo_${nanoid(8)}`;

      // 1. Create Demo Project
      const project = await ProjectModel.create({
        publicId,
        userId: req.user!._id,
        title: '🎬 Killer Demo: Long Raw Podcast Recording (Uncut)',
        status: 'ready',
        headVersion: 1,
        settings: {
          aspect: '16:9',
          fps: 30,
          width: 1920,
          height: 1080,
          language: 'en',
        },
      });

      // 2. Create Base Video Asset (3 minutes / 180s raw footage)
      const asset = await AssetModel.create({
        publicId: assetPublicId,
        userId: req.user!._id,
        projectId: project._id,
        type: 'video',
        status: 'ready',
        media: {
          durationMs: 180000,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'h264',
          audioCodec: 'aac',
          channels: 2,
          sampleRate: 48000,
        },
        s3: {
          rawKey: 'samples/raw_studio_recording.mp4',
          proxyKey: 'samples/raw_studio_recording_480p.mp4',
        },
      });

      project.baseAssetId = asset._id as any;

      // 3. Create Initial Head Timeline
      const timeline = await TimelineModel.create({
        projectId: project._id,
        userId: req.user!._id,
        rev: 0,
        version: 1,
        fps: 30,
        width: 1920,
        height: 1080,
        durationMs: 180000,
        tracks: [],
      });
      project.timelineId = timeline._id as any;
      await project.save();

      // 4. Create Detailed Multimodal CaptionSet with False Starts & Winning Takes
      const demoCues = [
        {
          id: 'cue_1',
          startMs: 0,
          endMs: 4200,
          speaker: 'Alex',
          text: 'Um, hey everyone... wait, let me check the mic. Can we restart?',
          words: [
            { w: 'Um,', s: 0, e: 600, conf: 0.92 },
            { w: 'hey', s: 650, e: 1000, conf: 0.95 },
            { w: 'everyone...', s: 1050, e: 1800, conf: 0.96 },
            { w: 'wait,', s: 2000, e: 2400, conf: 0.94 },
            { w: 'let', s: 2450, e: 2700, conf: 0.97 },
            { w: 'me', s: 2720, e: 2900, conf: 0.98 },
            { w: 'check', s: 2950, e: 3300, conf: 0.96 },
            { w: 'the', s: 3350, e: 3500, conf: 0.98 },
            { w: 'mic.', s: 3550, e: 3900, conf: 0.97 },
            { w: 'Can', s: 3950, e: 4050, conf: 0.95 },
            { w: 'we', s: 4060, e: 4120, conf: 0.96 },
            { w: 'restart?', s: 4130, e: 4200, conf: 0.95 },
          ],
        },
        {
          id: 'cue_2',
          startMs: 6200,
          endMs: 11400,
          speaker: 'Alex',
          text: 'Hey guys, welcome back to... wait, no, let me start with the hook.',
          words: [
            { w: 'Hey', s: 6200, e: 6600, conf: 0.96 },
            { w: 'guys,', s: 6650, e: 7100, conf: 0.97 },
            { w: 'welcome', s: 7150, e: 7700, conf: 0.98 },
            { w: 'back', s: 7750, e: 8100, conf: 0.97 },
            { w: 'to...', s: 8150, e: 8700, conf: 0.95 },
            { w: 'wait,', s: 9000, e: 9400, conf: 0.94 },
            { w: 'no,', s: 9450, e: 9800, conf: 0.96 },
            { w: 'let', s: 9850, e: 10100, conf: 0.97 },
            { w: 'me', s: 10150, e: 10300, conf: 0.98 },
            { w: 'start', s: 10350, e: 10700, conf: 0.97 },
            { w: 'with', s: 10750, e: 10950, conf: 0.98 },
            { w: 'the', s: 10980, e: 11100, conf: 0.98 },
            { w: 'hook.', s: 11150, e: 11400, conf: 0.97 },
          ],
        },
        {
          id: 'cue_3',
          startMs: 13000,
          endMs: 22500,
          speaker: 'Alex',
          text: 'Today, we are revealing the secret to 10x developer productivity that nobody is talking about.',
          words: [
            { w: 'Today,', s: 13000, e: 13600, conf: 0.98 },
            { w: 'we', s: 13650, e: 13850, conf: 0.99 },
            { w: 'are', s: 13900, e: 14100, conf: 0.98 },
            { w: 'revealing', s: 14150, e: 14800, conf: 0.99 },
            { w: 'the', s: 14850, e: 15000, conf: 0.98 },
            { w: 'secret', s: 15050, e: 15600, conf: 0.99 },
            { w: 'to', s: 15650, e: 15800, conf: 0.99 },
            { w: '10x', s: 15850, e: 16400, conf: 0.99 },
            { w: 'developer', s: 16450, e: 17200, conf: 0.98 },
            { w: 'productivity', s: 17250, e: 18400, conf: 0.99 },
            { w: 'that', s: 18500, e: 18800, conf: 0.98 },
            { w: 'nobody', s: 18850, e: 19500, conf: 0.99 },
            { w: 'is', s: 19550, e: 19750, conf: 0.98 },
            { w: 'talking', s: 19800, e: 20400, conf: 0.99 },
            { w: 'about.', s: 20450, e: 22500, conf: 0.98 },
          ],
        },
        {
          id: 'cue_4',
          startMs: 23000,
          endMs: 32000,
          speaker: 'Alex',
          text: 'Most engineers think writing faster code is the answer, but the real leverage is in autonomous agent workflows.',
          words: [
            { w: 'Most', s: 23000, e: 23500, conf: 0.98 },
            { w: 'engineers', s: 23550, e: 24200, conf: 0.98 },
            { w: 'think', s: 24250, e: 24600, conf: 0.99 },
            { w: 'writing', s: 24650, e: 25100, conf: 0.98 },
            { w: 'faster', s: 25150, e: 25700, conf: 0.99 },
            { w: 'code', s: 25750, e: 26200, conf: 0.98 },
            { w: 'is', s: 26250, e: 26400, conf: 0.99 },
            { w: 'the', s: 26450, e: 26600, conf: 0.99 },
            { w: 'answer,', s: 26650, e: 27200, conf: 0.98 },
            { w: 'but', s: 27400, e: 27600, conf: 0.98 },
            { w: 'the', s: 27650, e: 27800, conf: 0.99 },
            { w: 'real', s: 27850, e: 28300, conf: 0.99 },
            { w: 'leverage', s: 28350, e: 29000, conf: 0.98 },
            { w: 'is', s: 29050, e: 29200, conf: 0.99 },
            { w: 'in', s: 29250, e: 29400, conf: 0.99 },
            { w: 'autonomous', s: 29450, e: 30400, conf: 0.98 },
            { w: 'agent', s: 30450, e: 30900, conf: 0.99 },
            { w: 'workflows.', s: 30950, e: 32000, conf: 0.98 },
          ],
        },
        {
          id: 'cue_5',
          startMs: 33000,
          endMs: 44000,
          speaker: 'Sarah',
          text: 'When you combine AI edit planning with instant timeline manipulation, you eliminate hours of manual grunt work.',
          words: [
            { w: 'When', s: 33000, e: 33400, conf: 0.98 },
            { w: 'you', s: 33450, e: 33650, conf: 0.99 },
            { w: 'combine', s: 33700, e: 34300, conf: 0.98 },
            { w: 'AI', s: 34350, e: 34800, conf: 0.99 },
            { w: 'edit', s: 34850, e: 35200, conf: 0.98 },
            { w: 'planning', s: 35250, e: 35900, conf: 0.99 },
            { w: 'with', s: 35950, e: 36200, conf: 0.99 },
            { w: 'instant', s: 36250, e: 36800, conf: 0.98 },
            { w: 'timeline', s: 36850, e: 37500, conf: 0.99 },
            { w: 'manipulation,', s: 37550, e: 38600, conf: 0.98 },
            { w: 'you', s: 38800, e: 39000, conf: 0.99 },
            { w: 'eliminate', s: 39050, e: 39800, conf: 0.98 },
            { w: 'hours', s: 39850, e: 40400, conf: 0.99 },
            { w: 'of', s: 40450, e: 40650, conf: 0.99 },
            { w: 'manual', s: 40700, e: 41300, conf: 0.98 },
            { w: 'grunt', s: 41350, e: 41800, conf: 0.99 },
            { w: 'work.', s: 41850, e: 44000, conf: 0.98 },
          ],
        },
        {
          id: 'cue_6',
          startMs: 58000,
          endMs: 72000,
          speaker: 'Alex',
          text: 'Here is the big mistake: people try to edit long-form videos by manually scrubbing through hours of dead air and false starts.',
          words: [
            { w: 'Here', s: 58000, e: 58400, conf: 0.98 },
            { w: 'is', s: 58450, e: 58650, conf: 0.99 },
            { w: 'the', s: 58700, e: 58850, conf: 0.99 },
            { w: 'big', s: 58900, e: 59300, conf: 0.98 },
            { w: 'mistake:', s: 59350, e: 60100, conf: 0.99 },
            { w: 'people', s: 60300, e: 60800, conf: 0.98 },
            { w: 'try', s: 60850, e: 61200, conf: 0.99 },
            { w: 'to', s: 61250, e: 61450, conf: 0.99 },
            { w: 'edit', s: 61500, e: 61900, conf: 0.98 },
            { w: 'long-form', s: 61950, e: 62700, conf: 0.99 },
            { w: 'videos', s: 62750, e: 63400, conf: 0.98 },
            { w: 'by', s: 63500, e: 63750, conf: 0.99 },
            { w: 'manually', s: 63800, e: 64500, conf: 0.98 },
            { w: 'scrubbing', s: 64550, e: 65300, conf: 0.99 },
            { w: 'through', s: 65350, e: 65700, conf: 0.98 },
            { w: 'hours', s: 65750, e: 66300, conf: 0.99 },
            { w: 'of', s: 66350, e: 66550, conf: 0.99 },
            { w: 'dead', s: 66600, e: 67000, conf: 0.98 },
            { w: 'air', s: 67050, e: 67400, conf: 0.99 },
            { w: 'and', s: 67500, e: 67750, conf: 0.98 },
            { w: 'false', s: 67800, e: 68300, conf: 0.99 },
            { w: 'starts.', s: 68350, e: 72000, conf: 0.98 },
          ],
        },
        {
          id: 'cue_7',
          startMs: 73000,
          endMs: 90000,
          speaker: 'Sarah',
          text: 'Instead, multimodal vision and acoustic models can index the speech, silence, and scene cuts in seconds.',
          words: [
            { w: 'Instead,', s: 73000, e: 73700, conf: 0.98 },
            { w: 'multimodal', s: 73800, e: 74700, conf: 0.99 },
            { w: 'vision', s: 74750, e: 75300, conf: 0.98 },
            { w: 'and', s: 75350, e: 75550, conf: 0.99 },
            { w: 'acoustic', s: 75600, e: 76300, conf: 0.98 },
            { w: 'models', s: 76350, e: 76900, conf: 0.99 },
            { w: 'can', s: 77000, e: 77250, conf: 0.98 },
            { w: 'index', s: 77300, e: 77800, conf: 0.99 },
            { w: 'the', s: 77850, e: 78050, conf: 0.99 },
            { w: 'speech,', s: 78100, e: 78700, conf: 0.98 },
            { w: 'silence,', s: 78900, e: 79600, conf: 0.99 },
            { w: 'and', s: 79700, e: 79950, conf: 0.98 },
            { w: 'scene', s: 80000, e: 80450, conf: 0.99 },
            { w: 'cuts', s: 80500, e: 81000, conf: 0.98 },
            { w: 'in', s: 81100, e: 81350, conf: 0.99 },
            { w: 'seconds.', s: 81400, e: 90000, conf: 0.98 },
          ],
        },
        {
          id: 'cue_8',
          startMs: 125000,
          endMs: 145000,
          speaker: 'Alex',
          text: 'The magic happens when you prompt the agent: tighten the hook, remove repeated takes, and drop in B-roll automatically.',
          words: [
            { w: 'The', s: 125000, e: 125250, conf: 0.98 },
            { w: 'magic', s: 125300, e: 125850, conf: 0.99 },
            { w: 'happens', s: 125900, e: 126500, conf: 0.98 },
            { w: 'when', s: 126550, e: 126800, conf: 0.99 },
            { w: 'you', s: 126850, e: 127100, conf: 0.98 },
            { w: 'prompt', s: 127150, e: 127700, conf: 0.99 },
            { w: 'the', s: 127750, e: 127950, conf: 0.99 },
            { w: 'agent:', s: 128000, e: 128700, conf: 0.98 },
            { w: 'tighten', s: 128900, e: 129500, conf: 0.99 },
            { w: 'the', s: 129550, e: 129750, conf: 0.99 },
            { w: 'hook,', s: 129800, e: 130400, conf: 0.98 },
            { w: 'remove', s: 130600, e: 131200, conf: 0.99 },
            { w: 'repeated', s: 131250, e: 131900, conf: 0.98 },
            { w: 'takes,', s: 131950, e: 132600, conf: 0.99 },
            { w: 'and', s: 132750, e: 133000, conf: 0.98 },
            { w: 'drop', s: 133050, e: 133500, conf: 0.99 },
            { w: 'in', s: 133550, e: 133750, conf: 0.99 },
            { w: 'B-roll', s: 133800, e: 134500, conf: 0.98 },
            { w: 'automatically.', s: 134550, e: 145000, conf: 0.98 },
          ],
        },
        {
          id: 'cue_9',
          startMs: 146000,
          endMs: 165000,
          speaker: 'Sarah',
          text: 'And with one click, you extract three viral vertical Shorts formatted for TikTok, Reels, and YouTube Shorts.',
          words: [
            { w: 'And', s: 146000, e: 146300, conf: 0.98 },
            { w: 'with', s: 146350, e: 146650, conf: 0.99 },
            { w: 'one', s: 146700, e: 147050, conf: 0.98 },
            { w: 'click,', s: 147100, e: 147600, conf: 0.99 },
            { w: 'you', s: 147750, e: 148000, conf: 0.98 },
            { w: 'extract', s: 148050, e: 148700, conf: 0.99 },
            { w: 'three', s: 148750, e: 149200, conf: 0.98 },
            { w: 'viral', s: 149250, e: 149800, conf: 0.99 },
            { w: 'vertical', s: 149850, e: 150600, conf: 0.98 },
            { w: 'Shorts', s: 150650, e: 151300, conf: 0.99 },
            { w: 'formatted', s: 151450, e: 152200, conf: 0.98 },
            { w: 'for', s: 152250, e: 152500, conf: 0.99 },
            { w: 'TikTok,', s: 152550, e: 153200, conf: 0.98 },
            { w: 'Reels,', s: 153400, e: 154100, conf: 0.99 },
            { w: 'and', s: 154250, e: 154500, conf: 0.98 },
            { w: 'YouTube', s: 154550, e: 155100, conf: 0.99 },
            { w: 'Shorts.', s: 155150, e: 165000, conf: 0.98 },
          ],
        },
      ];

      await CaptionSetModel.create({
        assetId: asset._id,
        projectId: project._id,
        userId: req.user!._id,
        status: 'ready',
        cues: demoCues,
      });

      // 5. Create Multimodal AnalysisResult with Silences, Scene Cuts, and 3 Highlights
      await AnalysisResultModel.create({
        assetId: asset._id,
        projectId: project._id,
        status: 'ready',
        silences: [
          { startMs: 4200, endMs: 6200, avgDb: -52 },
          { startMs: 11400, endMs: 13000, avgDb: -50 },
          { startMs: 44500, endMs: 57500, avgDb: -48 },
          { startMs: 90500, endMs: 124500, avgDb: -49 },
        ],
        sceneCuts: [
          { tMs: 13000, score: 0.88 },
          { tMs: 58000, score: 0.92 },
          { tMs: 125000, score: 0.95 },
        ],
        beats: { bpm: 120, grid: [] },
        loudness: { integratedLufs: -16, truePeakDb: -1.0 },
        hook: {
          startMs: 13000,
          endMs: 22500,
          score: 0.98,
          reason: 'Curiosity-inducing 10x productivity hook',
        },
        chapters: [
          {
            id: 'ch_1',
            startMs: 0,
            endMs: 45000,
            title: 'Introduction & Hook: The 10x Secret',
            summary: 'Opening hook on autonomous agent leverage.',
          },
          {
            id: 'ch_2',
            startMs: 45000,
            endMs: 91000,
            title: 'Why Traditional Video Editing Fails',
            summary: 'The bottleneck of manual scrubbing vs multimodal AI indexing.',
          },
          {
            id: 'ch_3',
            startMs: 91000,
            endMs: 180000,
            title: 'Autonomous Multi-Track AI Architecture',
            summary: 'Live timeline operations, B-roll insertion, and 3 Shorts extraction.',
          },
        ],
        highlights: [
          {
            id: 'hl_1',
            startMs: 13000,
            endMs: 42000,
            score: 0.98,
            reason: 'High-impact value statement with viral opening hook',
          },
          {
            id: 'hl_2',
            startMs: 58000,
            endMs: 90000,
            score: 0.95,
            reason: 'Critical insight on manual vs AI workflows',
          },
          {
            id: 'hl_3',
            startMs: 125000,
            endMs: 165000,
            score: 0.94,
            reason: 'Actionable demonstration of agent automation & shorts',
          },
        ],
      });

      // 6. Create Initial Baseline EditPlan (v1)
      const baselinePlan: EditPlan = {
        schemaVersion: '1.0',
        projectId: project.publicId,
        baseAssetId: asset.publicId,
        version: 1,
        parentVersion: null,
        global: {
          aspect: '16:9',
          fps: 30,
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
          prompt: 'Initial raw studio footage baseline',
          model: 'system-bootstrap',
          createdAt: new Date().toISOString(),
        },
      };

      await EditPlanModel.create({
        projectId: project._id,
        version: 1,
        parentVersion: null,
        prompt: 'Initial raw studio footage baseline',
        plan: baselinePlan,
        model: 'system-bootstrap',
      });

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
        const captionSorted =
          typeof (captionQuery as any)?.sort === 'function'
            ? (captionQuery as any).sort({ updatedAt: -1 })
            : captionQuery;
        const captionPromise =
          typeof (captionSorted as any)?.lean === 'function'
            ? (captionSorted as any).lean()
            : captionSorted;

        const analysisQuery = AnalysisResultModel.findOne({ assetId: { $in: lookupIds } });
        const analysisPromise =
          typeof (analysisQuery as any)?.lean === 'function'
            ? (analysisQuery as any).lean()
            : analysisQuery;

        const [analysis, captionSet] = await Promise.all([
          analysisPromise,
          captionPromise,
        ]);

        if (analysis || captionSet) {
          let rawCues = (captionSet?.cues || []).map((c: any, cIdx: number) => {
            const cueObj = c && typeof c.toObject === 'function' ? c.toObject() : { ...c };
            const words = (cueObj.words || [])
              .map((w: any) => ({
                w: String(w.w || w.word || '').trim(),
                s: Number(w.s !== undefined ? w.s : w.startMs !== undefined ? w.startMs : w.start) || 0,
                e: Number(w.e !== undefined ? w.e : w.endMs !== undefined ? w.endMs : w.end) || 0,
                conf: typeof w.conf === 'number' ? w.conf : typeof w.score === 'number' ? w.score : 0.95,
              }))
              .filter((w: any) => w.w.length > 0);

            const text = String(
              cueObj.text ||
              cueObj.sentence ||
              cueObj.caption ||
              cueObj.transcript ||
              words.map((w: any) => w.w).join(' ') ||
              ''
            ).trim();

            return {
              id: cueObj.id || `cue_${cIdx + 1}`,
              startMs: Number(cueObj.startMs !== undefined ? cueObj.startMs : cueObj.start) || 0,
              endMs: Number(cueObj.endMs !== undefined ? cueObj.endMs : cueObj.end) || 0,
              text,
              words,
            };
          });
          const durationMs =
            baseAsset.media?.durationMs ||
            ((project as any).durationSec
              ? (project as any).durationSec * 1000
              : project.stats?.durationMs || 0);

          const cues = rawCues.length > 0 && durationMs > 0
            ? TranscriptionService.normalizeRawCues(rawCues, durationMs)
            : rawCues;
          const totalWords = cues.reduce((sum: number, c: any) => sum + (c.words?.length || 0), 0);
          const snippet = cues
            .slice(0, 3)
            .map((c: any) => c.text)
            .join(' ');

          analysisSummary = {
            durationMs,
            silencesCount: analysis?.silences?.length || 0,
            silences: (analysis?.silences || []).map((s: any) => ({
              startMs: s.startMs,
              endMs: s.endMs,
              durationMs: s.endMs - s.startMs,
            })),
            sceneCutsCount: analysis?.sceneCuts?.length || 0,
            bpm: analysis?.beats?.bpm || 120,
            integratedLufs: analysis?.loudness?.integratedLufs ?? -16.0,
            truePeakDb: analysis?.loudness?.truePeakDb ?? -1.0,
            status: analysis?.status || 'ready',
            cuesCount: cues.length,
            wordCount: totalWords,
            transcriptSnippet: snippet || undefined,
            highlights: analysis?.highlights || [],
            chapters: analysis?.chapters || [],
            hook: analysis?.hook || null,
            cues: cues.map((c: any, cIdx: number) => {
              const cueText = String(
                c.text ||
                (c.words || []).map((w: any) => w.w || w.word || '').join(' ') ||
                ''
              ).trim();
              return {
                id: c.id || `cue_${cIdx + 1}`,
                startMs: c.startMs,
                endMs: c.endMs,
                text: cueText,
                words: (c.words || []).map((w: any) => ({
                  word: w.w || w.word || '',
                  startMs: w.s !== undefined ? w.s : w.startMs || 0,
                  endMs: w.e !== undefined ? w.e : w.endMs || 0,
                  score: w.conf ?? w.score ?? 1,
                })),
              };
            }),
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

      const durationMs =
        ((project as any).durationSec
          ? (project as any).durationSec * 1000
          : project.stats?.durationMs || 0);

      const isSeconds = TranscriptionService.detectIfSeconds(cues, durationMs);

      const normalizedCues = cues.map((cue: any, idx: number) => {
        const text = String(cue.text || '').trim();
        const rawStart = cue.startMs ?? cue.start_ms ?? cue.start ?? cue.startTime ?? cue.s;
        const rawEnd = cue.endMs ?? cue.end_ms ?? cue.end ?? cue.endTime ?? cue.e;

        const startMs = Math.max(0, TranscriptionService.parseTimestampToMs(rawStart, isSeconds));
        const endMs = Math.max(
          startMs + 100,
          rawEnd !== undefined
            ? TranscriptionService.parseTimestampToMs(rawEnd, isSeconds)
            : startMs + 1000
        );
        const tokens = text.split(/\s+/).filter(Boolean);

        let words: Array<{ w: string; s: number; e: number; conf: number }> = [];

        if (Array.isArray(cue.words) && cue.words.length === tokens.length && tokens.length > 0) {
          words = cue.words.map((w: any, wIdx: number) => {
            const rawWs = w.s ?? w.start ?? w.startMs ?? w.start_ms ?? w.startTime;
            const rawWe = w.e ?? w.end ?? w.endMs ?? w.end_ms ?? w.endTime;
            const ws =
              rawWs !== undefined
                ? TranscriptionService.parseTimestampToMs(rawWs, isSeconds)
                : startMs;
            const we =
              rawWe !== undefined
                ? TranscriptionService.parseTimestampToMs(rawWe, isSeconds)
                : endMs;
            return {
              w: String(w.w || w.word || tokens[wIdx] || ''),
              s: Math.max(0, ws),
              e: Math.max(ws + 50, we),
              conf: Number(w.conf ?? w.score ?? 1),
            };
          });
        } else if (tokens.length > 0) {
          const totalDur = endMs - startMs;
          const weights = tokens.map((token) => {
            const cleanLen = token.replace(/[^a-zA-Z0-9]/g, '').length;
            let weight = Math.max(2, cleanLen);
            if (token.endsWith(',') || token.endsWith(';') || token.endsWith(':')) weight += 2.5;
            else if (token.endsWith('.') || token.endsWith('!') || token.endsWith('?'))
              weight += 4.5;
            return weight;
          });
          const totalWeight = weights.reduce((sum, w) => sum + w, 0);
          let currentStart = startMs;

          words = tokens.map((token, tIdx) => {
            const isLast = tIdx === tokens.length - 1;
            const tokenDur = isLast
              ? endMs - currentStart
              : Math.round((weights[tIdx] / totalWeight) * totalDur);
            const s = currentStart;
            const e = isLast ? endMs : Math.min(endMs, s + Math.max(80, tokenDur));
            currentStart = e;
            return {
              w: token,
              s,
              e: Math.max(s + 60, e),
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

      // Strictly resolve and clamp any overlapping cue boundaries before saving
      const sanitizedCues = TranscriptionService.resolveCueOverlaps(
        normalizedCues as any,
        30,
        durationMs > 0 ? durationMs : undefined
      );

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
            cues: sanitizedCues,
            origin: 'manual',
            ...(language ? { language } : {}),
            contentHash: crypto
              .createHash('sha256')
              .update(JSON.stringify(sanitizedCues))
              .digest('hex'),
          },
        },
        { new: true, upsert: true }
      );

      // Return both raw doc and normalized frontend cues
      const formattedCues = sanitizedCues.map((c) => ({
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
