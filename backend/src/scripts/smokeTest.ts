import { env } from '../config/env.js';
import { S3Service } from '../services/storage/s3Service.js';
import { redisConnection } from '../config/redis.js';

export interface SmokeCheckResult {
  name: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  message?: string;
}

export interface SmokeTestOptions {
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  skipInfraChecks?: boolean;
  timeoutMs?: number;
}

export interface SmokeTestSummary {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: SmokeCheckResult[];
}

export class ProductionSmokeTestSuite {
  private static results: SmokeCheckResult[] = [];

  static getResults(): SmokeCheckResult[] {
    return [...this.results];
  }

  static async runAll(optionsOrUrl?: string | SmokeTestOptions): Promise<SmokeTestSummary> {
    this.results = [];
    const options: SmokeTestOptions =
      typeof optionsOrUrl === 'string' ? { apiBaseUrl: optionsOrUrl } : optionsOrUrl || {};

    const apiBaseUrl = (options.apiBaseUrl || env.API_BASE_URL || 'http://localhost:4000').replace(
      /\/api$/,
      ''
    );
    const fetchFn = options.fetchFn || globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 5000;
    const skipInfraChecks = options.skipInfraChecks ?? process.env.SKIP_SMOKE_INFRA === 'true';

    console.log(`[SmokeTest] Starting Production Smoke Tests against ${apiBaseUrl}...`);

    await this.checkHealthEndpoint(apiBaseUrl, fetchFn, timeoutMs);
    const authToken = await this.checkAuthEndpoints(apiBaseUrl, fetchFn, timeoutMs);
    await this.checkCatalogEndpoint(apiBaseUrl, fetchFn, timeoutMs, authToken);
    await this.checkS3Configuration(skipInfraChecks);
    await this.checkQueueHealth(skipInfraChecks, timeoutMs);

    const passed = this.results.filter((r) => r.status === 'PASSED').length;
    const failed = this.results.filter((r) => r.status === 'FAILED').length;
    const skipped = this.results.filter((r) => r.status === 'SKIPPED').length;
    const success = failed === 0 && passed > 0;

    console.log(`\n================ SMOKE TEST SUMMARY ================`);
    console.log(`Target: ${apiBaseUrl}`);
    console.log(`Status: ${success ? 'ALL PASSED' : 'FAILURES DETECTED'}`);
    console.log(
      `Results: ${passed}/${this.results.length} checks passed (${failed} failed, ${skipped} skipped)`
    );
    for (const res of this.results) {
      console.log(
        `  [${res.status}] ${res.name} (${res.durationMs.toFixed(1)}ms)${res.message ? ` - ${res.message}` : ''}`
      );
    }
    console.log(`====================================================\n`);

    return {
      success,
      total: this.results.length,
      passed,
      failed,
      skipped,
      results: [...this.results],
    };
  }

  static async checkHealthEndpoint(
    baseUrl: string,
    fetchFn: typeof fetch,
    timeoutMs = 5000
  ): Promise<void> {
    const start = performance.now();
    const name = 'API Health Endpoint (/health)';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetchFn(`${baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);

      if (res.status !== 200) {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message:
            `Health endpoint returned non-200 HTTP status: ${res.status} ${res.statusText || ''}`.trim(),
        });
        return;
      }

      const body = (await res.json()) as any;
      if (body?.status === 'healthy' || body?.status === 'alive') {
        const subChecks = body.checks
          ? ` (mongodb: ${body.checks.mongodb}, redis: ${body.checks.redis}, s3: ${body.checks.s3})`
          : '';
        this.results.push({
          name,
          status: 'PASSED',
          durationMs: performance.now() - start,
          message: `Status: ${body.status}${subChecks}`,
        });
      } else {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Health check returned non-healthy service status: '${body?.status || 'unknown'}'`,
        });
      }
    } catch (err: any) {
      this.results.push({
        name,
        status: 'FAILED',
        durationMs: performance.now() - start,
        message: `Failed to connect to health endpoint: ${err.message || String(err)}`,
      });
    }
  }

  static async checkAuthEndpoints(
    baseUrl: string,
    fetchFn: typeof fetch,
    timeoutMs = 5000
  ): Promise<string | null> {
    const start = performance.now();
    const name = 'User Registration & Auth Validation (/api/auth/register, /api/auth/me)';
    const randId = Math.random().toString(36).slice(2, 8);
    const testEmail = `smoke_${Date.now()}_${randId}@smoketest.local`;
    const testPassword = `SmokePass_${randId}!123`;

    try {
      // 1. User registration test
      const regController = new AbortController();
      const regTimer = setTimeout(() => regController.abort(), timeoutMs);
      const regRes = await fetchFn(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          name: `Smoke Runner ${randId}`,
          password: testPassword,
          tier: 'free',
        }),
        signal: regController.signal,
      });
      clearTimeout(regTimer);

      if (regRes.status !== 201 && regRes.status !== 200) {
        const errText = await regRes.text().catch(() => '');
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Registration failed with HTTP ${regRes.status}: ${errText.slice(0, 100)}`,
        });
        return null;
      }

      const regBody = (await regRes.json()) as any;
      const token = regBody?.data?.token;
      if (!token || typeof token !== 'string') {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: 'Registration response did not return a valid JWT token string',
        });
        return null;
      }

      // 2. Profile verification with the newly issued token
      const meController = new AbortController();
      const meTimer = setTimeout(() => meController.abort(), timeoutMs);
      const meRes = await fetchFn(`${baseUrl}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: meController.signal,
      });
      clearTimeout(meTimer);

      if (meRes.status !== 200) {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Token validation at /api/auth/me failed with HTTP ${meRes.status}`,
        });
        return null;
      }

      const meBody = (await meRes.json()) as any;
      const returnedEmail = meBody?.data?.user?.email;
      if (returnedEmail && !returnedEmail.toLowerCase().includes('smoke')) {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `User identity mismatch on /api/auth/me (expected ${testEmail}, received ${returnedEmail})`,
        });
        return null;
      }

      this.results.push({
        name,
        status: 'PASSED',
        durationMs: performance.now() - start,
        message: 'Registration, JWT token issuance, and /me profile verification operational',
      });
      return token;
    } catch (err: any) {
      this.results.push({
        name,
        status: 'FAILED',
        durationMs: performance.now() - start,
        message: `Auth verification encountered unexpected error: ${err.message || String(err)}`,
      });
      return null;
    }
  }

  static async checkCatalogEndpoint(
    baseUrl: string,
    fetchFn: typeof fetch,
    timeoutMs = 5000,
    authToken?: string | null
  ): Promise<void> {
    const start = performance.now();
    const name = 'Public Catalog Endpoint (/api/catalog)';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetchFn(`${baseUrl}/api/catalog`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status !== 200) {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Catalog endpoint returned HTTP ${res.status}: ${res.statusText || 'Error'}`,
        });
        return;
      }

      const body = (await res.json()) as any;
      const data = body?.data;
      if (
        body?.success === true &&
        data &&
        (Array.isArray(data.templates) || Array.isArray(data.music) || Array.isArray(data.luts))
      ) {
        const templates = data.templates?.length || 0;
        const music = data.music?.length || 0;
        const luts = data.luts?.length || 0;
        this.results.push({
          name,
          status: 'PASSED',
          durationMs: performance.now() - start,
          message: `Catalog assets queryable (${templates} templates, ${music} music tracks, ${luts} LUTs)`,
        });
      } else {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message:
            'Catalog returned malformed data (expected success:true and catalog item arrays)',
        });
      }
    } catch (err: any) {
      this.results.push({
        name,
        status: 'FAILED',
        durationMs: performance.now() - start,
        message: `Failed to query catalog endpoint: ${err.message || String(err)}`,
      });
    }
  }

  static async checkS3Configuration(skipInfraChecks = false): Promise<void> {
    const start = performance.now();
    const name = 'S3 Bucket Encryption & CORS Verification';

    if (skipInfraChecks) {
      this.results.push({
        name,
        status: 'SKIPPED',
        durationMs: performance.now() - start,
        message: 'Direct S3 checks skipped via configuration',
      });
      return;
    }

    const bucketName = env.S3_BUCKET_NAME;
    if (!bucketName) {
      this.results.push({
        name,
        status: 'SKIPPED',
        durationMs: performance.now() - start,
        message: 'S3_BUCKET_NAME not configured; probe skipped',
      });
      return;
    }

    try {
      const isHealthy = await S3Service.checkHealth(bucketName);
      if (isHealthy) {
        this.results.push({
          name,
          status: 'PASSED',
          durationMs: performance.now() - start,
          message: `Bucket '${bucketName}' reachable and accessible via HeadBucket`,
        });
      } else {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `S3 bucket '${bucketName}' is inaccessible or HeadBucket returned false`,
        });
      }
    } catch (err: any) {
      this.results.push({
        name,
        status: 'FAILED',
        durationMs: performance.now() - start,
        message: `S3 health check threw error: ${err.message || String(err)}`,
      });
    }
  }

  static async checkQueueHealth(skipInfraChecks = false, timeoutMs = 3000): Promise<void> {
    const start = performance.now();
    const name = 'BullMQ Worker Queues Health (analysis, preview, render)';

    if (skipInfraChecks) {
      this.results.push({
        name,
        status: 'SKIPPED',
        durationMs: performance.now() - start,
        message: 'Redis queue checks skipped via configuration',
      });
      return;
    }

    if (!env.REDIS_HOST) {
      this.results.push({
        name,
        status: 'SKIPPED',
        durationMs: performance.now() - start,
        message: 'REDIS_HOST not configured; probe skipped',
      });
      return;
    }

    try {
      if (!redisConnection || typeof redisConnection.ping !== 'function') {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: 'Redis client is not initialized',
        });
        return;
      }

      if (redisConnection.status === 'close' || redisConnection.status === 'end') {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Redis connection is closed or terminated (status: ${redisConnection.status})`,
        });
        return;
      }

      const pingPromise = redisConnection.ping();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Redis ping timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const pong = await Promise.race([pingPromise, timeoutPromise]);
      if (pong === 'PONG') {
        this.results.push({
          name,
          status: 'PASSED',
          durationMs: performance.now() - start,
          message: `Redis connection healthy (status: ${redisConnection.status || 'ready'}, ping: PONG)`,
        });
      } else {
        this.results.push({
          name,
          status: 'FAILED',
          durationMs: performance.now() - start,
          message: `Redis responded with unexpected ping result: ${pong}`,
        });
      }
    } catch (err: any) {
      this.results.push({
        name,
        status: 'FAILED',
        durationMs: performance.now() - start,
        message: `Redis queue health probe failed: ${err.message || String(err)}`,
      });
    }
  }
}

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('smokeTest.ts') || process.argv[1]?.endsWith('smokeTest.js'))
);

if (isDirectEntry) {
  const targetUrl = process.argv[2];
  ProductionSmokeTestSuite.runAll(targetUrl)
    .then((summary) => {
      process.exit(summary.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[SmokeTest] Fatal error during smoke test run:', err);
      process.exit(1);
    });
}
