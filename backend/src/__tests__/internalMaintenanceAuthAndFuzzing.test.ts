import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { MaintenanceService } from '../services/maintenance/maintenanceService.js';
import { env } from '../config/env.js';
import { resetRateLimiterCache } from '../middleware/rateLimiter.js';
import {
  resetWorkerAuthReplayCache,
  isPrivateOrLoopbackIp,
  restrictInternalNetwork,
} from '../middleware/workerAuth.js';

// Mock MaintenanceService
vi.mock('../services/maintenance/maintenanceService.js', () => ({
  MaintenanceService: {
    runAbandonedUploadCleanup: vi.fn(),
    startMaintenanceScheduler: vi.fn(),
    stopMaintenanceScheduler: vi.fn(),
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
    body?: any;
    ip?: string;
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
    req.body = options.body || {};
    req.headers = {};
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        req.headers[k.toLowerCase()] = v;
      }
    }
    const clientIp = options.ip || '127.0.0.1';
    req.socket = { remoteAddress: clientIp };
    req.connection = req.socket;
    req.ip = clientIp;

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
        // Leave raw string
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

describe('BUG-002 Prevention Suite: Internal Maintenance Authentication & Input Fuzzing Gating', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterCache();
    resetWorkerAuthReplayCache();
    (MaintenanceService.runAbandonedUploadCleanup as any).mockResolvedValue({
      abortedCount: 3,
      purgedScratchCount: 12,
      stalePreviewsCount: 4,
    });
  });

  describe('1. Unauthenticated Invocation Gating', () => {
    it('rejects POST /api/internal/v1/maintenance/cleanup-uploads with no auth headers with HTTP 401 WORKER_AUTH_MISSING_HEADERS', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        body: {},
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('WORKER_AUTH_MISSING_HEADERS');
      expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
    });

    it('rejects request with invalid internal secret with HTTP 401 INTERNAL_AUTH_INVALID_SECRET', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': 'unauthorized-external-secret',
        },
        body: {},
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('INTERNAL_AUTH_INVALID_SECRET');
      expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
    });

    it('rejects request with invalid worker HMAC signature with HTTP 401 WORKER_AUTH_INVALID_SIGNATURE', async () => {
      const now = Math.floor(Date.now() / 1000);
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-worker-id': 'worker-node-01',
          'x-event-id': 'evt_invalid_sig_test',
          'x-event-timestamp': now.toString(),
          'x-event-signature':
            'sha256=deadbeefcafebabe000000000000000000000000000000000000000000000000',
        },
        body: {},
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('WORKER_AUTH_INVALID_SIGNATURE');
      expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
    });
  });

  describe('2. Authenticated Execution Verification', () => {
    it('executes cleanup successfully with valid X-Internal-Secret and default threshold (24h)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: {},
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.abortedCount).toBe(3);
      expect(MaintenanceService.runAbandonedUploadCleanup).toHaveBeenCalledWith(
        24 * 60 * 60 * 1000
      );
    });

    it('executes cleanup successfully with valid worker HMAC signature', async () => {
      const now = Math.floor(Date.now() / 1000);
      const body = { olderThanHours: 12 };
      const rawBody = JSON.stringify(body);
      const signature = crypto
        .createHmac('sha256', env.INTERNAL_WORKER_SECRET)
        .update(rawBody)
        .digest('hex');

      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-worker-id': 'worker-node-01',
          'x-event-id': 'evt_hmac_cleanup_test',
          'x-event-timestamp': now.toString(),
          'x-event-signature': `sha256=${signature}`,
        },
        body,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(MaintenanceService.runAbandonedUploadCleanup).toHaveBeenCalledWith(
        12 * 60 * 60 * 1000
      );
    });
  });

  describe('3. Fuzzing & Input Bounds Gating (olderThanHours)', () => {
    const invalidInputs = [
      { name: 'zero (0)', val: 0 },
      { name: 'negative number (-5)', val: -5 },
      { name: 'excessive value (721 - exceeds 30d cap)', val: 721 },
      { name: 'arbitrary large number (999999)', val: 999999 },
      { name: 'floating point non-integer (24.5)', val: 24.5 },
      { name: 'string non-numeric ("fuzz_payload")', val: 'fuzz_payload' },
      { name: 'negative string ("-10")', val: '-10' },
      { name: 'NaN', val: NaN },
      { name: 'array fuzzing ([12, 24])', val: [12, 24] },
      { name: 'object fuzzing ({ hours: 24 })', val: { hours: 24 } },
    ];

    for (const testCase of invalidInputs) {
      it(`rejects invalid olderThanHours ${testCase.name} with HTTP 400 INVALID_CLEANUP_THRESHOLD`, async () => {
        const res = await dispatchRequest(app, {
          method: 'POST',
          url: '/api/internal/v1/maintenance/cleanup-uploads',
          headers: {
            'x-internal-secret': env.INTERNAL_WORKER_SECRET,
          },
          body: { olderThanHours: testCase.val },
        });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_CLEANUP_THRESHOLD');
        expect(res.body.error?.message).toMatch(/between 1 and 720/);
        expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
      });
    }

    it('accepts valid upper bound (720 hours / 30 days) and runs cleanup', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: { olderThanHours: 720 },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(MaintenanceService.runAbandonedUploadCleanup).toHaveBeenCalledWith(
        720 * 60 * 60 * 1000
      );
    });

    it('accepts valid lower bound (1 hour) and runs cleanup', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: { olderThanHours: 1 },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(MaintenanceService.runAbandonedUploadCleanup).toHaveBeenCalledWith(1 * 60 * 60 * 1000);
    });
  });

  describe('4. Rate Limiting Protection on Maintenance Route', () => {
    it('blocks excessive rapid invocations beyond limit (10 per window) with HTTP 429', async () => {
      // Use internal private IP to pass network boundary gating and test rate limiter isolation
      const uniqueIp = '10.0.42.100';

      for (let i = 0; i < 10; i++) {
        const res = await dispatchRequest(app, {
          method: 'POST',
          url: '/api/internal/v1/maintenance/cleanup-uploads',
          headers: {
            'x-internal-secret': env.INTERNAL_WORKER_SECRET,
          },
          body: { olderThanHours: 24 },
          ip: uniqueIp,
        });
        expect(res.status).toBe(200);
      }

      // 11th request must be rejected by maintenanceRateLimiter
      const blockedRes = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: { olderThanHours: 24 },
        ip: uniqueIp,
      });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedRes.body.error?.message).toMatch(/Internal maintenance request limit reached/);
    });
  });

  describe('5. Network Boundary & Public Ingress Restriction Gating (SEC-002)', () => {
    const publicIps = ['198.51.100.42', '203.0.113.1', '8.8.8.8', '1.1.1.1', '93.184.216.34'];

    for (const publicIp of publicIps) {
      it(`blocks request from public IP (${publicIp}) with HTTP 403 FORBIDDEN_NETWORK_ACCESS even with valid internal secret`, async () => {
        const res = await dispatchRequest(app, {
          method: 'POST',
          url: '/api/internal/v1/maintenance/cleanup-uploads',
          headers: {
            'x-internal-secret': env.INTERNAL_WORKER_SECRET,
          },
          body: { olderThanHours: 24 },
          ip: publicIp,
        });

        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('FORBIDDEN_NETWORK_ACCESS');
        expect(res.body.error?.message).toMatch(/external networks is prohibited/);
        expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
      });
    }

    it('blocks request with public client IP in X-Forwarded-For header even behind private socket', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
          'x-forwarded-for': '203.0.113.50, 10.0.0.1',
        },
        body: { olderThanHours: 24 },
        ip: '10.0.0.1',
      });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN_NETWORK_ACCESS');
      expect(res.body.error?.message).toMatch(/public ingress proxies is prohibited/);
      expect(MaintenanceService.runAbandonedUploadCleanup).not.toHaveBeenCalled();
    });

    it('allows request from IPv4 loopback (127.0.0.1) with valid internal secret', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: { olderThanHours: 24 },
        ip: '127.0.0.1',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows request from IPv6 loopback (::1) with valid internal secret', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/internal/v1/maintenance/cleanup-uploads',
        headers: {
          'x-internal-secret': env.INTERNAL_WORKER_SECRET,
        },
        body: { olderThanHours: 24 },
        ip: '::1',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows request from private RFC 1918 subnets (10.x, 172.16-31.x, 192.168.x)', async () => {
      const internalIps = ['10.0.1.20', '172.18.0.5', '192.168.1.100'];

      for (const internalIp of internalIps) {
        const res = await dispatchRequest(app, {
          method: 'POST',
          url: '/api/internal/v1/maintenance/cleanup-uploads',
          headers: {
            'x-internal-secret': env.INTERNAL_WORKER_SECRET,
          },
          body: { olderThanHours: 24 },
          ip: internalIp,
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    describe('isPrivateOrLoopbackIp helper unit tests', () => {
      it('correctly classifies loopback, private RFC 1918, link-local, and public IPs', () => {
        // Loopback
        expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('127.0.0.5')).toBe(true);
        expect(isPrivateOrLoopbackIp('::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('localhost')).toBe(true);
        expect(isPrivateOrLoopbackIp('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('127.0.0.1:4000')).toBe(true);
        expect(isPrivateOrLoopbackIp('[::1]:8080')).toBe(true);

        // Private 10.0.0.0/8
        expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('10.254.254.254')).toBe(true);

        // Private 172.16.0.0/12
        expect(isPrivateOrLoopbackIp('172.16.0.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('172.20.5.10')).toBe(true);
        expect(isPrivateOrLoopbackIp('172.31.255.255')).toBe(true);
        expect(isPrivateOrLoopbackIp('172.15.255.255')).toBe(false); // below 16
        expect(isPrivateOrLoopbackIp('172.32.0.1')).toBe(false); // above 31

        // Private 192.168.0.0/16
        expect(isPrivateOrLoopbackIp('192.168.1.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('192.168.254.254')).toBe(true);
        expect(isPrivateOrLoopbackIp('192.169.1.1')).toBe(false);

        // Link-local
        expect(isPrivateOrLoopbackIp('169.254.1.1')).toBe(true);
        expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);

        // IPv6 Unique Local Address
        expect(isPrivateOrLoopbackIp('fc00::1')).toBe(true);
        expect(isPrivateOrLoopbackIp('fd12:3456:789a::1')).toBe(true);

        // Public IPs
        expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false);
        expect(isPrivateOrLoopbackIp('1.1.1.1')).toBe(false);
        expect(isPrivateOrLoopbackIp('203.0.113.1')).toBe(false);
        expect(isPrivateOrLoopbackIp('198.51.100.42')).toBe(false);

        // Edge cases
        expect(isPrivateOrLoopbackIp('')).toBe(false);
        expect(isPrivateOrLoopbackIp(undefined)).toBe(false);
      });
    });
  });
});
