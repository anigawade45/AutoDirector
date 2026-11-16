import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductionSmokeTestSuite } from '../scripts/smokeTest.js';
import { S3Service } from '../services/storage/s3Service.js';
import { redisConnection } from '../config/redis.js';

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    checkHealth: vi.fn(),
  },
}));

vi.mock('../config/redis.js', () => ({
  redisConnection: {
    status: 'ready',
    ping: vi.fn(),
  },
  createRedisConnection: vi.fn(),
}));

describe('ProductionSmokeTestSuite Acceptance & Resilience Suite (BUG-007 Verification)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (S3Service.checkHealth as any).mockResolvedValue(true);
    (redisConnection.ping as any).mockResolvedValue('PONG');
    (redisConnection as any).status = 'ready';
  });

  const createMockFetch = (
    overrides: {
      healthStatus?: number;
      healthBody?: any;
      healthThrow?: boolean;
      registerStatus?: number;
      registerBody?: any;
      registerThrow?: boolean;
      meStatus?: number;
      meBody?: any;
      catalogStatus?: number;
      catalogBody?: any;
    } = {}
  ) => {
    return async (url: any, init?: any) => {
      const urlStr = String(url);

      if (urlStr.includes('/health')) {
        if (overrides.healthThrow) throw new Error('Health connection refused (ECONNREFUSED)');
        return {
          status: overrides.healthStatus ?? 200,
          statusText: overrides.healthStatus === 500 ? 'Internal Server Error' : 'OK',
          json: async () =>
            overrides.healthBody ?? {
              status: 'healthy',
              checks: { mongodb: 'connected', redis: 'connected', s3: 'accessible' },
            },
          text: async () => JSON.stringify(overrides.healthBody || {}),
        } as any;
      }

      if (urlStr.includes('/api/auth/register')) {
        if (overrides.registerThrow) throw new Error('Registration network failure');
        const reqBody = JSON.parse(init?.body || '{}');
        return {
          status: overrides.registerStatus ?? 201,
          statusText: overrides.registerStatus === 400 ? 'Bad Request' : 'Created',
          json: async () =>
            overrides.registerBody ?? {
              success: true,
              data: {
                token: 'mock-valid-jwt-token-xyz',
                user: { id: 'u_test_1', email: reqBody.email },
              },
            },
          text: async () => JSON.stringify(overrides.registerBody || {}),
        } as any;
      }

      if (urlStr.includes('/api/auth/me')) {
        return {
          status: overrides.meStatus ?? 200,
          statusText: overrides.meStatus === 401 ? 'Unauthorized' : 'OK',
          json: async () =>
            overrides.meBody ?? {
              success: true,
              data: {
                user: { id: 'u_test_1', email: 'smoke_user' },
              },
            },
          text: async () => JSON.stringify(overrides.meBody || {}),
        } as any;
      }

      if (urlStr.includes('/api/catalog')) {
        return {
          status: overrides.catalogStatus ?? 200,
          statusText: overrides.catalogStatus === 500 ? 'Internal Error' : 'OK',
          json: async () =>
            overrides.catalogBody ?? {
              success: true,
              data: {
                templates: [{ id: 'cinematic' }, { id: 'minimalist' }],
                music: [{ id: 'upbeat_lofi' }],
                luts: [{ id: 'teal_orange' }],
                fonts: ['Montserrat', 'Inter', 'Roboto'],
              },
            },
          text: async () => JSON.stringify(overrides.catalogBody || {}),
        } as any;
      }

      return {
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not Found' }),
        text: async () => 'Not Found',
      } as any;
    };
  };

  it('reports ALL PASSED (5/5) when all endpoints and infra checks respond successfully', async () => {
    const fetchFn = createMockFetch();
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(true);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.results.every((r) => r.status === 'PASSED')).toBe(true);
  });

  it('fails the suite when the health endpoint returns non-200 HTTP status', async () => {
    const fetchFn = createMockFetch({ healthStatus: 503, healthBody: { status: 'unhealthy' } });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    expect(summary.failed).toBeGreaterThanOrEqual(1);

    const healthCheck = summary.results.find((r) => r.name.includes('/health'));
    expect(healthCheck?.status).toBe('FAILED');
    expect(healthCheck?.message).toContain('non-200');
  });

  it('fails the suite when health returns 200 but degraded/unhealthy status body', async () => {
    const fetchFn = createMockFetch({ healthStatus: 200, healthBody: { status: 'degraded' } });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const healthCheck = summary.results.find((r) => r.name.includes('/health'));
    expect(healthCheck?.status).toBe('FAILED');
    expect(healthCheck?.message).toContain('non-healthy');
  });

  it('fails the suite when user registration fails with HTTP 400', async () => {
    const fetchFn = createMockFetch({
      registerStatus: 400,
      registerBody: { success: false, error: 'INVALID_EMAIL' },
    });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const authCheck = summary.results.find((r) => r.name.includes('Auth Validation'));
    expect(authCheck?.status).toBe('FAILED');
    expect(authCheck?.message).toContain('Registration failed with HTTP 400');
  });

  it('fails the suite when user registration returns 201 but lacks a valid JWT token', async () => {
    const fetchFn = createMockFetch({
      registerStatus: 201,
      registerBody: { success: true, data: { user: { id: 'u_1' } } }, // missing token
    });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const authCheck = summary.results.find((r) => r.name.includes('Auth Validation'));
    expect(authCheck?.status).toBe('FAILED');
    expect(authCheck?.message).toContain('did not return a valid JWT token');
  });

  it('fails the suite when profile verification /me returns 401 Unauthorized', async () => {
    const fetchFn = createMockFetch({ meStatus: 401 });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const authCheck = summary.results.find((r) => r.name.includes('Auth Validation'));
    expect(authCheck?.status).toBe('FAILED');
    expect(authCheck?.message).toContain('Token validation at /api/auth/me failed with HTTP 401');
  });

  it('fails the suite when catalog endpoint returns HTTP 500', async () => {
    const fetchFn = createMockFetch({ catalogStatus: 500 });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const catalogCheck = summary.results.find((r) => r.name.includes('/api/catalog'));
    expect(catalogCheck?.status).toBe('FAILED');
    expect(catalogCheck?.message).toContain('Catalog endpoint returned HTTP 500');
  });

  it('fails the suite when catalog endpoint returns malformed payload without data arrays', async () => {
    const fetchFn = createMockFetch({
      catalogBody: { success: true, data: {} }, // Missing templates, music, luts arrays
    });
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const catalogCheck = summary.results.find((r) => r.name.includes('/api/catalog'));
    expect(catalogCheck?.status).toBe('FAILED');
    expect(catalogCheck?.message).toContain('Catalog returned malformed data');
  });

  it('fails the suite when S3 bucket HeadBucket probe fails', async () => {
    (S3Service.checkHealth as any).mockResolvedValue(false);

    const fetchFn = createMockFetch();
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const s3Check = summary.results.find((r) => r.name.includes('S3 Bucket'));
    expect(s3Check?.status).toBe('FAILED');
    expect(s3Check?.message).toContain('inaccessible or HeadBucket returned false');
  });

  it('fails the suite when Redis queue ping throws or times out', async () => {
    (redisConnection.ping as any).mockRejectedValue(
      new Error('Connection to Redis refused on port 6379')
    );

    const fetchFn = createMockFetch();
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
    });

    expect(summary.success).toBe(false);
    const queueCheck = summary.results.find((r) => r.name.includes('BullMQ Worker Queues'));
    expect(queueCheck?.status).toBe('FAILED');
    expect(queueCheck?.message).toContain('Connection to Redis refused');
  });

  it('marks infra checks as SKIPPED (not false PASSED) when skipInfraChecks is enabled', async () => {
    const fetchFn = createMockFetch();
    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: fetchFn as any,
      skipInfraChecks: true,
    });

    expect(summary.success).toBe(true);
    expect(summary.passed).toBe(3);
    expect(summary.skipped).toBe(2);
    expect(summary.failed).toBe(0);

    const s3Check = summary.results.find((r) => r.name.includes('S3 Bucket'));
    expect(s3Check?.status).toBe('SKIPPED');

    const queueCheck = summary.results.find((r) => r.name.includes('BullMQ Worker Queues'));
    expect(queueCheck?.status).toBe('SKIPPED');

    expect(S3Service.checkHealth).not.toHaveBeenCalled();
    expect(redisConnection.ping).not.toHaveBeenCalled();
  });

  it('catches complete network failure and reports ZERO false passes', async () => {
    // Completely dead target server: fetch always throws
    const deadFetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4000');
    };

    const summary = await ProductionSmokeTestSuite.runAll({
      apiBaseUrl: 'http://localhost:4000',
      fetchFn: deadFetch as any,
      skipInfraChecks: true,
    });

    expect(summary.success).toBe(false);
    expect(summary.failed).toBe(3); // Health, Auth, Catalog all fail
    expect(summary.passed).toBe(0); // ZERO false passes

    for (const check of summary.results) {
      if (
        check.name.includes('/health') ||
        check.name.includes('Auth') ||
        check.name.includes('Catalog')
      ) {
        expect(check.status).toBe('FAILED');
      }
    }
  });
});
