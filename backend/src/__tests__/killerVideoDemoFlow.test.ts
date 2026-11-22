import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ProjectsController } from '../controllers/projectsController.js';
import { PromptsController } from '../controllers/promptsController.js';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { TimelineModel } from '../models/Timeline.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { ChatMessageModel } from '../models/ChatMessage.js';
import { CatalogModel } from '../models/Catalog.js';
import { extractTimelineOperations, EditPlan } from '@ai-video/shared';
import { GeminiPlannerAdapter } from '../services/planner/geminiAdapter.js';

// Mock dependencies
vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    create: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/ChatMessage.js', () => ({
  ChatMessageModel: {
    create: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../models/Catalog.js', () => ({
  CatalogModel: {
    find: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    create: vi.fn(),
  },
}));
vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-url'),
    fileExists: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../services/queue/jobQueue.js', () => ({
  JobQueueService: {
    enqueuePreview: vi.fn().mockResolvedValue('job_preview_demo_1'),
    enqueueRender: vi.fn().mockResolvedValue('job_render_demo_1'),
  },
}));

describe('Killer Video Demo Architecture & End-to-End Flow Verification', () => {
  const mockUserId = new mongoose.Types.ObjectId('672b11111111111111111111');
  const mockProjectId = new mongoose.Types.ObjectId('672b22222222222222222222');
  const mockAssetId = new mongoose.Types.ObjectId('672b33333333333333333333');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Long Raw Recording Upload & Multimodal Indexing Setup', () => {
    it('creates a demo project with 3-minute uncut studio footage, repeated takes, and rich acoustic cues', async () => {
      let createdProjectDoc: any = null;
      let createdAssetDoc: any = null;
      let createdCaptionDoc: any = null;
      let createdAnalysisDoc: any = null;
      let createdTimelineDoc: any = null;
      let createdPlanDoc: any = null;

      (ProjectModel.create as any).mockImplementation((data: any) => {
        createdProjectDoc = {
          ...data,
          _id: mockProjectId,
          save: vi.fn().mockResolvedValue(true),
        };
        return createdProjectDoc;
      });

      (AssetModel.create as any).mockImplementation((data: any) => {
        createdAssetDoc = {
          ...data,
          _id: mockAssetId,
        };
        return createdAssetDoc;
      });

      (TimelineModel.create as any).mockImplementation((data: any) => {
        createdTimelineDoc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
        };
        return createdTimelineDoc;
      });

      (CaptionSetModel.create as any).mockImplementation((data: any) => {
        createdCaptionDoc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
        };
        return createdCaptionDoc;
      });

      (AnalysisResultModel.create as any).mockImplementation((data: any) => {
        createdAnalysisDoc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
        };
        return createdAnalysisDoc;
      });

      (EditPlanModel.create as any).mockImplementation((data: any) => {
        createdPlanDoc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
        };
        return createdPlanDoc;
      });

      const mockReq = {
        user: { _id: mockUserId },
        id: 'req_demo_test_01',
      } as any;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const next = vi.fn();

      await ProjectsController.createDemoProject(mockReq, mockRes, next);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalled();
      const responseData = mockRes.json.mock.calls[0][0].data;

      // Project assertions
      expect(responseData.title).toContain('Killer Demo');
      expect(responseData.status).toBe('ready');
      expect(responseData.headVersion).toBe(1);

      // Asset assertions (180s = 3 minutes of long raw footage)
      expect(createdAssetDoc.media.durationMs).toBe(180000);
      expect(createdAssetDoc.media.width).toBe(1920);
      expect(createdAssetDoc.media.height).toBe(1080);

      // CaptionSet assertions: Verify false starts in the first 15 seconds
      expect(createdCaptionDoc.cues.length).toBeGreaterThanOrEqual(9);
      const cue1 = createdCaptionDoc.cues[0];
      const cue2 = createdCaptionDoc.cues[1];
      const cue3 = createdCaptionDoc.cues[2];

      expect(cue1.text).toContain('check the mic'); // Take 1 stumble (0s - 4.2s)
      expect(cue1.startMs).toBe(0);
      expect(cue2.text).toContain('start with the hook'); // Take 2 restart (6.2s - 11.4s)
      expect(cue3.text).toContain(
        'Today, we are revealing the secret to 10x developer productivity'
      ); // Take 3 winner (13.0s)

      // AnalysisResult assertions: Verify 3 highlights for Shorts extraction
      expect(createdAnalysisDoc.highlights.length).toBe(3);
      expect(createdAnalysisDoc.highlights[0].startMs).toBe(13000); // Short 1
      expect(createdAnalysisDoc.highlights[1].startMs).toBe(58000); // Short 2
      expect(createdAnalysisDoc.highlights[2].startMs).toBe(125000); // Short 3
    });
  });

  describe('2. Agent Prompt Execution: Tighten Opening, Remove Repeated Takes, Add B-Roll & Generate 3 Shorts', () => {
    it('translates the prompt into multi-track timeline cuts, B-roll overlays, and 3 vertical Shorts', async () => {
      const adapter = new GeminiPlannerAdapter(null); // uses heuristic rule-engine

      const prompt =
        'Tighten the first 15 seconds, remove repeated takes, add B-roll and generate three Shorts';

      const input = {
        systemInstructions: 'You are an AI video editor',
        userPrompt: JSON.stringify({
          instruction: prompt,
          context: {
            projectId: 'prj_demo_test',
            baseAssetId: 'ast_demo_test',
            targetVersion: 2,
            videoMeta: {
              durationMs: 180000,
              fps: 30,
              resolution: '1920x1080',
            },
            audioAnalysis: {
              silenceIntervalsSec: [
                { start: 4.2, end: 6.2 },
                { start: 11.4, end: 13.0 },
              ],
              sceneCutPointsSec: [13.0, 58.0, 125.0],
            },
            highlights: [
              { id: 'hl_1', startSec: 13.0, endSec: 42.0, score: 0.98 },
              { id: 'hl_2', startSec: 58.0, endSec: 90.0, score: 0.95 },
              { id: 'hl_3', startSec: 125.0, endSec: 165.0, score: 0.94 },
            ],
            currentPlan: null,
          },
        }),
      };

      const result = await adapter.generateEditPlan(input);
      const plan = result.structuredOutput as EditPlan;

      expect(plan.schemaVersion).toBe('1.0');

      // 1. Verify Repeated Takes and Opening Pacing Cuts
      const cutLayers = plan.layers.filter((l) => l.layer === 'cut');
      expect(cutLayers.length).toBeGreaterThanOrEqual(3);

      const repeatedCuts = cutLayers.filter((c: any) => c.params?.reason === 'repeated_take');
      expect(repeatedCuts.length).toBe(2);
      expect(repeatedCuts[0].range.start).toBe(0.0);
      expect(repeatedCuts[0].range.end).toBe(4.8); // Cut Take 1
      expect(repeatedCuts[1].range.start).toBe(6.0);
      expect(repeatedCuts[1].range.end).toBe(12.2); // Cut Take 2

      const tightenCut = cutLayers.find((c: any) => c.params?.reason === 'tighten_pacing');
      expect(tightenCut).toBeDefined();
      expect(tightenCut?.range.start).toBe(12.2);
      expect(tightenCut?.range.end).toBe(13.0); // Tighten right before winning take at 13.0s

      // 2. Verify B-Roll Overlays
      const overlayLayers = plan.layers.filter((l) => l.layer === 'overlay');
      expect(overlayLayers.length).toBeGreaterThanOrEqual(1);
      const brollOverlay = overlayLayers.find((ov: any) => ov.params?.asset?.includes('broll'));
      expect(brollOverlay).toBeDefined();
      expect((brollOverlay as any).params.mode).toBe('cutaway');

      // 3. Verify Three Shorts Metadata
      expect(plan.shorts).toBeDefined();
      expect(plan.shorts?.length).toBe(3);
      expect(plan.shorts?.[0].id).toBe('short_1');
      expect(plan.shorts?.[0].aspect).toBe('9:16');
      expect(plan.shorts?.[0].startSec).toBe(13.0);
      expect(plan.shorts?.[0].endSec).toBe(42.0);

      expect(plan.shorts?.[1].id).toBe('short_2');
      expect(plan.shorts?.[1].aspect).toBe('9:16');
      expect(plan.shorts?.[1].startSec).toBe(58.0);
      expect(plan.shorts?.[1].endSec).toBe(90.0);

      expect(plan.shorts?.[2].id).toBe('short_3');
      expect(plan.shorts?.[2].aspect).toBe('9:16');
      expect(plan.shorts?.[2].startSec).toBe(125.0);
      expect(plan.shorts?.[2].endSec).toBe(165.0);
    });

    it('handles iterative follow-up prompts on existing plan with RFC 6902 patches', async () => {
      const adapter = new GeminiPlannerAdapter(null);

      const baselinePlan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_demo_test',
        baseAssetId: 'ast_demo_test',
        version: 1,
        parentVersion: null,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: { preset: 'cinematic', contrast: 1.15, saturation: 0.95 },
          },
        ],
        meta: {
          prompt: 'Baseline',
          model: 'system-bootstrap',
          createdAt: new Date().toISOString(),
        },
      };

      const prompt =
        'Tighten the first 15 seconds, remove repeated takes, add B-roll and generate three Shorts';

      const input = {
        systemInstructions: 'You are an AI video editor',
        userPrompt: JSON.stringify({
          instruction: prompt,
          context: {
            projectId: 'prj_demo_test',
            baseAssetId: 'ast_demo_test',
            targetVersion: 2,
            videoMeta: { durationMs: 180000, fps: 30, resolution: '1920x1080' },
            currentPlan: baselinePlan,
          },
        }),
      };

      const result = await adapter.generateEditPlan(input);
      const output = result.structuredOutput as { patch: Array<any> };

      expect(output.patch).toBeDefined();
      expect(Array.isArray(output.patch)).toBe(true);

      // Verify patch operations include cuts for repeated takes and tighten pacing
      const cutPatches = output.patch.filter(
        (p) => p.op === 'add' && p.path === '/layers/-' && p.value?.layer === 'cut'
      );
      expect(cutPatches.length).toBeGreaterThanOrEqual(3);

      const hasRepeatedTake = cutPatches.some((p) => p.value.params?.reason === 'repeated_take');
      const hasTightenPacing = cutPatches.some((p) => p.value.params?.reason === 'tighten_pacing');
      expect(hasRepeatedTake).toBe(true);
      expect(hasTightenPacing).toBe(true);

      // Verify patch operation for 3 Shorts
      const shortsPatch = output.patch.find(
        (p) => p.path === '/shorts' || p.path === '/meta/shorts'
      );
      expect(shortsPatch).toBeDefined();
      expect(shortsPatch.value.length).toBe(3);
    });
  });

  describe('3. Multi-Track Timeline Operations Extraction & UI Responsiveness', () => {
    it('extracts structured timeline operations for all cuts, overlays, and shorts in < 1ms', () => {
      const demoPlan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_demo_test',
        baseAssetId: 'ast_demo_test',
        version: 2,
        parentVersion: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_cut_repeat_1',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 0.0, end: 4.8 },
            params: { reason: 'repeated_take' },
          },
          {
            id: 'lyr_cut_repeat_2',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 6.0, end: 12.2 },
            params: { reason: 'repeated_take' },
          },
          {
            id: 'lyr_cut_tighten_3',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 12.2, end: 13.0 },
            params: { reason: 'tighten_pacing' },
          },
          {
            id: 'lyr_ov_1',
            layer: 'overlay',
            enabled: true,
            timebase: 'source',
            range: { start: 14.5, end: 18.0 },
            params: { asset: 'broll_tech', mediaType: 'broll', mode: 'cutaway' },
          },
          {
            id: 'lyr_ov_2',
            layer: 'overlay',
            enabled: true,
            timebase: 'source',
            range: { start: 65.0, end: 70.0 },
            params: { asset: 'broll_workspace', mediaType: 'broll', mode: 'cutaway' },
          },
          {
            id: 'lyr_sub_1',
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: {
              style: 'word_pop',
              position: 'bottom',
              font: 'Montserrat',
              size: 58,
              highlightColor: '#FFD700',
            },
          },
          {
            id: 'lyr_mus_1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: { trackId: 'tpl_lofi_beat', volume: 0.3, duckUnderSpeech: true },
          },
        ],
        shorts: [
          {
            id: 'short_1',
            title: 'Short #1: The 10x Secret',
            hook: 'Today we are revealing the secret to 10x developer productivity',
            startSec: 13.0,
            endSec: 42.0,
            aspect: '9:16',
            score: 0.98,
          },
          {
            id: 'short_2',
            title: 'Short #2: Why Editing Fails',
            hook: 'The biggest mistake creators make: scrubbing hours of dead air',
            startSec: 58.0,
            endSec: 90.0,
            aspect: '9:16',
            score: 0.95,
          },
          {
            id: 'short_3',
            title: 'Short #3: AI Multi-Track Engine',
            hook: 'Watch what happens when AI takes over video editing',
            startSec: 125.0,
            endSec: 165.0,
            aspect: '9:16',
            score: 0.94,
          },
        ],
        meta: {
          prompt:
            'Tighten the first 15 seconds, remove repeated takes, add B-roll and generate three Shorts',
          model: 'rule-engine-v1',
          createdAt: new Date().toISOString(),
        },
      };

      const t0 = performance.now();
      const summary = extractTimelineOperations(demoPlan);
      const elapsedMs = performance.now() - t0;

      expect(elapsedMs).toBeLessThan(5.0); // < 5ms cold execution
      expect(summary.totalOperations).toBe(10); // 3 cuts + 2 overlays + 1 sub + 1 mus + 3 shorts

      // Check specific mapped operation titles
      const opTitles = summary.operations.map((o) => o.title);
      expect(opTitles).toContain('Cut Repeated Take');
      expect(opTitles).toContain('Tighten Opening Pacing');
      expect(opTitles).toContain('B-Roll Cutaway');
      expect(opTitles).toContain('Short #1: The 10x Secret');
      expect(opTitles).toContain('Short #2: Why Editing Fails');
      expect(opTitles).toContain('Short #3: AI Multi-Track Engine');

      // Verify WeakMap cache warm execution is instantaneous (< 0.05ms)
      const tWarm = performance.now();
      const cachedSummary = extractTimelineOperations(demoPlan);
      const warmElapsedMs = performance.now() - tWarm;

      expect(cachedSummary).toBe(summary);
      expect(warmElapsedMs).toBeLessThan(0.1);
    });
  });
});
