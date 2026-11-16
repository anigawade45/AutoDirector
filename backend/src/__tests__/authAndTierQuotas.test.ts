import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { PasswordService } from '../services/auth/passwordService.js';
import { TokenService } from '../services/auth/tokenService.js';
import { AuthController } from '../controllers/authController.js';
import { ProjectsController } from '../controllers/projectsController.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProjectOwner } from '../middleware/tenant.js';
import { RendersController } from '../controllers/rendersController.js';
import { PromptsController } from '../controllers/promptsController.js';
import { UploadsController } from '../controllers/uploadsController.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { CatalogModel } from '../models/Catalog.js';
import { ChatMessageModel } from '../models/ChatMessage.js';
import { previewQueue, renderQueue } from '../services/queue/queueService.js';
import mongoose from 'mongoose';

// Mocks
vi.mock('../models/User.js', () => ({
  UserModel: {
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    create: vi.fn(),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    findOne: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    findOne: vi.fn(),
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
    updateOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/Catalog.js', () => ({
  CatalogModel: {
    find: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    findById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../models/ChatMessage.js', () => ({
  ChatMessageModel: {
    create: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  previewQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_prev_1' }),
  },
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_rnd_1' }),
  },
  analysisQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_ana_1' }),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    createMultipartUpload: vi.fn().mockResolvedValue({ uploadId: 's3_up_1', key: 'raw/test.mp4' }),
    getPresignedPartUrls: vi.fn().mockResolvedValue(['http://mock-s3/part1']),
  },
}));

describe('Authentication & Authorization Suite', () => {
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

  describe('1. Password Hashing & Verification (PasswordService)', () => {
    it('generates a unique salt and valid cryptographic hash', () => {
      const password = 'SuperSecretPassword2026!';
      const result = PasswordService.hashPassword(password);

      expect(result.salt).toBeDefined();
      expect(result.salt.length).toBe(32); // 16 bytes in hex
      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(128); // 64 bytes in hex
    });

    it('verifies matching password and rejects incorrect password', () => {
      const password = 'MyDirectorPassword#1';
      const { salt, hash } = PasswordService.hashPassword(password);

      expect(PasswordService.verifyPassword(password, salt, hash)).toBe(true);
      expect(PasswordService.verifyPassword('WrongPassword', salt, hash)).toBe(false);
    });
  });

  describe('2. RFC 7519 JWT Generation & Verification (TokenService)', () => {
    it('signs and decodes token with expected claims', () => {
      const payload = {
        id: '507f1f77bcf86cd799439011',
        email: 'editor@studio.ai',
        tier: 'pro',
        name: 'Alex Editor',
      };

      const token = TokenService.generateToken(payload, 3600);
      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);

      const decoded = TokenService.verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(payload.id);
      expect(decoded?.email).toBe(payload.email);
      expect(decoded?.tier).toBe('pro');
      expect(decoded?.name).toBe('Alex Editor');
    });

    it('rejects tampered token signature', () => {
      const token = TokenService.generateToken({
        id: '507f1f77bcf86cd799439011',
        email: 'user@studio.ai',
        tier: 'free',
      });

      const parts = token.split('.');
      // Tamper with the payload claim (e.g. elevate to enterprise)
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          sub: '507f1f77bcf86cd799439011',
          email: 'user@studio.ai',
          tier: 'enterprise',
        })
      ).toString('base64url');

      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      const decoded = TokenService.verifyToken(tamperedToken);
      expect(decoded).toBeNull();
    });

    it('rejects expired tokens', () => {
      // Token expired 10 seconds ago
      const token = TokenService.generateToken(
        { id: '507f1f77bcf86cd799439011', email: 'old@studio.ai', tier: 'free' },
        -10
      );

      const decoded = TokenService.verifyToken(token);
      expect(decoded).toBeNull();
    });
  });

  describe('2b. AuthMiddleware Security Hardening', () => {
    it('rejects raw MongoDB ObjectId as Bearer token with HTTP 401', async () => {
      const rawObjectId = '507f1f77bcf86cd799439011';
      const req = {
        headers: { authorization: `Bearer ${rawObjectId}` },
        query: {},
        path: '/api/projects',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHENTICATED',
        })
      );
    });

    it('rejects raw email as Bearer token with HTTP 401', async () => {
      const req = {
        headers: { authorization: 'Bearer director@studio.ai' },
        query: {},
        path: '/api/projects',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHENTICATED',
        })
      );
    });

    it('rejects ?token= query parameter on standard REST endpoints with 401 QUERY_TOKEN_FORBIDDEN', async () => {
      const validToken = TokenService.generateToken({
        id: '507f1f77bcf86cd799439011',
        email: 'user@studio.ai',
        tier: 'free',
      });

      const req = {
        headers: {},
        query: { token: validToken },
        path: '/api/projects',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'QUERY_TOKEN_FORBIDDEN',
        })
      );
    });

    it('accepts ?token= query parameter on SSE /events endpoints with valid JWT', async () => {
      const mockUser = {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        email: 'sse_user@studio.ai',
        tier: 'pro',
      };
      (UserModel.findById as any).mockResolvedValue(mockUser);

      const validToken = TokenService.generateToken({
        id: '507f1f77bcf86cd799439011',
        email: 'sse_user@studio.ai',
        tier: 'pro',
      });

      const req = {
        headers: { accept: 'text/event-stream' },
        query: { token: validToken },
        path: '/api/jobs/job_123/events',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user?.email).toBe('sse_user@studio.ai');
    });

    it('accepts valid cryptographic JWT token in Authorization: Bearer header', async () => {
      const mockUser = {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        email: 'valid_bearer@studio.ai',
        tier: 'enterprise',
      };
      (UserModel.findById as any).mockResolvedValue(mockUser);

      const validToken = TokenService.generateToken({
        id: '507f1f77bcf86cd799439011',
        email: 'valid_bearer@studio.ai',
        tier: 'enterprise',
      });

      const req = {
        headers: { authorization: `Bearer ${validToken}` },
        query: {},
        path: '/api/projects',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalled();
      expect(req.user?.tier).toBe('enterprise');
    });
  });

  describe('2c. Tenant Isolation Middleware (requireProjectOwner)', () => {
    it('rejects request when project ID parameter is missing with HTTP 400', async () => {
      const req = {
        params: {},
        body: {},
        user: { _id: new mongoose.Types.ObjectId() },
      } as unknown as Request;

      await requireProjectOwner(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'BAD_REQUEST',
        })
      );
    });

    it('rejects request when user is unauthenticated with HTTP 401', async () => {
      const req = {
        params: { id: 'prj_test_123' },
        body: {},
      } as unknown as Request;

      await requireProjectOwner(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHENTICATED',
        })
      );
    });

    it('returns 404 PROJECT_NOT_FOUND when project belongs to another tenant', async () => {
      (ProjectModel.findOne as any).mockResolvedValue(null);

      const req = {
        params: { id: 'prj_other_user_project' },
        body: {},
        user: { _id: new mongoose.Types.ObjectId() },
      } as unknown as Request;

      await requireProjectOwner(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: 'PROJECT_NOT_FOUND',
        })
      );
      expect(ProjectModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          publicId: 'prj_other_user_project',
          userId: req.user?._id,
          deletedAt: null,
        })
      );
    });

    it('successfully authorizes and attaches req.project when owned by tenant', async () => {
      const mockOwnerId = new mongoose.Types.ObjectId();
      const mockProject = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'prj_my_valid_project',
        userId: mockOwnerId,
        status: 'ready',
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const req = {
        params: { id: 'prj_my_valid_project' },
        body: {},
        user: { _id: mockOwnerId },
      } as unknown as Request;

      await requireProjectOwner(req, mockRes as unknown as Response, nextFn);
      expect(nextFn).toHaveBeenCalled();
      expect(req.project).toBe(mockProject);
    });
  });

  describe('3. AuthController - Registration & Tier Quotas', () => {
    it('registers a new Free tier user with default Free quotas', async () => {
      (UserModel.findOne as any).mockResolvedValue(null);
      (UserModel.create as any).mockImplementation((data: any) => ({
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        ...data,
      }));

      mockReq = {
        body: {
          email: 'creator@studio.ai',
          name: 'Jane Creator',
          password: 'Password123!',
          tier: 'free',
        },
        id: 'req_reg_1',
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(201);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.user.email).toBe('creator@studio.ai');
      expect(resData.user.tier).toBe('free');
      expect(resData.user.quota.storageBytes).toBe(5 * 1024 * 1024 * 1024); // 5 GB
      expect(resData.user.quota.renderMinutes).toBe(60);
      expect(resData.user.quota.promptsPerDay).toBe(100);
      expect(resData.jwt).toBeDefined();
    });

    it('registers a new Pro tier user with Pro quotas', async () => {
      (UserModel.findOne as any).mockResolvedValue(null);
      (UserModel.create as any).mockImplementation((data: any) => ({
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
        ...data,
      }));

      mockReq = {
        body: {
          email: 'pro@studio.ai',
          name: 'Pro Filmmaker',
          password: 'Password123!',
          tier: 'pro',
        },
        id: 'req_reg_2',
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(201);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.user.tier).toBe('pro');
      expect(resData.user.quota.storageBytes).toBe(20 * 1024 * 1024 * 1024); // 20 GB
      expect(resData.user.quota.renderMinutes).toBe(300);
      expect(resData.user.quota.promptsPerDay).toBe(500);
    });

    it('registers an Enterprise tier user with Enterprise quotas', async () => {
      (UserModel.findOne as any).mockResolvedValue(null);
      (UserModel.create as any).mockImplementation((data: any) => ({
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'),
        ...data,
      }));

      mockReq = {
        body: {
          email: 'studio@enterprise.ai',
          name: 'Warner Studio',
          password: 'Password123!',
          tier: 'enterprise',
        },
        id: 'req_reg_3',
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(201);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.user.tier).toBe('enterprise');
      expect(resData.user.quota.storageBytes).toBe(100 * 1024 * 1024 * 1024); // 100 GB
      expect(resData.user.quota.renderMinutes).toBe(1200);
      expect(resData.user.quota.promptsPerDay).toBe(1000);
    });

    it('rejects registration with invalid email format', async () => {
      mockReq = {
        body: {
          email: 'invalid-email-string',
          name: 'Invalid User',
          password: 'Password123!',
        },
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_EMAIL', statusCode: 400 })
      );
    });

    it('rejects registration with password shorter than 6 characters', async () => {
      mockReq = {
        body: {
          email: 'short@studio.ai',
          name: 'Short Password',
          password: '12345',
        },
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'WEAK_PASSWORD', statusCode: 400 })
      );
    });

    it('rejects duplicate registration with 409 USER_EXISTS', async () => {
      (UserModel.findOne as any).mockResolvedValue({ email: 'taken@studio.ai' });

      mockReq = {
        body: {
          email: 'taken@studio.ai',
          name: 'Already Exists',
          password: 'Password123!',
        },
      };

      await AuthController.register(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'USER_EXISTS', statusCode: 409 })
      );
    });
  });

  describe('4. AuthController - Login & Session Persistence', () => {
    it('logs in successfully and returns JWT token and sanitized profile', async () => {
      const password = 'CorrectPassword123!';
      const { salt, hash } = PasswordService.hashPassword(password);
      const mockUser = {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        email: 'director@studio.ai',
        name: 'Director Bob',
        tier: 'pro',
        salt,
        passwordHash: hash,
        quota: { promptsPerDay: 500, renderMinutes: 300, storageBytes: 20000000000 },
        usage: { promptsToday: 5, renderMinutesUsed: 10, storageBytesUsed: 500000000 },
      };

      (UserModel.findOne as any).mockReturnValue({
        select: vi.fn().mockResolvedValue(mockUser),
      });

      mockReq = {
        body: {
          email: 'director@studio.ai',
          password,
        },
        id: 'req_log_1',
      };

      await AuthController.login(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.jwt).toBeDefined();
      expect(resData.user.email).toBe('director@studio.ai');
      expect(resData.user.tier).toBe('pro');
      // Password hash and salt must NEVER be exposed in response
      expect((resData.user as any).passwordHash).toBeUndefined();
      expect((resData.user as any).salt).toBeUndefined();
    });

    it('rejects login with wrong password (401 INVALID_CREDENTIALS)', async () => {
      const { salt, hash } = PasswordService.hashPassword('RealPassword');
      const mockUser = {
        email: 'director@studio.ai',
        salt,
        passwordHash: hash,
      };

      (UserModel.findOne as any).mockReturnValue({
        select: vi.fn().mockResolvedValue(mockUser),
      });

      mockReq = {
        body: {
          email: 'director@studio.ai',
          password: 'IncorrectPassword',
        },
      };

      await AuthController.login(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_CREDENTIALS', statusCode: 401 })
      );
    });

    it('returns 404 USER_NOT_FOUND when email does not exist', async () => {
      (UserModel.findOne as any).mockReturnValue({
        select: vi.fn().mockResolvedValue(null),
      });

      mockReq = {
        body: {
          email: 'ghost@studio.ai',
          password: 'SomePassword',
        },
      };

      await AuthController.login(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'USER_NOT_FOUND', statusCode: 404 })
      );
    });

    it('GET /api/auth/me returns current session profile', async () => {
      const mockUser = {
        _id: '507f1f77bcf86cd799439011',
        email: 'director@studio.ai',
        name: 'Director Bob',
        tier: 'pro',
        quota: { promptsPerDay: 500 },
        usage: { promptsToday: 5 },
      };

      (UserModel.findById as any).mockResolvedValue(mockUser);

      mockReq = {
        user: { id: '507f1f77bcf86cd799439011' } as any,
        id: 'req_me_1',
      };

      await AuthController.getMe(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      const resData = jsonMock.mock.calls[0][0].data;
      expect(resData.user.email).toBe('director@studio.ai');
      expect(resData.user.tier).toBe('pro');
    });
  });

  describe('5. Tier Quota Enforcement & Feature Gating', () => {
    describe('4K Export Profile Gating', () => {
      it('blocks 4K export for Free tier with 403 UPGRADE_REQUIRED', async () => {
        (ProjectModel.findOne as any).mockResolvedValue({
          _id: 'prj_1',
          publicId: 'prj_1',
          headVersion: 1,
        });

        mockReq = {
          params: { id: 'prj_1' },
          body: { profile: 'final_4k' },
          user: { _id: 'usr_free', id: 'usr_free', tier: 'free' } as any,
        };

        await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

        expect(nextFn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'UPGRADE_REQUIRED', statusCode: 403 })
        );
      });

      it('permits 4K export for Pro and Enterprise tiers', async () => {
        (ProjectModel.findOne as any).mockResolvedValue({
          _id: 'prj_1',
          publicId: 'prj_1',
          headVersion: 1,
        });
        (TimelineVersionModel.findOne as any).mockResolvedValue({
          snapshotHash: 'hash_4k',
        });
        (RenderJobModel.create as any).mockResolvedValue({
          _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
          save: vi.fn(),
        });

        mockReq = {
          params: { id: 'prj_1' },
          body: { profile: 'final_4k' },
          user: { _id: 'usr_pro', id: 'usr_pro', tier: 'pro' } as any,
        };

        await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

        expect(statusMock).toHaveBeenCalledWith(202);
      });
    });

    describe('Render Minutes Quota', () => {
      it('blocks export when monthly render minutes quota is exceeded', async () => {
        (ProjectModel.findOne as any).mockResolvedValue({
          _id: 'prj_1',
          publicId: 'prj_1',
          headVersion: 1,
        });
        (UserModel.findById as any).mockResolvedValue({
          tier: 'free',
          quota: { renderMinutes: 60 },
          usage: { renderMinutesUsed: 60 }, // Limit reached!
        });

        mockReq = {
          params: { id: 'prj_1' },
          body: { profile: 'final_1080p' },
          user: {
            _id: '507f1f77bcf86cd799439011',
            id: '507f1f77bcf86cd799439011',
            tier: 'free',
          } as any,
        };

        await RendersController.enqueueExport(mockReq as Request, mockRes as Response, nextFn);

        expect(nextFn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'QUOTA_EXCEEDED', statusCode: 403 })
        );
      });
    });

    describe('Daily Prompts Quota', () => {
      it('blocks AI prompt when daily prompt limit is exceeded (429 QUOTA_EXCEEDED)', async () => {
        (UserModel.findById as any).mockResolvedValue({
          tier: 'free',
          quota: { promptsPerDay: 100 },
          usage: { promptsToday: 100 }, // Limit reached!
        });

        mockReq = {
          params: { id: 'prj_1' },
          body: { prompt: 'Add dramatic cinematic music' },
          user: {
            _id: '507f1f77bcf86cd799439011',
            id: '507f1f77bcf86cd799439011',
            tier: 'free',
          } as any,
        };

        await PromptsController.submitPrompt(mockReq as Request, mockRes as Response, nextFn);

        expect(nextFn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'QUOTA_EXCEEDED', statusCode: 429 })
        );
      });
    });

    describe('Storage Quota', () => {
      it('blocks video upload when remaining storage quota is insufficient (403 QUOTA_EXCEEDED)', async () => {
        (ProjectModel.findOne as any).mockResolvedValue({
          _id: 'prj_1',
          publicId: 'prj_1',
        });
        (UserModel.findById as any).mockResolvedValue({
          tier: 'free',
          quota: { storageBytes: 5 * 1024 * 1024 * 1024 }, // 5 GB
          usage: { storageBytesUsed: 4.8 * 1024 * 1024 * 1024 }, // 4.8 GB used -> 200MB left
        });

        mockReq = {
          body: {
            projectId: 'prj_1',
            fileName: 'large_raw_footage.mp4',
            contentType: 'video/mp4',
            sizeBytes: 500 * 1024 * 1024, // 500 MB (exceeds 200MB remaining!)
          },
          user: {
            _id: '507f1f77bcf86cd799439011',
            id: '507f1f77bcf86cd799439011',
            tier: 'free',
          } as any,
        };

        await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

        expect(nextFn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'QUOTA_EXCEEDED', statusCode: 403 })
        );
      });
    });
  });

  describe('7. Multi-Tenant Project and Video Data Isolation', () => {
    it('scopes listProjects strictly to the authenticated user ID', async () => {
      const mockFindChain = {
        populate: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { publicId: 'prj_userA_1', title: "User A's Vlog", userId: 'user_A' },
          ]),
      };
      (ProjectModel.find as any).mockReturnValue(mockFindChain);

      mockReq = {
        query: { status: 'active' },
        user: { _id: 'user_A', id: 'user_A' } as any,
        id: 'req_list_1',
      };

      await ProjectsController.listProjects(mockReq as Request, mockRes as Response, nextFn);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(ProjectModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_A',
          deletedAt: null,
          status: { $ne: 'archived' },
        })
      );
      const data = jsonMock.mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0].publicId).toBe('prj_userA_1');
    });

    it("rejects access to another user's project with 404 PROJECT_NOT_FOUND", async () => {
      // Mock findOne returns null because project belongs to User B, not User A
      (ProjectModel.findOne as any).mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      });

      mockReq = {
        params: { id: 'prj_userB_secret' },
        user: { _id: 'user_A', id: 'user_A' } as any,
      };

      await ProjectsController.getProject(mockReq as Request, mockRes as Response, nextFn);

      expect(ProjectModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          publicId: 'prj_userB_secret',
          userId: 'user_A',
          deletedAt: null,
        })
      );
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROJECT_NOT_FOUND', statusCode: 404 })
      );
    });

    it("prevents updating another user's project", async () => {
      (ProjectModel.findOne as any).mockResolvedValue(null);

      mockReq = {
        params: { id: 'prj_userB_secret' },
        body: { title: 'Hacked Title' },
        user: { _id: 'user_A', id: 'user_A' } as any,
      };

      await ProjectsController.updateProject(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROJECT_NOT_FOUND', statusCode: 404 })
      );
    });

    it("prevents deleting another user's project", async () => {
      (ProjectModel.findOne as any).mockResolvedValue(null);

      mockReq = {
        params: { id: 'prj_userB_secret' },
        user: { _id: 'user_A', id: 'user_A' } as any,
      };

      await ProjectsController.deleteProject(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROJECT_NOT_FOUND', statusCode: 404 })
      );
    });
  });

  describe('8. Multi-Tenant Project & User Isolated Chat History Suite', () => {
    it('fetches chat history scoped strictly to the requesting user and project', async () => {
      const mockProject = {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
        publicId: 'prj_userA_vid1',
        userId: 'user_A',
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);

      const mockMessages = [
        {
          _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439091'),
          projectId: mockProject._id,
          userId: 'user_A',
          role: 'user',
          text: 'Trim silences and apply Kodak grade',
          createdAt: new Date('2026-11-15T02:00:00Z'),
        },
        {
          _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439092'),
          projectId: mockProject._id,
          userId: 'user_A',
          role: 'assistant',
          text: 'Created EditPlan v2 with 4 active layers',
          versionResult: 2,
          createdAt: new Date('2026-11-15T02:00:05Z'),
        },
      ];

      (ChatMessageModel.find as any).mockReturnValue({
        sort: vi.fn().mockResolvedValue(mockMessages),
      });

      mockReq = {
        params: { id: 'prj_userA_vid1' },
        user: { _id: 'user_A', id: 'user_A' } as any,
        id: 'req_chat_1',
      };

      await PromptsController.getChatHistory(mockReq as Request, mockRes as Response, nextFn);

      expect(ProjectModel.findOne).toHaveBeenCalledWith({
        publicId: 'prj_userA_vid1',
        userId: 'user_A',
        deletedAt: null,
      });

      expect(ChatMessageModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: mockProject._id,
        })
      );

      expect(statusMock).toHaveBeenCalledWith(200);
      const data = jsonMock.mock.calls[0][0].data;
      expect(data.projectId).toBe('prj_userA_vid1');
      expect(data.messages).toHaveLength(2);
      expect(data.messages[0].role).toBe('user');
      expect(data.messages[0].text).toBe('Trim silences and apply Kodak grade');
      expect(data.messages[1].role).toBe('assistant');
      expect(data.messages[1].planVersion).toBe(2);
    });

    it("rejects chat history retrieval for another user's project with 404", async () => {
      // User B tries to fetch User A's project chat
      (ProjectModel.findOne as any).mockResolvedValue(null);

      mockReq = {
        params: { id: 'prj_userA_vid1' },
        user: { _id: 'user_B', id: 'user_B' } as any,
      };

      await PromptsController.getChatHistory(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROJECT_NOT_FOUND', statusCode: 404 })
      );
    });

    it('records user and assistant chat messages with both userId and projectId on submitPrompt', async () => {
      (ChatMessageModel.create as any).mockClear();
      (ChatMessageModel.create as any).mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

      const testUserId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
      mockReq = {
        params: { id: 'prj_userA_vid1' },
        body: { prompt: 'Add dynamic subtitles', baseVersion: 1 },
        user: { _id: testUserId, id: testUserId.toString() } as any,
      };

      const mockProject = {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
        publicId: 'prj_userA_vid1',
        userId: testUserId,
        baseAssetId: new mongoose.Types.ObjectId(),
        headVersion: 1,
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (AssetModel.findById as any).mockResolvedValue({
        _id: mockProject.baseAssetId,
        publicId: 'ast_1',
        media: { durationMs: 45000, width: 1920, height: 1080, fps: 30 },
      });
      (AnalysisResultModel.findOne as any).mockResolvedValue({
        status: 'complete',
        silences: [],
        sceneCuts: [],
      });
      (EditPlanModel.findOne as any).mockResolvedValue({
        plan: { version: 1, layers: [] },
      });
      (EditPlanModel.create as any).mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
      });
      (TimelineModel.updateOne as any).mockResolvedValue({});

      await PromptsController.submitPrompt(mockReq as Request, mockRes as Response, nextFn);

      expect(ChatMessageModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          role: 'user',
          text: 'Add dynamic subtitles',
        })
      );

      expect(ChatMessageModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          role: 'assistant',
          versionResult: 2,
        })
      );
    });

    it('isolates chat history across separate projects of the same user', async () => {
      const proj1Id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439091');
      const proj2Id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439092');

      const proj2Messages = [
        {
          _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439088'),
          projectId: proj2Id,
          userId: 'user_A',
          role: 'user',
          text: 'Cut intro in project 2',
          createdAt: new Date('2026-11-15T02:10:00Z'),
        },
      ];

      (ProjectModel.findOne as any).mockResolvedValue({
        _id: proj2Id,
        publicId: 'prj_userA_vid2',
        userId: 'user_A',
      });

      (ChatMessageModel.find as any).mockReturnValue({
        sort: vi.fn().mockResolvedValue(proj2Messages),
      });

      mockReq = {
        params: { id: 'prj_userA_vid2' },
        user: { _id: 'user_A', id: 'user_A' } as any,
        id: 'req_chat_p2',
      };

      await PromptsController.getChatHistory(mockReq as Request, mockRes as Response, nextFn);

      expect(ChatMessageModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: proj2Id,
        })
      );
      const data = jsonMock.mock.calls[0][0].data;
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].text).toBe('Cut intro in project 2');
    });
  });
});
