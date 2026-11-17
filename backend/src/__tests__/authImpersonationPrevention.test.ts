import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { TokenService } from '../services/auth/tokenService.js';
import mongoose from 'mongoose';

// Mock UserModel and ProjectModel
vi.mock('../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

interface SimulatedResponse {
  status: number;
  headers: Record<string, any>;
  body: any;
}

function dispatchRequest(
  app: any,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  }
): Promise<SimulatedResponse> {
  return new Promise((resolve) => {
    const parsed = new URL(options.url, 'http://127.0.0.1');
    const queryParams: Record<string, string> = {
      ...Object.fromEntries(parsed.searchParams.entries()),
      ...(options.query || {}),
    };

    const req = new EventEmitter() as any;
    req.method = options.method;
    req.url = parsed.pathname + parsed.search;
    req.originalUrl = parsed.pathname + parsed.search;
    req.path = parsed.pathname;
    req.query = queryParams;
    req.headers = {};
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        req.headers[k.toLowerCase()] = v;
      }
    }
    req.socket = { remoteAddress: '127.0.0.1' };
    req.connection = req.socket;

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

    res.json = (data: any) => {
      responseHeaders['content-type'] = 'application/json';
      responseData = JSON.stringify(data);
      res.end();
      return res;
    };

    res.send = (data: any) => {
      if (typeof data === 'object') {
        return res.json(data);
      }
      responseData = String(data);
      res.end();
      return res;
    };

    res.write = (chunk: any) => {
      responseData += chunk;
      return true;
    };

    res.end = (chunk?: any) => {
      if (chunk) responseData += chunk;
      let parsedBody = responseData;
      try {
        parsedBody = JSON.parse(responseData);
      } catch {
        // Keep as string if not JSON
      }
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        body: parsedBody,
      });
      return res;
    };

    app.handle(req, res);
  });
}

describe('BUG-001 Prevention Suite: Bearer & Query Token Cryptographic Enforcement', () => {
  const app = createApp();
  const validObjectId = '507f1f77bcf86cd799439011';
  const knownEmail = 'alice.director@studio.ai';

  const mockUserDoc = {
    _id: new mongoose.Types.ObjectId(validObjectId),
    id: validObjectId,
    email: knownEmail,
    name: 'Alice Director',
    tier: 'pro',
    quota: { storageBytes: 50 * 1024 * 1024 * 1024, maxExportsPerMonth: 50 },
    usage: { storageBytesUsed: 1024, exportsThisMonth: 2 },
  };

  const validJwt = TokenService.generateToken({
    id: validObjectId,
    email: knownEmail,
    tier: 'pro',
    name: 'Alice Director',
  });

  beforeEach(() => {
    vi.clearAllMocks();

    (UserModel.findById as any).mockImplementation((id: any) => {
      if (id?.toString() === validObjectId || id === validObjectId) {
        return Promise.resolve(mockUserDoc);
      }
      return Promise.resolve(null);
    });

    (UserModel.findOne as any).mockImplementation((filter: any) => {
      if (filter?.email === knownEmail) {
        return Promise.resolve(mockUserDoc);
      }
      return Promise.resolve(null);
    });

    const mockFindChain = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          publicId: 'prj_audit_rec_1',
          userId: mockUserDoc._id,
          title: 'Secure Timeline Project',
          status: 'draft',
        },
      ]),
    };
    (ProjectModel.find as any).mockReturnValue(mockFindChain);
  });

  describe('1. GET /api/auth/me Profile Endpoint Verification', () => {
    it('rejects raw valid MongoDB ObjectId as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${validObjectId}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
      expect(res.body.error?.message).toMatch(/Invalid, expired, or malformed JWT token/);
    });

    it('rejects user_-prefixed raw ObjectId as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer user_${validObjectId}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects known user email address as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${knownEmail}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects raw identifiers passed via query string (?token=) on /api/auth/me with HTTP 401', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/auth/me?token=${validObjectId}`,
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('QUERY_TOKEN_FORBIDDEN');
    });

    it('authenticates successfully and returns HTTP 200 with user profile when valid signed JWT is provided', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${validJwt}`,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.user?.email).toBe(knownEmail);
      expect(res.body.data?.user?.tier).toBe('pro');
    });
  });

  describe('2. Protected Resource Endpoint (GET /api/projects) Verification', () => {
    it('rejects raw valid MongoDB ObjectId as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/projects',
        headers: {
          authorization: `Bearer ${validObjectId}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects user_-prefixed raw ObjectId as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/projects',
        headers: {
          authorization: `Bearer user_${validObjectId}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects known user email as Bearer token with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/projects',
        headers: {
          authorization: `Bearer ${knownEmail}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects query parameter tokens (?token=) on /api/projects with 401 QUERY_TOKEN_FORBIDDEN', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/projects?token=${knownEmail}`,
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('QUERY_TOKEN_FORBIDDEN');
    });

    it('authenticates successfully and returns HTTP 200 with project list when valid signed JWT is provided', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/projects',
        headers: {
          authorization: `Bearer ${validJwt}`,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].publicId).toBe('prj_audit_rec_1');
    });
  });

  describe('3. SSE Streaming Route Ingestion Hardening (/api/jobs/:id/events)', () => {
    it('rejects raw MongoDB ObjectId passed via ?token= on SSE endpoint with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/jobs/job_123/events?token=${validObjectId}`,
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
      expect(res.body.error?.message).toMatch(/Invalid, expired, or malformed JWT token/);
    });

    it('rejects raw email address passed via ?token= on SSE endpoint with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/jobs/job_123/events?token=${knownEmail}`,
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects fake/unissued ticket passed via ?ticket= with HTTP 401 INVALID_OR_EXPIRED_TICKET', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/jobs/job_123/events?ticket=${validObjectId}`,
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('INVALID_OR_EXPIRED_TICKET');
    });
  });

  describe('4. Cryptographic Tampering & Algorithm Exploitation Resistance', () => {
    it('rejects tokens with alg: none attack with HTTP 401 UNAUTHENTICATED', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: validObjectId,
          email: knownEmail,
          tier: 'pro',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${noneToken}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects tokens signed with an invalid or untrusted secret with HTTP 401 UNAUTHENTICATED', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url'
      );
      const payload = Buffer.from(
        JSON.stringify({
          sub: validObjectId,
          email: knownEmail,
          tier: 'pro',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const fakeSig = crypto
        .createHmac('sha256', 'completely_wrong_attacker_secret_key_12345')
        .update(`${header}.${payload}`)
        .digest('base64url');
      const tamperedToken = `${header}.${payload}.${fakeSig}`;

      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${tamperedToken}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects expired JWT tokens with HTTP 401 UNAUTHENTICATED', async () => {
      const expiredToken = TokenService.generateToken(
        { id: validObjectId, email: knownEmail, tier: 'pro' },
        -3600
      );

      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('5. Cookie-Based Raw Identifier Impersonation Resistance', () => {
    it('rejects raw MongoDB ObjectId passed via auth_token cookie with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: `auth_token=${validObjectId}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects raw email address passed via auth_token cookie with HTTP 401 UNAUTHENTICATED', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: `auth_token=${knownEmail}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    });
  });
});
