import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EditPlan,
  snapToBeat,
  snapCutsToBeatGrid,
} from '@ai-video/shared';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { PlanNormalizer } from '../services/planner/planNormalizer.js';
import { PatchEngine } from '../services/planner/patchEngine.js';
import { GeminiPlannerAdapter } from '../services/planner/geminiAdapter.js';
import { Request, Response, NextFunction } from 'express';

// Mock models and services for isolated testing
vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findById: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ _id: 'tv_123' }),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_export_1' }),
  },
  previewQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_preview_1' }),
  },
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.mock/renders/job_123.mp4?signed=true'),
  },
}));

import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { RendersController } from '../controllers/rendersController.js';
import { PlansController } from '../controllers/plansController.js';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { JobsController } from '../controllers/jobsController.js';

describe('Phase 7 — Audio, History and Export Acceptance Suite', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    nextFn = vi.fn();
  });

  // =========================================================================
  // Gate 1: Beat Synchronization ("Cuts snap to beats within 60 ms")
  // =========================================================================
  describe('Gate 1: Beat Synchronization (Functional Spec §9 / Plan Phase 7)', () => {
    it('snaps cut boundaries to beat grid timestamps within 60 ms', () => {
      // Beat grid at 1.0s, 2.0s, 3.0s, 4.2s, 5.0s, 6.4s (in ms: 1000, 2000, 3000, 4200, 5000, 6400)
      const beatGridMs = [1000, 2000, 3000, 4200, 5000, 6400];

      // Cut boundary at 4.23s (30 ms away from 4.20s beat <= 60 ms)
      const snappedStart = snapToBeat(4.23, beatGridMs, 0.06);
      expect(snappedStart).toBe(4.2);
      expect(Math.abs(snappedStart - 4.2)).toBe(0);

      // Cut boundary at 6.36s (40 ms away from 6.40s beat <= 60 ms)
      const snappedEnd = snapToBeat(6.36, beatGridMs, 0.06);
      expect(snappedEnd).toBe(6.4);
      expect(Math.abs(snappedEnd - 6.4)).toBe(0);

      // Boundary far from beats: 7.15s (nearest beat 6.4s is 750ms away > 60 ms)
      const unSnapped = snapToBeat(7.15, beatGridMs, 0.06);
      expect(unSnapped).toBe(7.15); // Remains intact
    });

    it('snaps plan cut layers to musical beats in PlanNormalizer when beatSync is enabled', () => {
      const beatGridMs = [2000, 4000, 6000, 8000, 10000];
      const rawPlan: any = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_test',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 4.04, end: 6.03 }, // 40ms from 4.0s, 30ms from 6.0s
            params: { reason: 'silence', padding: 0.05 },
          },
          {
            id: 'lyr_m1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: { trackId: 'mus_calm_01', volume: 0.35, duckUnderSpeech: true, beatSync: true },
          },
        ],
        meta: { prompt: 'Cut silence with beat sync', model: 'ai-planner', createdAt: new Date().toISOString() },
      };

      const normalized = PlanNormalizer.normalize(rawPlan, {
        assetDurationSec: 30,
        catalog: { templates: [], luts: [], music: [{ id: 'mus_calm_01', name: 'Calm', mood: 'calm' }], fonts: ['Inter'] },
        beats: { bpm: 120, grid: beatGridMs },
      });

      const cutLayer = normalized.layers.find((l: any) => l.layer === 'cut');
      expect(cutLayer).toBeDefined();
      // Cuts snap to beats within 60 ms
      expect(Math.abs(cutLayer.range.start - 4.0)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(cutLayer.range.end - 6.0)).toBeLessThanOrEqual(0.06);
      expect(cutLayer.range.start).toBe(4.0);
      expect(cutLayer.range.end).toBe(6.0);
    });
  });

  // =========================================================================
  // Gate 2: Speech Ducking & Audio Loudness / Denoise
  // =========================================================================
  describe('Gate 2: Speech Ducking & Audio Processing (Spec §4.4 / Plan Phase 7)', () => {
    it('generates sidechain compression with at least 8 dB ducking attenuation, afade in/out, and EBU R128 loudnorm', () => {
      const plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_test',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_mus_1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: {
              trackId: 'mus_calm_01',
              volume: 0.3,
              duckUnderSpeech: true,
              fadeIn: 2.0,
              fadeOut: 3.5,
              beatSync: true,
            },
          },
          {
            id: 'lyr_aud_1',
            layer: 'audio',
            enabled: true,
            timebase: 'global',
            params: {
              normalizeLufs: -16,
              denoise: true,
            },
          },
        ],
        meta: { prompt: 'Cinematic music with speech ducking', model: 'ai', createdAt: new Date().toISOString() },
      };

      const compiled = FFmpegCompiler.compile(
        plan,
        {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        'final_1080p',
        { musicSourcePath: 'library/music/calm.mp3' }
      );

      const filterComplex = compiled.args[compiled.args.indexOf('-filter_complex') + 1];

      // 1. Audio Denoise (afftdn)
      expect(filterComplex).toContain('afftdn=nf=-25');

      // 2. Music volume and fade in/out
      expect(filterComplex).toContain('volume=0.3');
      expect(filterComplex).toContain('afade=t=in:st=0:d=2.00');
      expect(filterComplex).toContain('afade=t=out:st=26.50:d=3.50');

      // 3. Sidechain Compression (> 8 dB ducking)
      expect(filterComplex).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400');

      // Verify mathematical ducking attenuation:
      // threshold = 0.05 (-26 dB), ratio = 8:1
      // For speech input around -14 dB (exceeds threshold by 12 dB):
      // Attenuation = (1 - 1/8) * 12 dB = 10.5 dB >= 8 dB ducking!
      const thresholdLinear = 0.05;
      const ratio = 8;
      const speechRms = 0.2; // speech dialogue RMS (~ -14 dB)
      const overshootDb = 20 * Math.log10(speechRms / thresholdLinear); // ~12 dB
      const attenuationDb = (1 - 1 / ratio) * overshootDb;
      expect(attenuationDb).toBeGreaterThanOrEqual(8.0);

      // 4. EBU R128 Loudnorm
      expect(filterComplex).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    });
  });

  // =========================================================================
  // Gate 3: Follow-Up Prompts ("'Make subtitles bigger' changes only that parameter")
  // =========================================================================
  describe('Gate 3: Iterative Edits & Subtitle Parameter Isolation', () => {
    it('changes only the subtitle size parameter on "Make subtitles bigger" while keeping all other layers unchanged', () => {
      const v1Plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_base',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 2.0, end: 4.5 },
            params: { reason: 'silence', padding: 0.05 },
          },
          {
            id: 'lyr_col_1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: { preset: 'cinematic', contrast: 1.15, saturation: 0.9, vignette: 0.3 },
          },
          {
            id: 'lyr_sub_1',
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: {
              style: 'word_pop',
              font: 'Montserrat',
              size: 56, // Original size
              position: 'bottom',
              primaryColor: '#FFFFFF',
              highlightColor: '#FFD84D',
            },
          },
          {
            id: 'lyr_mus_1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: { trackId: 'mus_calm_01', volume: 0.35, duckUnderSpeech: true },
          },
        ],
        meta: { prompt: 'Make it cinematic', model: 'gemini', createdAt: '2026-11-04T10:00:00Z' },
      };

      const adapter = new GeminiPlannerAdapter();
      const output = (adapter as any).generateHeuristicPlan({
        systemInstructions: 'System',
        userPrompt: JSON.stringify({
          instruction: 'Make subtitles bigger',
          context: {
            currentPlan: v1Plan,
            targetVersion: 2,
          },
        }),
      });

      expect(output.structuredOutput.patch).toBeDefined();
      const patches = output.structuredOutput.patch;

      // Assert only 1 patch operation targetting subtitle size
      expect(patches.length).toBe(1);
      expect(patches[0].op).toBe('replace');
      expect(patches[0].path).toContain('size');
      expect(patches[0].value).toBe(72);

      // Apply the patch
      const { patchedPlan } = PatchEngine.apply(v1Plan, patches);

      // Subtitle size changed
      const subLayer = patchedPlan.layers.find((l: any) => l.layer === 'subtitle');
      expect(subLayer.params.size).toBe(72);
      expect(subLayer.params.font).toBe('Montserrat');
      expect(subLayer.params.highlightColor).toBe('#FFD84D');

      // All other layers preserved completely
      const cutLayer = patchedPlan.layers.find((l: any) => l.layer === 'cut');
      expect(cutLayer.range.start).toBe(2.0);
      expect(cutLayer.range.end).toBe(4.5);

      const colLayer = patchedPlan.layers.find((l: any) => l.layer === 'color');
      expect(colLayer.params.preset).toBe('cinematic');
      expect(colLayer.params.contrast).toBe(1.15);
      expect(colLayer.params.vignette).toBe(0.3);

      const musLayer = patchedPlan.layers.find((l: any) => l.layer === 'music');
      expect(musLayer.params.volume).toBe(0.35);
    });
  });

  // =========================================================================
  // Gate 4: Undo Restores the Previous Version
  // =========================================================================
  describe('Gate 4: Undo & Revert Restores Previous Version', () => {
    it('restores the prior plan version through server-side revert', async () => {
      const v1Plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_base',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_sub_1',
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: { style: 'word_pop', font: 'Montserrat', size: 56, position: 'bottom' },
          },
        ],
        meta: { prompt: 'Add subtitles', model: 'gemini', createdAt: '2026-11-04T10:00:00Z' },
      };

      const mockProject = {
        _id: 'mock_proj_id',
        publicId: 'prj_test',
        userId: 'mock_user_id',
        headVersion: 2,
        versions: [
          { version: 1, label: 'Add subtitles', source: 'ai' },
          { version: 2, label: 'Make subtitles bigger', source: 'ai' },
        ],
        save: vi.fn().mockResolvedValue(true),
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (EditPlanModel.findOne as any).mockResolvedValue({ plan: v1Plan });
      (EditPlanModel.create as any).mockResolvedValue({ _id: 'pln_v3' });
      (AssetModel.findById as any).mockResolvedValue({ media: { durationMs: 30000 } });

      mockReq = {
        params: { id: 'prj_test', v: '1' },
        user: { _id: 'mock_user_id' as any, id: 'mock_user_id', email: 'test@example.com', tier: 'pro' },
        id: 'req_undo_1',
      };

      await PlansController.revertPlan(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      const data = jsonMock.mock.calls[0][0].data;
      expect(data.version).toBe(3);
      expect(data.parentVersion).toBe(2);
      expect(data.restoredFromVersion).toBe(1);
      // Restored plan has the exact previous subtitle size of 56
      expect(data.plan.layers[0].params.size).toBe(56);
      expect(mockProject.headVersion).toBe(3);
    });
  });

  // =========================================================================
  // Gate 5: Final Export Profiles & Tier Gating
  // =========================================================================
  describe('Gate 5: Final Export Profiles & Entitlement Gating', () => {
    it('accepts final_1080p export for standard tier users', async () => {
      const mockProject = {
        _id: 'proj_1',
        publicId: 'prj_1',
        userId: 'user_free',
        headVersion: 1,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (TimelineVersionModel.findOne as any).mockResolvedValue({ snapshotHash: 'hash_1080p' });
      (RenderJobModel.create as any).mockResolvedValue({
        _id: 'job_export_1',
        save: vi.fn().mockResolvedValue(true),
      });

      mockReq = {
        params: { id: 'prj_1' },
        body: { planVersion: 1, profile: 'final_1080p' },
        user: { _id: 'user_free' as any, id: 'user_free', email: 'free@example.com', tier: 'free' },
        id: 'req_exp_1',
      };

      await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(202);
      const data = jsonMock.mock.calls[0][0].data;
      expect(data.jobId).toBe('job_job_export_1');
    });

    it('rejects 4K export for free tier with 403 UPGRADE_REQUIRED', async () => {
      const mockProject = {
        _id: 'proj_1',
        publicId: 'prj_1',
        userId: 'user_free',
        headVersion: 1,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      mockReq = {
        params: { id: 'prj_1' },
        body: { planVersion: 1, profile: 'final_4k' },
        user: { _id: 'user_free' as any, id: 'user_free', email: 'free@example.com', tier: 'free' },
        id: 'req_exp_2',
      };

      await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      const err = (nextFn as any).mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('UPGRADE_REQUIRED');
      expect(err.message).toContain('4K export profile is reserved for Pro');
    });

    it('allows 4K export for Pro tier users and compiles 3840x2160 with 384k audio', async () => {
      const mockProject = {
        _id: 'proj_1',
        publicId: 'prj_1',
        userId: 'user_pro',
        headVersion: 1,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (TimelineVersionModel.findOne as any).mockResolvedValue({ snapshotHash: 'hash_4k' });
      (RenderJobModel.create as any).mockResolvedValue({
        _id: 'job_export_4k',
        save: vi.fn().mockResolvedValue(true),
      });

      mockReq = {
        params: { id: 'prj_1' },
        body: { planVersion: 1, profile: 'final_4k' },
        user: { _id: 'user_pro' as any, id: 'user_pro', email: 'pro@example.com', tier: 'pro' },
        id: 'req_exp_3',
      };

      await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(202);

      // Verify FFmpeg compiler generates 4K dimensions and high bitrate
      const plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_1',
        baseAssetId: 'ast_1',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '4k' },
        layers: [],
        meta: { prompt: '4K render', model: 'gemini', createdAt: '2026-11-04T10:00:00Z' },
      };

      const compiled = FFmpegCompiler.compile(
        plan,
        { durationMs: 10000, width: 3840, height: 2160, fps: 30, silences: [], sceneCuts: [], beats: { bpm: 120, grid: [] }, loudness: { integratedLufs: -16, truePeakDb: -1.5 }, transcriptExcerpt: [] },
        'final_4k'
      );

      expect(compiled.args).toContain('-s');
      expect(compiled.args).toContain('3840x2160');
      expect(compiled.args).toContain('-b:a');
      expect(compiled.args).toContain('384k');
    });
  });

  // =========================================================================
  // Gate 6: Worker Completion Callback & Download URL Issuance
  // =========================================================================
  describe('Gate 6: Worker Completion Callback, Idempotency & Presigned Download URL', () => {
    it('handles worker render.completed callback, updates publishedVersion and issues download URL', async () => {
      const mockJob = {
        _id: '672b1234567890abcdef1234',
        userId: 'user_1',
        projectId: 'mock_proj_id',
        timelineVersion: 2,
        type: 'export',
        state: 'processing',
        percent: 90,
        output: null as any,
        timings: {},
        save: vi.fn().mockResolvedValue(true),
      };

      (RenderJobModel.findById as any).mockResolvedValue(mockJob);
      (RenderJobModel.findOne as any).mockResolvedValue(mockJob);

      // 1. Worker reports render.completed
      const callbackReq = {
        body: {
          eventId: 'evt_complete_01',
          eventType: 'render.completed',
          jobId: 'job_672b1234567890abcdef1234',
          projectId: 'mock_proj_id',
          planVersion: 2,
          profile: 'final_1080p',
          result: {
            outputKey: 'users/u1/projects/p1/renders/job_672b1234567890abcdef1234.mp4',
            durationMs: 30000,
            width: 1920,
            height: 1080,
            sizeBytes: 15420000,
          },
        },
        id: 'req_cb_1',
      };

      await WorkerEventsController.handleWorkerEvent(callbackReq as unknown as Request, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(mockJob.state).toBe('completed');
      expect(mockJob.output.key).toBe('users/u1/projects/p1/renders/job_672b1234567890abcdef1234.mp4');

      // Project publishedVersion updated to 2
      expect(ProjectModel.updateOne).toHaveBeenCalledWith(
        { _id: 'mock_proj_id' },
        { $set: { publishedVersion: 2, status: 'ready' } }
      );

      // 2. Duplicate callback delivery returns duplicate: true without re-executing
      jsonMock.mockClear();
      statusMock.mockClear();
      await WorkerEventsController.handleWorkerEvent(callbackReq as unknown as Request, mockRes as unknown as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      const duplicateData = jsonMock.mock.calls[0][0].data;
      expect(duplicateData.duplicate).toBe(true);

      // 3. User requests download URL for completed export job
      jsonMock.mockClear();
      statusMock.mockClear();
      const downloadReq = {
        params: { id: 'job_672b1234567890abcdef1234' },
        user: { _id: 'user_1' as any, id: 'user_1', email: 'test@example.com', tier: 'pro' },
        id: 'req_down_1',
      };

      await JobsController.getJobDownload(downloadReq as unknown as Request, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      const downloadData = jsonMock.mock.calls[0][0].data;
      expect(downloadData.url).toContain('https://s3.mock/renders/job_123.mp4');
      expect(downloadData.expiresInSeconds).toBe(3600);
    });
  });
});
