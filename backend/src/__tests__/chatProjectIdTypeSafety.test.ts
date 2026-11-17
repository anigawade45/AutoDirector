import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { ChatMessageModel } from '../models/ChatMessage.js';
import { ProjectsController } from '../controllers/projectsController.js';
import { PromptsController } from '../controllers/promptsController.js';
import { PurgeService } from '../services/maintenance/purgeService.js';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { AssetModel } from '../models/Asset.js';
import { S3Service } from '../services/storage/s3Service.js';
import { QuotaService } from '../services/auth/quotaService.js';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    findOne: vi.fn().mockReturnValue({
      sort: vi.fn().mockResolvedValue(null),
    }),
    find: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    find: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    fileExists: vi.fn().mockResolvedValue(false),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/video.mp4'),
    deleteObjectsByPrefix: vi.fn().mockResolvedValue(2),
  },
}));

vi.mock('../services/auth/quotaService.js', () => ({
  QuotaService: {
    checkPromptQuota: vi.fn().mockResolvedValue(undefined),
    incrementPromptQuota: vi.fn().mockResolvedValue(undefined),
    decrementStorageUsed: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('POT-003: Chat Message & Project ID Type Safety & Schema Resilience', () => {
  const objectId = new mongoose.Types.ObjectId('672b1234567890abcdef1234');
  const userObjectId = new mongoose.Types.ObjectId('672b00000000000000000001');
  const publicId = 'prj_summer_vlog_2026';
  const customStringId = 'db_prj_custom_1';

  let mockRes: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let nextFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    nextFn = vi.fn();
  });

  describe('1. ChatMessage Schema Type Flexibility (ObjectId & String Project IDs)', () => {
    it('instantiates ChatMessage with standard mongoose.Types.ObjectId without error', () => {
      const msg = new ChatMessageModel({
        projectId: objectId,
        userId: userObjectId,
        role: 'user',
        text: 'Trim first 3 seconds of the clip',
      });

      expect(msg.projectId).toEqual(objectId);
      expect(msg.role).toBe('user');
      expect(msg.text).toBe('Trim first 3 seconds of the clip');
    });

    it('instantiates ChatMessage with non-ObjectId string project identifier without CastError', () => {
      // Prior to POT-003 fix, strings like "db_prj_1" or "prj_123" caused Mongoose CastError
      const msg = new ChatMessageModel({
        projectId: customStringId,
        userId: userObjectId,
        role: 'assistant',
        text: 'Applied jump-cut reduction.',
        planId: 'plan_v1_custom',
        versionResult: 2,
      });

      expect(msg.projectId).toBe(customStringId);
      expect(msg.planId).toBe('plan_v1_custom');
      expect(msg.versionResult).toBe(2);
    });

    it('instantiates ChatMessage with publicId string format (e.g. prj_summer_vlog_2026)', () => {
      const msg = new ChatMessageModel({
        projectId: publicId,
        role: 'system',
        text: 'Project initialized from raw footage.',
      });

      expect(msg.projectId).toBe(publicId);
      expect(msg.role).toBe('system');
    });
  });

  describe('2. ProjectsController.getProject Chat History Query Resilience', () => {
    it('loads chat messages when project._id is a non-ObjectId string without throwing CastError', async () => {
      const mockProject = {
        _id: 'db_prj_1', // Non-ObjectId string as found in phase6ExitCriteria.test.ts
        publicId,
        title: 'Goa Highlights',
        headVersion: 1,
        populate: vi.fn().mockReturnThis(),
      };

      (ProjectModel.findOne as any).mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockProject),
      });

      const findSpy = vi.spyOn(ChatMessageModel, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue([
          {
            _id: new mongoose.Types.ObjectId(),
            projectId: 'db_prj_1',
            role: 'user',
            text: 'Apply cinematic grade',
            createdAt: new Date('2026-11-16T12:00:00Z'),
          },
        ]),
      } as any);

      const req = {
        params: { id: publicId },
        user: { _id: userObjectId, id: userObjectId.toString() },
        id: 'req_get_prj',
      } as unknown as Request;

      await ProjectsController.getProject(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);

      // Asserts ChatMessageModel.find was called using string project identifier without throwing CastError
      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'db_prj_1',
        })
      );

      const resData = mockRes.json.mock.calls[0][0].data;
      expect(resData.chatMessages).toHaveLength(1);
      expect(resData.chatMessages[0].text).toBe('Apply cinematic grade');

      findSpy.mockRestore();
    });

    it('loads chat messages when project._id is a standard ObjectId', async () => {
      const mockProject = {
        _id: objectId,
        publicId,
        title: 'Standard ObjectId Project',
        headVersion: 1,
        populate: vi.fn().mockReturnThis(),
      };

      (ProjectModel.findOne as any).mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockProject),
      });

      const findSpy = vi.spyOn(ChatMessageModel, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue([]),
      } as any);

      const req = {
        params: { id: publicId },
        user: { _id: userObjectId, id: userObjectId.toString() },
        id: 'req_get_prj_objid',
      } as unknown as Request;

      await ProjectsController.getProject(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: objectId,
        })
      );

      findSpy.mockRestore();
    });
  });

  describe('3. PromptsController Chat Message Ingestion & Retrieval', () => {
    it('retrieves chat history through getChatHistory querying both _id and publicId', async () => {
      const mockProject = {
        _id: 'db_prj_test_99',
        publicId: 'prj_test_99',
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const findSpy = vi.spyOn(ChatMessageModel, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue([
          {
            _id: new mongoose.Types.ObjectId(),
            projectId: 'prj_test_99',
            role: 'user',
            text: 'Add intro card',
            createdAt: new Date('2026-11-16T10:00:00Z'),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            projectId: 'db_prj_test_99',
            role: 'assistant',
            text: 'Added intro card at 0s.',
            createdAt: new Date('2026-11-16T10:00:02Z'),
          },
        ]),
      } as any);

      const req = {
        params: { id: 'prj_test_99' },
        user: { _id: userObjectId, id: userObjectId.toString() },
        id: 'req_chat_hist',
      } as unknown as Request;

      await PromptsController.getChatHistory(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);

      const resData = mockRes.json.mock.calls[0][0].data;
      expect(resData.messages).toHaveLength(2);
      expect(resData.messages[0].text).toBe('Add intro card');
      expect(resData.messages[1].text).toBe('Added intro card at 0s.');

      findSpy.mockRestore();
    });

    it('creates chat message through postChatMessage with consistent project reference', async () => {
      const mockProject = {
        _id: objectId,
        publicId,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const createSpy = vi.spyOn(ChatMessageModel, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        projectId: objectId,
        userId: userObjectId,
        role: 'user',
        text: 'Fix audio leveling',
        createdAt: new Date(),
      } as any);

      const req = {
        params: { id: publicId },
        body: { text: 'Fix audio leveling', role: 'user' },
        user: { _id: userObjectId, id: userObjectId.toString() },
        id: 'req_post_msg',
      } as unknown as Request;

      await PromptsController.postChatMessage(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: objectId,
          userId: userObjectId,
          role: 'user',
          text: 'Fix audio leveling',
        })
      );

      createSpy.mockRestore();
    });
  });

  describe('4. Purge Cascading Consistency', () => {
    it('purges chat messages matching either project._id or project.publicId', async () => {
      const mockProject = {
        _id: objectId,
        publicId,
        userId: userObjectId,
      };

      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const deleteManySpy = vi.spyOn(ChatMessageModel, 'deleteMany').mockResolvedValue({
        deletedCount: 4,
      } as any);

      await PurgeService.purgeProjectData(userObjectId.toString(), publicId);

      expect(deleteManySpy).toHaveBeenCalledWith({
        projectId: { $in: [objectId, publicId] },
      });

      deleteManySpy.mockRestore();
    });
  });
});
