import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlansController } from '../controllers/plansController.js';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { AssetModel } from '../models/Asset.js';
import { Request, Response } from 'express';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    create: vi.fn().mockResolvedValue({ _id: 'tv_123' }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'tv_123' }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findById: vi.fn(),
  },
}));

describe('PlansController - Version History & Plan Reversion Suite', () => {
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

  describe('GET /api/projects/:id/plans (listPlanVersions)', () => {
    it('returns an ordered list of plan versions with layer summaries and isCurrent flags', async () => {
      const mockProject: any = {
        _id: '672b1234567890abcdef1111',
        publicId: 'prj_test_history',
        headVersion: 3,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const mockPlanDocs = [
        {
          version: 3,
          parentVersion: 2,
          prompt: 'Add cinematic color grade and upbeat music',
          model: 'gemini-3.5-flash-lite',
          createdAt: new Date('2026-11-20T10:30:00Z'),
          plan: {
            layers: [
              { id: 'lyr_c1', layer: 'color', enabled: true },
              { id: 'lyr_m1', layer: 'music', enabled: true },
            ],
          },
        },
        {
          version: 2,
          parentVersion: 1,
          prompt: 'Remove silent pauses longer than 0.6s',
          model: 'gemini-3.5-flash-lite',
          createdAt: new Date('2026-11-20T10:15:00Z'),
          plan: {
            layers: [
              { id: 'lyr_cut1', layer: 'cut', enabled: true },
            ],
          },
        },
        {
          version: 1,
          parentVersion: null,
          prompt: 'Initial baseline sequence',
          model: 'system-bootstrap',
          createdAt: new Date('2026-11-20T10:00:00Z'),
          plan: {
            layers: [],
          },
        },
      ];

      (EditPlanModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(mockPlanDocs),
          }),
        }),
      });

      mockReq = {
        params: { id: 'prj_test_history' },
        user: { _id: '672b1234567890abcdef9999' } as any,
        id: 'req_hist_1',
      };

      await PlansController.listPlanVersions(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            headVersion: 3,
            versions: expect.arrayContaining([
              expect.objectContaining({
                version: 3,
                isCurrent: true,
                layersCount: 2,
                model: 'gemini-3.5-flash-lite',
              }),
              expect.objectContaining({
                version: 2,
                isCurrent: false,
                layersCount: 1,
              }),
              expect.objectContaining({
                version: 1,
                isCurrent: false,
                layersCount: 0,
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('POST /api/projects/:id/plans/:v/revert (revertPlan)', () => {
    it('creates an immutable forward plan version when restoring an earlier snapshot', async () => {
      const mockProject: any = {
        _id: '672b1234567890abcdef1111',
        publicId: 'prj_test_revert',
        headVersion: 4,
        versions: [
          { version: 1, label: 'Initial' },
          { version: 2, label: 'Cut silences' },
          { version: 3, label: 'Subtitles' },
          { version: 4, label: 'Wrong color grade' },
        ],
        save: vi.fn().mockResolvedValue(true),
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const targetPlanDoc = {
        _id: 'ep_v2_doc',
        version: 2,
        plan: {
          schemaVersion: '1.0',
          projectId: 'prj_test_revert',
          baseAssetId: 'ast_base_1',
          version: 2,
          parentVersion: 1,
          global: { aspect: '16:9', fps: 30, resolution: '1080p' },
          layers: [
            {
              id: 'lyr_cut_v2',
              layer: 'cut',
              enabled: true,
              timebase: 'global',
              range: { start: 5, end: 7 },
              params: { action: 'delete' },
            },
          ],
        },
      };

      (EditPlanModel.findOne as any).mockResolvedValue(targetPlanDoc);

      const createdPlanDoc = {
        _id: 'ep_v5_doc',
        version: 5,
        parentVersion: 4,
        prompt: 'Reverted to version 2',
        plan: {
          ...targetPlanDoc.plan,
          version: 5,
          parentVersion: 4,
        },
      };

      (EditPlanModel.create as any).mockResolvedValue(createdPlanDoc);
      (AssetModel.findById as any).mockResolvedValue({
        media: { durationMs: 60000 },
      });

      mockReq = {
        params: { id: 'prj_test_revert', v: '2' },
        user: { _id: '672b1234567890abcdef9999' } as any,
        id: 'req_revert_1',
      };

      await PlansController.revertPlan(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(mockProject.headVersion).toBe(5);
      expect(mockProject.save).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            version: 5,
            parentVersion: 4,
            restoredFromVersion: 2,
            plan: expect.objectContaining({
              version: 5,
              parentVersion: 4,
            }),
          }),
        })
      );
    });
  });
});
