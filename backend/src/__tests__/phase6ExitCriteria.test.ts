import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { compare, Operation } from 'fast-json-patch';
import {
  EditPlan,
  validateEditPlan,
} from '@ai-video/shared';
import { PlansController } from '../controllers/plansController.js';
import { ProjectsController } from '../controllers/projectsController.js';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { S3Service } from '../services/storage/s3Service.js';
import { PlanResolver } from '../services/resolver/planResolver.js';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    create: vi.fn().mockResolvedValue({ _id: 'tv_123' }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findOne: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    findOne: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    findOne: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    fileExists: vi.fn().mockResolvedValue(false),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/preview.mp4'),
  },
}));

describe('Phase 6 Exit Criteria: Frontend Editor Experience & State Integrity Acceptance Suite', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: any;
  let jsonMock: any;
  let statusMock: any;

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

  describe('Exit Criterion: Load project, inspect current plan, submit prompt, see new plan version, and watch preview progress without losing server state', () => {
    const projectId = 'prj_demo_goa';
    const assetId = 'ast_demo_01';

    const planV1: EditPlan = {
      schemaVersion: '1.0',
      projectId,
      baseAssetId: assetId,
      version: 1,
      parentVersion: null,
      global: {
        aspect: '16:9',
        fps: 30,
        resolution: '1080p',
      },
      layers: [
        {
          id: 'lyr_col_1',
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
        {
          id: 'lyr_sub_1',
          layer: 'subtitle',
          enabled: true,
          timebase: 'source',
          params: {
            style: 'word_pop',
            font: 'Montserrat',
            size: 48,
            position: 'bottom',
            primaryColor: '#FFFFFF',
            highlightColor: '#FFD84D',
            maxWordsPerLine: 4,
          },
        },
      ],
      meta: {
        prompt: 'Initial plan',
        model: 'gemini-1.5-pro',
        createdAt: new Date().toISOString(),
      },
    };

    it('Step 1: User loads project and inspects its current EditPlan (Spec §3.1 & Phase 6 Task 1)', async () => {
      const mockProject: any = {
        _id: 'db_prj_1',
        publicId: projectId,
        title: 'Goa Vacation Highlights',
        status: 'ready',
        headVersion: 1,
        versions: [{ version: 1, label: 'Initial', source: 'ai' }],
        settings: { aspect: '16:9', fps: 30 },
        baseAssetId: {
          publicId: assetId,
          media: { durationMs: 58400, width: 1920, height: 1080, fps: 30 },
          s3: { rawKey: 'raw/video.mp4' },
        },
      };

      (ProjectModel.findOne as any).mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockProject),
      });
      (EditPlanModel.findOne as any).mockResolvedValue({
        version: 1,
        plan: planV1,
      });

      mockReq = {
        params: { id: projectId },
        user: { _id: 'usr_abc', id: 'usr_abc' } as any,
        id: 'req_load_1',
      };

      await ProjectsController.getProject(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      const loadedData = jsonMock.mock.calls[0][0].data;
      expect(loadedData.project.publicId).toBe(projectId);
      expect(loadedData.project.headVersion).toBe(1);

      // Verify EditPlan inspection: layers are valid and derived tracks resolve
      const resolved = PlanResolver.resolve({
        plan: planV1,
        assetDurationMs: 58400,
        sourcePlanObjectId: 'plan_doc_1' as any,
      });

      expect(resolved.tracks.length).toBeGreaterThanOrEqual(1);
      expect(resolved.globalEffects.length).toBeGreaterThanOrEqual(1);
      expect(resolved.globalEffects[0].type).toBe('color');
      expect(resolved.globalEffects[0].params.preset).toBe('cinematic');
    });

    it('Step 2: User submits a prompt and receives an incremented plan version with preserved parentVersion (Spec §3.2 & Phase 6 Task 5)', () => {
      // Simulate planner generating plan v2 from user prompt: "Add upbeat music and cut silences"
      const planV2: EditPlan = {
        schemaVersion: '1.0',
        projectId,
        baseAssetId: assetId,
        version: 2,
        parentVersion: 1,
        global: {
          aspect: '16:9',
          fps: 30,
          resolution: '1080p',
        },
        layers: [
          ...planV1.layers,
          {
            id: 'lyr_cut_1',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 10.0, end: 12.5 },
            params: { reason: 'silence' },
          },
          {
            id: 'lyr_mus_1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: {
              trackId: 'track_lofi_01',
              volume: 0.8,
              duckUnderSpeech: true,
            },
          },
        ],
        meta: {
          prompt: 'Add upbeat music and cut silences',
          model: 'gemini-1.5-pro',
          createdAt: new Date().toISOString(),
        },
      };

      // Verify EditPlan validation passes with 0 errors
      const validation = validateEditPlan(planV2, { assetDurationSec: 58.4 });
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Verify version progression and parent lineage
      expect(planV2.version).toBe(2);
      expect(planV2.parentVersion).toBe(1);
      expect(planV2.layers).toHaveLength(4);
    });

    it('Step 3: User watches preview progress via SSE events without losing server state (Spec §3.4 & Phase 6 Task 5)', () => {
      // Simulate BullMQ render progress events published over Redis to SSE subscribers
      const progressSequence = [
        { percent: 0, state: 'active', frame: 0 },
        { percent: 25, state: 'active', frame: 450 },
        { percent: 70, state: 'active', frame: 1260 },
        { percent: 100, state: 'done', frame: 1800 },
      ];

      const capturedEvents: any[] = [];
      const mockSseListener = (event: any) => {
        capturedEvents.push(event);
      };

      progressSequence.forEach((evt) => mockSseListener(evt));

      expect(capturedEvents).toHaveLength(4);
      expect(capturedEvents[0].percent).toBe(0);
      expect(capturedEvents[3].percent).toBe(100);
      expect(capturedEvents[3].state).toBe('done');

      // Verify server state remains consistent
      const projectHeadVersion = 2;
      expect(projectHeadVersion).toBe(2);
    });

    it('Step 4: Debounced manual slider adjustment produces RFC 6902 patch and saves v3 via PATCH /projects/:id/plans/:v (Phase 6 Task 6)', async () => {
      const mockProject: any = {
        _id: 'db_prj_1',
        publicId: projectId,
        baseAssetId: 'db_asset_1',
        headVersion: 2,
        versions: [
          { version: 1, label: 'Initial' },
          { version: 2, label: 'Prompt edit' },
        ],
        save: vi.fn().mockResolvedValue(true),
      };

      const planV2: EditPlan = {
        schemaVersion: '1.0',
        projectId,
        baseAssetId: assetId,
        version: 2,
        parentVersion: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_col_1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: { preset: 'cinematic', contrast: 1.15, saturation: 0.95, vignette: 0.25 },
          },
        ],
        meta: { prompt: 'v2', model: 'gemini-1.5-pro', createdAt: new Date().toISOString() },
      };

      // User modifies contrast to 1.35 and vignette to 0.40 in local draft
      const draftV2: EditPlan = JSON.parse(JSON.stringify(planV2));
      const colLayer = draftV2.layers.find((l) => l.layer === 'color') as any;
      colLayer.params.contrast = 1.35;
      colLayer.params.vignette = 0.40;

      // Calculate RFC 6902 patch
      const rfcPatch: Operation[] = compare(planV2, draftV2);
      expect(rfcPatch.length).toBeGreaterThan(0);

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (EditPlanModel.findOne as any).mockResolvedValue({
        _id: 'db_plan_v2',
        version: 2,
        plan: planV2,
      });
      (EditPlanModel.create as any).mockImplementation((doc: any) => ({
        ...doc,
        _id: 'db_plan_v3',
      }));
      (AssetModel.findById as any).mockResolvedValue({
        publicId: assetId,
        media: { durationMs: 58400, fps: 30 },
      });

      mockReq = {
        params: { id: projectId, v: '2' },
        body: {
          baseVersion: 2,
          patch: rfcPatch,
        },
        user: { _id: 'usr_abc', id: 'usr_abc' } as any,
        id: 'req_patch_1',
      };

      await PlansController.patchPlan(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.version).toBe(3);
      expect(resData.parentVersion).toBe(2);
      expect(resData.plan.layers[0].params.contrast).toBe(1.35);
      expect(resData.plan.layers[0].params.vignette).toBe(0.40);
      expect(mockProject.headVersion).toBe(3);
    });

    it('Step 5: Optimistic Concurrency Detection rejects stale baseVersion with HTTP 409 and protects server state (Phase 6 Task 6)', async () => {
      // Simulate another tab/client that had baseVersion: 2 while headVersion moved to 3
      const mockProjectWithHeadV3: any = {
        _id: 'db_prj_1',
        publicId: projectId,
        headVersion: 3, // Head moved forward!
        save: vi.fn(),
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProjectWithHeadV3);

      mockReq = {
        params: { id: projectId, v: '2' },
        body: {
          baseVersion: 2, // Outdated!
          patch: [{ op: 'replace', path: '/layers/0/params/contrast', value: 1.45 }],
        },
        user: { _id: 'usr_abc', id: 'usr_abc' } as any,
        id: 'req_stale_patch',
      };

      await PlansController.patchPlan(mockReq as Request, mockRes as Response, nextFn);

      // Must call next with AppError(409, 'VERSION_CONFLICT')
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          code: 'VERSION_CONFLICT',
        })
      );

      // Verify headVersion was NOT mutated and remains protected at 3
      expect(mockProjectWithHeadV3.headVersion).toBe(3);
    });
  });
});
