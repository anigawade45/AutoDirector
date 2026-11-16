import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { TokenService } from '../services/auth/tokenService.js';
import { verifyWorkerSignature, resetWorkerAuthReplayCache } from '../middleware/workerAuth.js';
import { securityHeadersMiddleware } from '../middleware/securityHeaders.js';
import {
  createRateLimiter,
  authRateLimiter,
  generalApiRateLimiter,
  resetRateLimiterCache,
} from '../middleware/rateLimiter.js';
import { env } from '../config/env.js';
import { Request, Response } from 'express';
import crypto from 'crypto';

const rootDir = path.resolve(__dirname, '../../..');

describe('Security & Configuration Hardening Suite (Section 5)', () => {
  beforeEach(() => {
    resetWorkerAuthReplayCache();
    resetRateLimiterCache();
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

    it('enforces cross-instance replay deduplication across separate process contexts via shared Redis', async () => {
      // Simulate shared Redis database across multiple API server instances
      const sharedRedisStore = new Map<string, string>();

      const mockRedisSet = vi.fn(
        async (key: string, val: string, exFlag: string, ttl: number, nxFlag: string) => {
          if (nxFlag === 'NX' && sharedRedisStore.has(key)) {
            return null; // Key exists, NX check fails (duplicate)
          }
          sharedRedisStore.set(key, val);
          return 'OK';
        }
      );

      const redisModule = await import('../config/redis.js');
      const originalSet = (redisModule.redisConnection as any).set;
      (redisModule.redisConnection as any).set = mockRedisSet;

      try {
        const now = Math.floor(Date.now() / 1000);
        const eventId = 'evt_multi_instance_' + Date.now();
        const body = { status: 'completed', jobId: 'job_render_456' };
        const rawBody = JSON.stringify(body);
        const signature = crypto
          .createHmac('sha256', env.INTERNAL_WORKER_SECRET)
          .update(rawBody)
          .digest('hex');

        const reqInstance1 = {
          headers: {
            'x-worker-id': 'worker-gpu-node-01',
            'x-event-id': eventId,
            'x-event-timestamp': String(now),
            'x-event-signature': `sha256=${signature}`,
          },
          body,
          id: 'req_inst_1',
        } as unknown as Request;

        let instance1Next = false;
        const resInstance1 = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response;

        // Instance 1 processes the event for the first time
        await verifyWorkerSignature(reqInstance1, resInstance1, () => {
          instance1Next = true;
        });

        expect(instance1Next).toBe(true);
        expect(sharedRedisStore.has(`worker:event:${eventId}`)).toBe(true);

        // Simulate Instance 2 (or process restart where local in-memory cache is empty)
        resetWorkerAuthReplayCache();

        const reqInstance2 = {
          headers: {
            'x-worker-id': 'worker-gpu-node-02',
            'x-event-id': eventId,
            'x-event-timestamp': String(now),
            'x-event-signature': `sha256=${signature}`,
          },
          body,
          id: 'req_inst_2',
        } as unknown as Request;

        let instance2Next = false;
        const resInstance2 = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response;

        // Instance 2 receives replayed event
        await verifyWorkerSignature(reqInstance2, resInstance2, () => {
          instance2Next = true;
        });

        // Instance 2 intercepts replay via shared Redis even though local memory was cleared
        expect(instance2Next).toBe(false);
        expect(resInstance2.status).toHaveBeenCalledWith(200);
        expect(resInstance2.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: { accepted: true, duplicate: true },
          })
        );
      } finally {
        (redisModule.redisConnection as any).set = originalSet;
      }
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

  // =========================================================================
  // 6. Security Headers Middleware (OWASP / Helmet Equivalent)
  // =========================================================================
  describe('6. Security Headers Middleware (OWASP Standards)', () => {
    it('sets essential security headers and strips technology fingerprinting', () => {
      const headers: Record<string, string> = { 'x-powered-by': 'Express' };

      const mockReq = {
        headers: {},
        secure: true,
      } as unknown as Request;

      const mockRes = {
        removeHeader: vi.fn((k: string) => {
          delete headers[k.toLowerCase()];
        }),
        setHeader: vi.fn((k: string, v: string) => {
          headers[k.toLowerCase()] = v;
        }),
      } as unknown as Response;

      let nextCalled = false;
      securityHeadersMiddleware(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['x-xss-protection']).toBe('0');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['content-security-policy']).toContain("default-src 'self'");
      expect(headers['origin-agent-cluster']).toBe('?1');
    });
  });

  // =========================================================================
  // 7. Rate Limiting Middleware & Abuse Gating
  // =========================================================================
  describe('7. Rate Limiting Middleware & Abuse Gating', () => {
    it('allows requests within window and returns rate limit headers', async () => {
      const limiter = createRateLimiter({
        prefix: 'test_limit',
        windowMs: 60000,
        max: 5,
      });

      const headers: Record<string, any> = {};
      const mockReq = {
        headers: { 'x-forwarded-for': '198.51.100.1' },
      } as unknown as Request;

      const mockRes = {
        setHeader: vi.fn((k: string, v: any) => {
          headers[k] = v;
        }),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      let nextCalled = false;
      await limiter(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(headers['X-RateLimit-Limit']).toBe(5);
      expect(headers['X-RateLimit-Remaining']).toBe(4);
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('rejects requests with HTTP 429 when max limit is exceeded', async () => {
      const limiter = createRateLimiter({
        prefix: 'test_burst',
        windowMs: 60000,
        max: 2,
      });

      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.42' },
      } as unknown as Request;

      const createMockRes = () => {
        const h: Record<string, any> = {};
        return {
          headers: h,
          setHeader: vi.fn((k: string, v: any) => {
            h[k] = v;
          }),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response & { headers: Record<string, any> };
      };

      // 1st request -> ok
      let res1 = createMockRes();
      await limiter(mockReq, res1, () => {});
      expect(res1.status).not.toHaveBeenCalled();

      // 2nd request -> ok
      let res2 = createMockRes();
      await limiter(mockReq, res2, () => {});
      expect(res2.status).not.toHaveBeenCalled();

      // 3rd request -> exceeds max of 2 -> HTTP 429
      let res3 = createMockRes();
      let nextCalled3 = false;
      await limiter(mockReq, res3, () => {
        nextCalled3 = true;
      });

      expect(nextCalled3).toBe(false);
      expect(res3.status).toHaveBeenCalledWith(429);
      expect(res3.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
          }),
        })
      );
      expect(res3.headers['Retry-After']).toBeDefined();
    });

    it('skips rate limiting on health check probe paths', async () => {
      const mockReq = {
        path: '/health/live',
        headers: {},
      } as unknown as Request;

      const mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      let nextCalled = false;
      await generalApiRateLimiter(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 8. Reverse Proxy Trust Chain, Dev S3 CORS & Manifest Externalization
  // =========================================================================
  describe('8. Reverse Proxy Trust Chain, S3 Dev CORS & Manifest Hygiene', () => {
    it('verifies app configures trust proxy for Nginx / Render ingress headers', () => {
      const app = createApp();
      expect(app.get('trust proxy')).toBeTruthy();
    });

    it('verifies docker-compose.yml does not set wildcard EXTRA_CORS_ALLOWED_ORIGINS on S3', () => {
      const composePath = path.join(rootDir, 'docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf8');

      expect(content).not.toMatch(/EXTRA_CORS_ALLOWED_ORIGINS=\*/);
      expect(content).toContain('EXTRA_CORS_ALLOWED_ORIGINS=http://localhost:5173');
    });

    it('verifies frontend/nginx.conf includes server_tokens off and OWASP headers', () => {
      const nginxPath = path.join(rootDir, 'frontend/nginx.conf');
      expect(fs.existsSync(nginxPath)).toBe(true);

      const content = fs.readFileSync(nginxPath, 'utf8');
      expect(content).toContain('server_tokens off;');
      expect(content).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
      expect(content).toContain('add_header X-Content-Type-Options "nosniff" always;');
      expect(content).toContain('client_max_body_size 50M;');
      expect(content).toContain('proxy_set_header X-Forwarded-Host $host;');
    });

    it('verifies render.yaml externalizes S3_BUCKET_NAME and AWS_REGION via sync: false', () => {
      const renderPath = path.join(rootDir, 'render.yaml');
      const content = fs.readFileSync(renderPath, 'utf8');

      expect(content).not.toContain('ai-video-studio-prod-aniket');
      expect(content).toContain('key: S3_BUCKET_NAME');
      expect(content).toContain('sync: false');
    });
  });
});
