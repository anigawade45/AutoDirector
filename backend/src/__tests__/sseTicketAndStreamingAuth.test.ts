import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { TokenService } from '../services/auth/tokenService.js';
import { authMiddleware } from '../middleware/auth.js';
import { JobsController } from '../controllers/jobsController.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { UserModel } from '../models/User.js';

vi.mock('../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findOne: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/download.mp4'),
  },
}));

describe('SSE Ticket & Streaming Authentication Hardening Suite', () => {
  const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const validJwt = TokenService.generateToken({
    id: userId.toString(),
    email: 'creator@studio.ai',
    tier: 'pro',
  });

  const mockUser = {
    _id: userId,
    id: userId.toString(),
    email: 'creator@studio.ai',
    tier: 'pro',
  };

  let mockRes: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let nextFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    TokenService.resetLocalTicketStore();
    (UserModel.findById as any).mockResolvedValue(mockUser);
    (UserModel.findOne as any).mockResolvedValue(mockUser);

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      write: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    nextFn = vi.fn();
  });

  describe('1. TokenService Ephemeral SSE Tickets', () => {
    it('creates and atomically consumes an ephemeral ticket', async () => {
      const ticket = await TokenService.createSseTicket(
        { userId: userId.toString(), jobId: 'job_test_123' },
        30
      );

      expect(ticket).toMatch(/^ticket_[a-f0-9]{48}$/);

      // First consumption succeeds
      const consumed = await TokenService.consumeSseTicket(ticket);
      expect(consumed).not.toBeNull();
      expect(consumed?.userId).toBe(userId.toString());
      expect(consumed?.jobId).toBe('job_test_123');

      // Second consumption fails (single-use burned on connect)
      const replayed = await TokenService.consumeSseTicket(ticket);
      expect(replayed).toBeNull();
    });

    it('rejects expired tickets', async () => {
      const ticket = await TokenService.createSseTicket(
        { userId: userId.toString(), jobId: 'job_test_exp' },
        -1 // Expired
      );

      const consumed = await TokenService.consumeSseTicket(ticket);
      expect(consumed).toBeNull();
    });
  });

  describe('2. JobsController.getJobEventsTicket Issuance', () => {
    it('issues a 30-second single-use ticket for the authorized job owner', async () => {
      (RenderJobModel.findOne as any).mockResolvedValue({
        _id: 'target_job_999',
        userId,
        state: 'processing',
      });

      const req = {
        params: { id: 'job_target_job_999' },
        user: { _id: userId, id: userId.toString(), email: 'creator@studio.ai', tier: 'pro' },
        id: 'req_ticket_test',
      } as unknown as Request;

      await JobsController.getJobEventsTicket(req, mockRes as unknown as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            ticket: expect.stringMatching(/^ticket_[a-f0-9]{48}$/),
            expiresInSeconds: 30,
          }),
        })
      );
    });

    it('rejects ticket requests for jobs belonging to another user with HTTP 404', async () => {
      (RenderJobModel.findOne as any).mockResolvedValue(null);

      const req = {
        params: { id: 'job_someone_elses_job' },
        user: { _id: userId, id: userId.toString(), email: 'creator@studio.ai', tier: 'pro' },
        id: 'req_ticket_test',
      } as unknown as Request;

      await JobsController.getJobEventsTicket(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: 'JOB_NOT_FOUND',
        })
      );
    });
  });

  describe('3. AuthMiddleware SSE Ticket & Streaming Authentication', () => {
    it('authenticates SSE connection using standard Authorization: Bearer header (no query param)', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${validJwt}`,
          accept: 'text/event-stream',
        },
        query: {},
        path: '/job_123/events',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user?.email).toBe('creator@studio.ai');
    });

    it('authenticates SSE connection using single-use ?ticket= query parameter and immediately burns it', async () => {
      const ticket = await TokenService.createSseTicket(
        { userId: userId.toString(), jobId: '123' },
        30
      );

      const req1 = {
        headers: { accept: 'text/event-stream' },
        query: { ticket },
        path: '/job_123/events',
      } as unknown as Request;

      await authMiddleware(req1, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(req1.user).toBeDefined();
      expect(req1.user?.email).toBe('creator@studio.ai');

      // Replay attempt with same burned ticket is rejected immediately with 401
      const nextFnReplay = vi.fn();
      const req2 = {
        headers: { accept: 'text/event-stream' },
        query: { ticket },
        path: '/job_123/events',
      } as unknown as Request;

      await authMiddleware(req2, mockRes as unknown as Response, nextFnReplay);

      expect(nextFnReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'INVALID_OR_EXPIRED_TICKET',
        })
      );
    });

    it('rejects ?ticket= when scoped to a different job with 403 TICKET_SCOPE_MISMATCH', async () => {
      const ticket = await TokenService.createSseTicket(
        { userId: userId.toString(), jobId: 'different_job_888' },
        30
      );

      const req = {
        headers: { accept: 'text/event-stream' },
        query: { ticket },
        path: '/job_123/events',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'TICKET_SCOPE_MISMATCH',
        })
      );
    });

    it('rejects ?ticket= on standard non-SSE REST routes with 401 QUERY_TICKET_FORBIDDEN', async () => {
      const ticket = await TokenService.createSseTicket(
        { userId: userId.toString(), jobId: '123' },
        30
      );

      const req = {
        headers: {},
        query: { ticket },
        path: '/api/jobs/job_123',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'QUERY_TICKET_FORBIDDEN',
        })
      );
    });

    it('accepts ?token= on /events with deprecation warning for backward compatibility', async () => {
      const req = {
        headers: { accept: 'text/event-stream' },
        query: { token: validJwt },
        path: '/job_123/events',
      } as unknown as Request;

      await authMiddleware(req, mockRes as unknown as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user?.email).toBe('creator@studio.ai');
    });
  });
});
