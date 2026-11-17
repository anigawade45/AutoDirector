import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { createApp } from '../app.js';
import { TokenService } from '../services/auth/tokenService.js';
import { AuthController } from '../controllers/authController.js';
import { UserModel } from '../models/User.js';
import { verifyWorkerSignature, resetWorkerAuthReplayCache } from '../middleware/workerAuth.js';
import { securityHeadersMiddleware } from '../middleware/securityHeaders.js';
import {
  createRateLimiter,
  authRateLimiter,
  accountBruteForceLimiter,
  uploadRateLimiter,
  jobsRateLimiter,
  generalApiRateLimiter,
  resetRateLimiterCache,
} from '../middleware/rateLimiter.js';
import { env, validateCorsOrigin, envSchema } from '../config/env.js';
import { Request, Response } from 'express';
import crypto from 'crypto';

const rootDir = path.resolve(__dirname, '../../..');

function dispatchRequest(
  app: any,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
  }
): Promise<{ statusCode: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve) => {
    const parsed = new URL(options.url, 'http://127.0.0.1');

    const req = new EventEmitter() as any;
    req.method = options.method;
    req.url = parsed.pathname + parsed.search;
    req.originalUrl = parsed.pathname + parsed.search;
    req.path = parsed.pathname;
    req.query = Object.fromEntries(parsed.searchParams.entries());
    req.body = {};
    req.headers = {};
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        req.headers[k.toLowerCase()] = v;
      }
    }
    req.socket = { remoteAddress: '127.0.0.1' };
    req.connection = req.socket;
    req.ip = '127.0.0.1';

    const res = new EventEmitter() as any;
    res.statusCode = 200;
    const responseHeaders: Record<string, any> = {};
    let responseData = '';

    res.setHeader = (name: string, value: any) => {
      responseHeaders[name.toLowerCase()] = value;
      return res;
    };
    res.getHeader = (name: string) => responseHeaders[name.toLowerCase()];
    res.removeHeader = (name: string) => {
      delete responseHeaders[name.toLowerCase()];
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.sendStatus = (code: number) => {
      res.statusCode = code;
      resolve({ statusCode: code, headers: responseHeaders, body: '' });
      return res;
    };
    res.json = (data: any) => {
      responseData = JSON.stringify(data);
      resolve({ statusCode: res.statusCode, headers: responseHeaders, body: responseData });
      return res;
    };
    res.send = (data: any) => {
      responseData = typeof data === 'string' ? data : JSON.stringify(data);
      resolve({ statusCode: res.statusCode, headers: responseHeaders, body: responseData });
      return res;
    };
    res.end = (chunk?: any) => {
      if (chunk) {
        responseData += typeof chunk === 'string' ? chunk : chunk.toString();
      }
      resolve({ statusCode: res.statusCode, headers: responseHeaders, body: responseData });
      return res;
    };

    app.handle(req, res, () => {
      resolve({ statusCode: res.statusCode, headers: responseHeaders, body: responseData });
    });
  });
}

describe('Security & Configuration Hardening Suite (Section 5)', () => {
  beforeEach(() => {
    resetWorkerAuthReplayCache();
    resetRateLimiterCache();
  });

  // =========================================================================
  // 1. CORS Origin Configuration & Credential Safety (BUG-009)
  // =========================================================================
  describe('1. CORS Origin Configuration & Credential Safety', () => {
    it('verifies that render.yaml sets an explicit frontend origin instead of wildcard *', () => {
      const renderPath = path.join(rootDir, 'render.yaml');
      expect(fs.existsSync(renderPath)).toBe(true);

      const renderContent = fs.readFileSync(renderPath, 'utf8');
      expect(renderContent).not.toMatch(/CORS_ORIGIN\s*\n\s*value:\s*"\*"/);
      expect(renderContent).not.toMatch(/CORS_ORIGIN\s*\n\s*value:\s*'\*'/);
      expect(renderContent).toContain('value: https://ai-video-frontend-57bk.onrender.com');
    });

    it('validates CORS_ORIGIN at startup via validateCorsOrigin, rejecting wildcards and malformed origins in production', () => {
      // Rejects wildcard in production
      const wild = validateCorsOrigin('*', 'production');
      expect(wild.valid).toBe(false);
      expect(wild.reason).toContain('Wildcard CORS_ORIGIN ("*") is prohibited in production');

      // Rejects comma-separated lists containing wildcard in production
      const mixed = validateCorsOrigin('https://studio.ai, *', 'production');
      expect(mixed.valid).toBe(false);
      expect(mixed.reason).toContain('Wildcard CORS_ORIGIN ("*") is prohibited in production');

      // Rejects empty / whitespace in production
      const empty = validateCorsOrigin('   ', 'production');
      expect(empty.valid).toBe(false);
      expect(empty.reason).toContain('CORS_ORIGIN is required in production');

      // Rejects origin missing protocol in production
      const noProto = validateCorsOrigin('studio.ai', 'production');
      expect(noProto.valid).toBe(false);
      expect(noProto.reason).toContain('must start with http:// or https://');

      // Accepts valid single HTTPS origin in production
      const validSingle = validateCorsOrigin(
        'https://ai-video-frontend-57bk.onrender.com',
        'production'
      );
      expect(validSingle.valid).toBe(true);

      // Accepts valid comma-separated HTTPS origins in production
      const validMulti = validateCorsOrigin(
        'https://ai-video-frontend-57bk.onrender.com, https://studio.ai, https://app.autodirector.com',
        'production'
      );
      expect(validMulti.valid).toBe(true);

      // Allows wildcard or dev origins in non-production environments
      const devWild = validateCorsOrigin('*', 'development');
      expect(devWild.valid).toBe(true);
      const testWild = validateCorsOrigin('*', 'test');
      expect(testWild.valid).toBe(true);
    });

    it('enforces schema-level startup rejection of wildcard CORS_ORIGIN in production', () => {
      const baseValidEnv = {
        PORT: '4000',
        NODE_ENV: 'production',
        API_BASE_URL: 'https://api.autodirector.com/api',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'super-secure-production-jwt-secret-key-12345',
        INTERNAL_WORKER_SECRET: 'super-secure-worker-secret-key-12345',
        MONGODB_URI: 'mongodb://localhost:27017/prod',
        AWS_ACCESS_KEY_ID: 'AKIA_PROD_12345',
        AWS_SECRET_ACCESS_KEY: 'secret_key_prod_12345',
        S3_BUCKET_NAME: 'prod-bucket',
      };

      const parseResult = envSchema.safeParse(baseValidEnv);
      expect(parseResult.success).toBe(false);
      if (!parseResult.success) {
        const corsIssue = parseResult.error.issues.find((i) => i.path.includes('CORS_ORIGIN'));
        expect(corsIssue).toBeDefined();
        expect(corsIssue?.message).toContain('Wildcard CORS_ORIGIN ("*") is prohibited in production');
      }

      // Valid production origin passes schema validation
      const validParseResult = envSchema.safeParse({
        ...baseValidEnv,
        CORS_ORIGIN: 'https://ai-video-frontend-57bk.onrender.com, https://studio.ai',
      });
      expect(validParseResult.success).toBe(true);

      // Omitting CORS_ORIGIN in production defaults to wildcard and is rejected
      const { CORS_ORIGIN: _omitted, ...envWithoutCors } = baseValidEnv;
      const omittedParseResult = envSchema.safeParse(envWithoutCors);
      expect(omittedParseResult.success).toBe(false);
      if (!omittedParseResult.success) {
        const corsIssue = omittedParseResult.error.issues.find((i) => i.path.includes('CORS_ORIGIN'));
        expect(corsIssue).toBeDefined();
        expect(corsIssue?.message).toMatch(/Wildcard CORS_ORIGIN \("\*"\) is prohibited in production|CORS_ORIGIN is required in production/);
      }

      // Empty string / whitespace CORS_ORIGIN in production is rejected
      const emptyParseResult = envSchema.safeParse({
        ...baseValidEnv,
        CORS_ORIGIN: '   ',
      });
      expect(emptyParseResult.success).toBe(false);
      if (!emptyParseResult.success) {
        const corsIssue = emptyParseResult.error.issues.find((i) => i.path.includes('CORS_ORIGIN'));
        expect(corsIssue).toBeDefined();
        expect(corsIssue?.message).toContain('CORS_ORIGIN is required in production');
      }
    });

    it('executes CORS integration dispatch allowing configured origins with credentials and rejecting unauthorized origins', async () => {
      const allowedPrimary = 'https://ai-video-frontend-57bk.onrender.com';
      const allowedSecondary = 'https://studio.ai';
      const unauthorizedOrigin = 'https://malicious-attacker.com';

      const app = createApp({ corsOrigins: [allowedPrimary, allowedSecondary] });

      // 1. Primary configured origin receives matching Access-Control-Allow-Origin and credentials
      const resPrimary = await dispatchRequest(app, {
        method: 'GET',
        url: '/health/live',
        headers: { origin: allowedPrimary },
      });
      expect(resPrimary.statusCode).toBe(200);
      expect(resPrimary.headers['access-control-allow-origin']).toBe(allowedPrimary);
      expect(resPrimary.headers['access-control-allow-credentials']).toBe('true');

      // 2. Secondary comma-separated configured origin receives matching Allow-Origin
      const resSecondary = await dispatchRequest(app, {
        method: 'GET',
        url: '/health/live',
        headers: { origin: allowedSecondary },
      });
      expect(resSecondary.statusCode).toBe(200);
      expect(resSecondary.headers['access-control-allow-origin']).toBe(allowedSecondary);
      expect(resSecondary.headers['access-control-allow-credentials']).toBe('true');

      // 3. Unauthorized origin does not receive Access-Control-Allow-Origin
      const resUnauthorized = await dispatchRequest(app, {
        method: 'GET',
        url: '/health/live',
        headers: { origin: unauthorizedOrigin },
      });
      expect(resUnauthorized.headers['access-control-allow-origin']).toBeUndefined();

      // 4. Preflight OPTIONS request from configured origin returns 204 with methods and credentials
      const resPreflight = await dispatchRequest(app, {
        method: 'OPTIONS',
        url: '/api/auth/me',
        headers: {
          origin: allowedPrimary,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(resPreflight.statusCode).toBe(204);
      expect(resPreflight.headers['access-control-allow-origin']).toBe(allowedPrimary);
      expect(resPreflight.headers['access-control-allow-credentials']).toBe('true');
      expect(resPreflight.headers['access-control-allow-methods']).toContain('GET');

      // 5. Preflight OPTIONS from unauthorized origin is rejected
      const resPreflightUnauthorized = await dispatchRequest(app, {
        method: 'OPTIONS',
        url: '/api/auth/me',
        headers: {
          origin: unauthorizedOrigin,
          'access-control-request-method': 'GET',
        },
      });
      expect(resPreflightUnauthorized.headers['access-control-allow-origin']).toBeUndefined();

      // 6. Non-browser request without Origin header (e.g. server-to-server, curl) is accepted
      const resNonBrowser = await dispatchRequest(app, {
        method: 'GET',
        url: '/health/live',
      });
      expect(resNonBrowser.statusCode).toBe(200);
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

    it('refuses to use insecure fallback if JWT_SECRET is whitespace only (SEC-007)', () => {
      const originalSecret = env.JWT_SECRET;
      try {
        (env as any).JWT_SECRET = '   \t  \n ';
        expect(() => {
          (TokenService as any).getSecret();
        }).toThrow(/JWT_SECRET configuration is missing or empty/i);
        expect(TokenService.hasConfiguredSecret()).toBe(false);
      } finally {
        (env as any).JWT_SECRET = originalSecret;
      }
    });

    it('fails closed in verifyToken returning null when JWT_SECRET is missing (SEC-007)', () => {
      const payload = {
        id: 'usr_fail_closed',
        email: 'failclosed@studio.ai',
        tier: 'free',
      };
      const token = TokenService.generateToken(payload, 3600);
      expect(token).toBeDefined();

      const originalSecret = env.JWT_SECRET;
      try {
        (env as any).JWT_SECRET = '';
        const verified = TokenService.verifyToken(token);
        expect(verified).toBeNull();
      } finally {
        (env as any).JWT_SECRET = originalSecret;
      }
    });

    it('fails closed in generateToken throwing when JWT_SECRET is missing (SEC-007)', () => {
      const originalSecret = env.JWT_SECRET;
      try {
        (env as any).JWT_SECRET = '';
        expect(() => {
          TokenService.generateToken({
            id: 'usr_fail_closed_gen',
            email: 'failgen@studio.ai',
            tier: 'free',
          });
        }).toThrow(/JWT_SECRET configuration is missing or empty/i);
      } finally {
        (env as any).JWT_SECRET = originalSecret;
      }
    });

    it('statically verifies tokenService.ts source code contains zero hardcoded fallback strings (SEC-007)', () => {
      const tokenServiceSourcePath = path.resolve(__dirname, '../services/auth/tokenService.ts');
      expect(fs.existsSync(tokenServiceSourcePath)).toBe(true);
      const source = fs.readFileSync(tokenServiceSourcePath, 'utf8');

      // Must not contain legacy hardcoded default fallback
      expect(source).not.toContain("|| 'ai-video-studio-jwt-secret-key-2026'");
      expect(source).not.toMatch(/getSecret\(\)[^{]*\{\s*return\s+env\.JWT_SECRET\s*\|\|/);
    });

    it('enforces startup Zod schema rejection of weak or placeholder JWT_SECRET in production (SEC-007)', () => {
      const baseValidProd = {
        PORT: '4000',
        NODE_ENV: 'production' as const,
        API_BASE_URL: 'https://api.studio.ai/api',
        CORS_ORIGIN: 'https://studio.ai',
        INTERNAL_WORKER_SECRET: 'super-secure-production-worker-secret-12345',
        MONGODB_URI: 'mongodb://localhost:27017/prod',
        AWS_ACCESS_KEY_ID: 'AKIA_PROD_12345',
        AWS_SECRET_ACCESS_KEY: 'secret_key_prod_12345',
        S3_BUCKET_NAME: 'prod-bucket',
      };

      // 1. Whitespace only JWT_SECRET
      const wsResult = envSchema.safeParse({
        ...baseValidProd,
        JWT_SECRET: '     ',
      });
      expect(wsResult.success).toBe(false);

      // 2. Short secret (< 32 characters) in production
      const shortResult = envSchema.safeParse({
        ...baseValidProd,
        JWT_SECRET: 'short_secret_under_32_chars',
      });
      expect(shortResult.success).toBe(false);
      if (!shortResult.success) {
        const issue = shortResult.error.issues.find((i) => i.path.includes('JWT_SECRET'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('Must be at least 32 characters');
      }

      // 3. Legacy placeholder in production
      const placeholderResult = envSchema.safeParse({
        ...baseValidProd,
        JWT_SECRET: 'ai-video-studio-jwt-secret-key-2026',
      });
      expect(placeholderResult.success).toBe(false);

      // 4. Template placeholder in production
      const templatePlaceholderResult = envSchema.safeParse({
        ...baseValidProd,
        JWT_SECRET: '__INJECT_VIA_SECRETS_MANAGER_MIN_32_CHARS__',
      });
      expect(templatePlaceholderResult.success).toBe(false);

      // 5. Verified valid production secret (>= 32 chars, random/strong)
      const validResult = envSchema.safeParse({
        ...baseValidProd,
        JWT_SECRET: 'super-secure-production-random-jwt-secret-987654321',
      });
      expect(validResult.success).toBe(true);
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

    it('enforces account-level brute-force throttling across distributed client IPs (SEC-009)', async () => {
      const targetEmail = 'target-user@example.com';
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

      // 10 attempts from 10 different distributed IP addresses targeting targetEmail
      for (let i = 1; i <= 10; i++) {
        const req = {
          body: { email: targetEmail },
          headers: { 'x-forwarded-for': `192.0.2.${i}` },
        } as unknown as Request;
        const res = createMockRes();
        let nextCalled = false;
        await accountBruteForceLimiter(req, res, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(true);
        expect(res.status).not.toHaveBeenCalled();
      }

      // 11th attempt from another distinct IP (192.0.2.11) targeting targetEmail should be throttled (HTTP 429)
      const attackReq = {
        body: { email: `  ${targetEmail.toUpperCase()}  ` }, // tests normalization (trim + lowercase)
        headers: { 'x-forwarded-for': '192.0.2.11' },
      } as unknown as Request;
      const attackRes = createMockRes();
      let attackNextCalled = false;
      await accountBruteForceLimiter(attackReq, attackRes, () => {
        attackNextCalled = true;
      });

      expect(attackNextCalled).toBe(false);
      expect(attackRes.status).toHaveBeenCalledWith(429);
      expect(attackRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
            message: expect.stringContaining('Too many login attempts for this account'),
          }),
        })
      );

      // Meanwhile, an attempt targeting an unattacked account from the same IP succeeds
      const innocentReq = {
        body: { email: 'innocent@example.com' },
        headers: { 'x-forwarded-for': '192.0.2.11' },
      } as unknown as Request;
      const innocentRes = createMockRes();
      let innocentNextCalled = false;
      await accountBruteForceLimiter(innocentReq, innocentRes, () => {
        innocentNextCalled = true;
      });
      expect(innocentNextCalled).toBe(true);
      expect(innocentRes.status).not.toHaveBeenCalled();
    });

    it('enforces upload rate limiting per user/IP (SEC-009)', async () => {
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

      const userReq = {
        user: { id: 'user_upload_test_123' },
        headers: { 'x-forwarded-for': '198.51.100.50' },
      } as unknown as Request;

      // 60 requests within limit
      for (let i = 1; i <= 60; i++) {
        const res = createMockRes();
        let nextCalled = false;
        await uploadRateLimiter(userReq, res, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(true);
      }

      // 61st request rejected with HTTP 429
      const overflowRes = createMockRes();
      let overflowNextCalled = false;
      await uploadRateLimiter(userReq, overflowRes, () => {
        overflowNextCalled = true;
      });
      expect(overflowNextCalled).toBe(false);
      expect(overflowRes.status).toHaveBeenCalledWith(429);
      expect(overflowRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
            message: expect.stringContaining('Upload request limit reached'),
          }),
        })
      );
    });

    it('enforces jobs rate limiting per user/IP (SEC-009)', async () => {
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

      const userReq = {
        user: { id: 'user_jobs_test_456' },
        headers: { 'x-forwarded-for': '198.51.100.60' },
      } as unknown as Request;

      // 120 queries within limit
      for (let i = 1; i <= 120; i++) {
        const res = createMockRes();
        let nextCalled = false;
        await jobsRateLimiter(userReq, res, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(true);
      }

      // 121st query rejected with HTTP 429
      const overflowRes = createMockRes();
      let overflowNextCalled = false;
      await jobsRateLimiter(userReq, overflowRes, () => {
        overflowNextCalled = true;
      });
      expect(overflowNextCalled).toBe(false);
      expect(overflowRes.status).toHaveBeenCalledWith(429);
      expect(overflowRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
            message: expect.stringContaining('Job status query limit reached'),
          }),
        })
      );
    });

    it('verifies route mounting for upload, jobs, and auth brute-force rate limiters (SEC-009)', () => {
      const uploadsRoutesPath = path.join(rootDir, 'backend/src/routes/uploads.routes.ts');
      const jobsRoutesPath = path.join(rootDir, 'backend/src/routes/jobs.routes.ts');
      const authRoutesPath = path.join(rootDir, 'backend/src/routes/auth.routes.ts');

      const uploadsContent = fs.readFileSync(uploadsRoutesPath, 'utf8');
      const jobsContent = fs.readFileSync(jobsRoutesPath, 'utf8');
      const authContent = fs.readFileSync(authRoutesPath, 'utf8');

      expect(uploadsContent).toContain('uploadRateLimiter');
      expect(uploadsContent).toMatch(/uploadsRouter\.use\(\s*uploadRateLimiter\s*\)/);

      expect(jobsContent).toContain('jobsRateLimiter');
      expect(jobsContent).toMatch(/jobsRouter\.use\(\s*jobsRateLimiter\s*\)/);

      expect(authContent).toContain('accountBruteForceLimiter');
      expect(authContent).toMatch(/authRouter\.post\(\s*['"]\/login['"],\s*accountBruteForceLimiter/);
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

  // =========================================================================
  // 9. Session Hardening, HttpOnly Cookies, Token Rotation & CSP (SEC-010)
  // =========================================================================
  describe('9. Session Hardening, HttpOnly Cookies, Token Rotation & CSP (SEC-010)', () => {
    it('rotates valid tokens with updated iat and exp while preserving claims', () => {
      const original = TokenService.generateToken(
        { id: 'usr_rot_01', email: 'rot@studio.ai', tier: 'pro', name: 'Rotator' },
        3600
      );

      const rotated = TokenService.rotateToken(original, 7200);
      expect(rotated).not.toBeNull();
      expect(rotated).not.toBe(original);

      const verified = TokenService.verifyToken(rotated!);
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe('usr_rot_01');
      expect(verified?.email).toBe('rot@studio.ai');
      expect(verified?.tier).toBe('pro');
      expect(verified?.name).toBe('Rotator');
      expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3600);
    });

    it('sets HttpOnly session cookie on successful registration and login', async () => {
      const mockReq = {
        body: {
          email: 'cookie-user@studio.ai',
          name: 'Cookie User',
          password: 'Password123!',
          tier: 'pro',
        },
        id: 'req_cookie_reg',
      } as unknown as Request;

      const cookieSpy = vi.fn();
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        cookie: cookieSpy,
      } as unknown as Response;

      // Mock UserModel
      const origFindOne = UserModel.findOne;
      const origCreate = UserModel.create;
      (UserModel as any).findOne = vi.fn().mockResolvedValue(null);
      (UserModel as any).create = vi.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439099',
        email: 'cookie-user@studio.ai',
        name: 'Cookie User',
        tier: 'pro',
        quota: {},
        usage: {},
      });

      try {
        await AuthController.register(mockReq, mockRes, vi.fn());
        expect(cookieSpy).toHaveBeenCalledWith(
          'auth_token',
          expect.any(String),
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
          })
        );
      } finally {
        (UserModel as any).findOne = origFindOne;
        (UserModel as any).create = origCreate;
      }
    });

    it('clears HttpOnly session cookie on logout', async () => {
      const clearCookieSpy = vi.fn();
      const mockReq = { id: 'req_logout_1' } as unknown as Request;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        clearCookie: clearCookieSpy,
      } as unknown as Response;

      await AuthController.logout(mockReq, mockRes, vi.fn());

      expect(clearCookieSpy).toHaveBeenCalledWith(
        'auth_token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining('Signed out successfully'),
          }),
        })
      );
    });

    it('refreshes and rotates token via POST /refresh', async () => {
      const validToken = TokenService.generateToken({
        id: '507f1f77bcf86cd799439088',
        email: 'refresh@studio.ai',
        tier: 'enterprise',
        name: 'Refresher',
      });

      const cookieSpy = vi.fn();
      const mockReq = {
        headers: {
          authorization: `Bearer ${validToken}`,
        },
        id: 'req_refresh_1',
      } as unknown as Request;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        cookie: cookieSpy,
      } as unknown as Response;

      const origFindById = UserModel.findById;
      (UserModel as any).findById = vi.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439088',
        email: 'refresh@studio.ai',
        name: 'Refresher',
        tier: 'enterprise',
        quota: {},
        usage: {},
      });

      try {
        await AuthController.refresh(mockReq, mockRes, vi.fn());

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(cookieSpy).toHaveBeenCalledWith(
          'auth_token',
          expect.any(String),
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
          })
        );
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({
              token: expect.any(String),
              jwt: expect.any(String),
            }),
          })
        );
      } finally {
        (UserModel as any).findById = origFindById;
      }
    });

    it('verifies route mounting for /logout and /refresh in auth.routes.ts', () => {
      const authRoutesPath = path.join(rootDir, 'backend/src/routes/auth.routes.ts');
      const content = fs.readFileSync(authRoutesPath, 'utf8');

      expect(content).toMatch(/authRouter\.post\(\s*['"]\/logout['"],\s*AuthController\.logout\s*\)/);
      expect(content).toMatch(/authRouter\.post\(\s*['"]\/refresh['"],\s*AuthController\.refresh\s*\)/);
    });

    it('verifies frontend/nginx.conf includes Content-Security-Policy and X-XSS-Protection "0"', () => {
      const nginxPath = path.join(rootDir, 'frontend/nginx.conf');
      const content = fs.readFileSync(nginxPath, 'utf8');

      expect(content).toContain('add_header Content-Security-Policy');
      expect(content).toContain("default-src 'self'");
      expect(content).toContain('add_header X-XSS-Protection "0" always;');
    });
  });
});
