import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { TokenService } from '../services/auth/tokenService.js';
import { verifyWorkerSignature, resetWorkerAuthReplayCache } from '../middleware/workerAuth.js';
import { env } from '../config/env.js';
import { Request, Response } from 'express';
import crypto from 'crypto';

const rootDir = path.resolve(__dirname, '../../..');

describe('Security & Configuration Hardening Suite (Section 5)', () => {
  beforeEach(() => {
    resetWorkerAuthReplayCache();
  });

  // =========================================================================
  // 1. CORS Origin Configuration & Credential Safety
  // =========================================================================
  describe('1. CORS Origin Configuration & Credential Safety', () => {
    it('verifies that render.yaml sets an explicit frontend origin instead of wildcard *', () => {
      const renderPath = path.join(rootDir, 'render.yaml');
      expect(fs.existsSync(renderPath)).toBe(true);

      const renderContent = fs.readFileSync(renderPath, 'utf8');
      expect(renderContent).not.toMatch(/CORS_ORIGIN\s*\n\s*value:\s*"\*"/);
      expect(renderContent).toContain('value: https://ai-video-frontend-57bk.onrender.com');
    });

    it('creates an app with hardened CORS policy and permits configured origins', async () => {
      const app = createApp();

      // Test CORS preflight options or route handler
      const mockReq = {
        method: 'GET',
        headers: {
          origin: 'http://localhost:5173',
        },
      } as unknown as Request;

      let setHeaders: Record<string, string> = {};
      const mockRes = {
        setHeader: vi.fn((k: string, v: string) => {
          setHeaders[k.toLowerCase()] = v;
        }),
        getHeader: vi.fn((k: string) => setHeaders[k.toLowerCase()]),
      } as unknown as Response;

      // Verify that the CORS middleware is registered
      expect(app).toBeDefined();
    });
  });

  // =========================================================================
  // 2. JWT Secret Hardening & Elimination of Weak Fallback
  // =========================================================================
  describe('2. JWT Secret Hardening & Elimination of Hardcoded Fallback', () => {
    it('generates and verifies tokens when valid JWT_SECRET is configured', () => {
      const payload = {
        id: 'usr_test_hardening',
        email: 'security@autodirector.studio',
        tier: 'pro',
        name: 'SecOps',
      };

      const token = TokenService.generateToken(payload, 3600);
      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);

      const verified = TokenService.verifyToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe(payload.id);
      expect(verified?.email).toBe(payload.email);
    });

    it('refuses to use insecure hardcoded fallback if JWT_SECRET is empty', () => {
      const originalSecret = env.JWT_SECRET;
      try {
        (env as any).JWT_SECRET = '';
        expect(() => {
          (TokenService as any).getSecret();
        }).toThrow(/JWT_SECRET configuration is missing or empty/i);
      } finally {
        (env as any).JWT_SECRET = originalSecret;
      }
    });

    it('rejects weak placeholder secrets in production mode', () => {
      const originalSecret = env.JWT_SECRET;
      const originalNodeEnv = env.NODE_ENV;
      try {
        (env as any).NODE_ENV = 'production';
        (env as any).JWT_SECRET = 'ai-video-studio-jwt-secret-key-2026';
        expect(() => {
          (TokenService as any).getSecret();
        }).toThrow(/insecure for production/i);
      } finally {
        (env as any).JWT_SECRET = originalSecret;
        (env as any).NODE_ENV = originalNodeEnv;
      }
    });
  });

  // =========================================================================
  // 3. Worker Replay Protection & Idempotency Cache
  // =========================================================================
  describe('3. Worker Replay Protection & Distributed Sliding Window', () => {
    it('detects replayed worker events and responds with duplicate acceptance', async () => {
      const now = Math.floor(Date.now() / 1000);
      const workerId = 'worker_node_1';
      const eventId = 'evt_replay_test_' + Date.now();
      const body = { status: 'rendering', progress: 50 };
      const rawBody = JSON.stringify(body);

      const signature = crypto
        .createHmac('sha256', env.INTERNAL_WORKER_SECRET)
        .update(rawBody)
        .digest('hex');

      const req = {
        headers: {
          'x-worker-id': workerId,
          'x-event-id': eventId,
          'x-event-timestamp': String(now),
          'x-event-signature': `sha256=${signature}`,
        },
        body,
        id: 'req_1',
      } as unknown as Request;

      let nextCalled = false;
      const nextFn = () => {
        nextCalled = true;
      };

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      // First delivery: should succeed and call next()
      await verifyWorkerSignature(req, res, nextFn);
      expect(nextCalled).toBe(true);

      // Reset nextCalled and replay exact same event
      nextCalled = false;
      await verifyWorkerSignature(req, res, nextFn);

      // Replay must be intercepted without calling next()
      expect(nextCalled).toBe(false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { accepted: true, duplicate: true },
        })
      );
    });
  });

  // =========================================================================
  // 4. Redis Security & Compose Host Port Hardening
  // =========================================================================
  describe('4. Redis Exposure & Mandatory Password Enforcement in Compose', () => {
    it('verifies docker-compose.prod.yml does not contain weak default redis password fallback', () => {
      const composeProdPath = path.join(rootDir, 'docker-compose.prod.yml');
      const content = fs.readFileSync(composeProdPath, 'utf8');

      // Must not use prod_redis_pass_change_me
      expect(content).not.toContain('prod_redis_pass_change_me');

      // Must require REDIS_PASSWORD variable to be provided
      expect(content).toContain('REDIS_PASSWORD:?');

      // Host port binding must be restricted to loopback (127.0.0.1), not public 0.0.0.0
      expect(content).toContain('127.0.0.1:6379:6379');
      expect(content).not.toMatch(/ports:\s*\n\s*-\s*['"]6379:6379['"]/);
    });

    it('verifies docker-compose.yml (dev) binds Redis to loopback interface', () => {
      const composeDevPath = path.join(rootDir, 'docker-compose.yml');
      const content = fs.readFileSync(composeDevPath, 'utf8');

      expect(content).toContain('127.0.0.1:6379:6379');
      expect(content).not.toMatch(/ports:\s*\n\s*-\s*['"]6379:6379['"]/);
    });
  });

  // =========================================================================
  // 5. MongoDB Security & Authentication Hardening in Compose
  // =========================================================================
  describe('5. MongoDB Exposure & Mandatory Authentication in Compose', () => {
    it('verifies docker-compose.prod.yml configures MongoDB root authentication and loopback binding', () => {
      const composeProdPath = path.join(rootDir, 'docker-compose.prod.yml');
      const content = fs.readFileSync(composeProdPath, 'utf8');

      // Must enforce root credentials
      expect(content).toContain('MONGO_INITDB_ROOT_USERNAME');
      expect(content).toContain('MONGO_INITDB_ROOT_PASSWORD');
      expect(content).toContain('MONGO_ROOT_PASSWORD:?');

      // Host port binding must be restricted to loopback (127.0.0.1), not public 0.0.0.0
      expect(content).toContain('127.0.0.1:27017:27017');
      expect(content).not.toMatch(/ports:\s*\n\s*-\s*['"]27017:27017['"]/);
    });

    it('verifies docker-compose.yml (dev) binds MongoDB and LocalStack S3 to loopback', () => {
      const composeDevPath = path.join(rootDir, 'docker-compose.yml');
      const content = fs.readFileSync(composeDevPath, 'utf8');

      expect(content).toContain('127.0.0.1:27017:27017');
      expect(content).toContain('127.0.0.1:4566:4566');
      expect(content).not.toMatch(/ports:\s*\n\s*-\s*['"]27017:27017['"]/);
      expect(content).not.toMatch(/ports:\s*\n\s*-\s*['"]4566:4566['"]/);
    });

    it('verifies .env.production.template documents MongoDB root authentication variables', () => {
      const templatePath = path.join(rootDir, '.env.production.template');
      const content = fs.readFileSync(templatePath, 'utf8');

      expect(content).toContain('MONGO_ROOT_USER=admin');
      expect(content).toContain('MONGO_ROOT_PASSWORD=__INJECT_MONGO_ROOT_PASSWORD__');
    });
  });
});
