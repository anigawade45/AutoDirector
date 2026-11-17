import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/s3.js';
import { S3Service } from '../services/storage/s3Service.js';
import { env, envSchema } from '../config/env.js';

vi.mock('../config/s3.js', () => ({
  s3Client: {
    send: vi.fn(),
  },
  StorageKeys: {
    rawVideo: vi.fn(),
  },
}));

describe('S3 Bucket Hardened CORS Security Suite', () => {
  const originalCorsOrigin = env.CORS_ORIGIN;
  const originalS3AllowedOrigins = env.S3_ALLOWED_ORIGINS;
  const originalNodeEnv = env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (env as any).CORS_ORIGIN = originalCorsOrigin;
    (env as any).S3_ALLOWED_ORIGINS = originalS3AllowedOrigins;
    (env as any).NODE_ENV = originalNodeEnv;
  });

  describe('S3Service.resolveAllowedOrigins', () => {
    it('prioritizes explicit customOrigins argument when provided in non-prod', () => {
      const custom = ['https://custom-studio.ai', 'https://editor.custom.com'];
      const resolved = S3Service.resolveAllowedOrigins(custom);
      expect(resolved).toEqual(custom);
    });

    it('parses comma-separated origins from S3_ALLOWED_ORIGINS', () => {
      (env as any).S3_ALLOWED_ORIGINS = 'https://app.example.com, https://preview.example.com';
      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['https://app.example.com', 'https://preview.example.com']);
    });

    it('parses comma-separated origins from CORS_ORIGIN when not wildcard', () => {
      (env as any).S3_ALLOWED_ORIGINS = '';
      (env as any).CORS_ORIGIN = 'https://app1.studio.ai,https://app2.studio.ai';
      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['https://app1.studio.ai', 'https://app2.studio.ai']);
    });

    it('restricts wildcard to trusted origins in production environment by default (SEC-008)', () => {
      (env as any).S3_ALLOWED_ORIGINS = '';
      (env as any).CORS_ORIGIN = '*';
      (env as any).NODE_ENV = 'production';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['https://ai-video-frontend-57bk.onrender.com']);
      expect(resolved).not.toContain('http://localhost:5173');
      expect(resolved).not.toContain('*');
    });

    it('strips wildcard * and insecure HTTP origins from customOrigins in production (SEC-008)', () => {
      (env as any).NODE_ENV = 'production';

      const custom = ['*', 'https://custom-studio.ai', 'http://insecure-domain.com'];
      const resolved = S3Service.resolveAllowedOrigins(custom);
      expect(resolved).toEqual(['https://custom-studio.ai']);
      expect(resolved).not.toContain('*');
      expect(resolved).not.toContain('http://insecure-domain.com');
    });

    it('strips wildcard * from S3_ALLOWED_ORIGINS in production (SEC-008)', () => {
      (env as any).NODE_ENV = 'production';
      (env as any).S3_ALLOWED_ORIGINS = '*, https://app.studio.ai, http://untrusted.com';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['https://app.studio.ai']);
    });

    it('falls back strictly to production domain when all provided origins are wildcard or insecure in prod (SEC-008)', () => {
      (env as any).NODE_ENV = 'production';
      (env as any).S3_ALLOWED_ORIGINS = '*, http://localhost:5173, http://test.com';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['https://ai-video-frontend-57bk.onrender.com']);
    });

    it('allows wildcard in development environment when CORS_ORIGIN is *', () => {
      (env as any).S3_ALLOWED_ORIGINS = '';
      (env as any).CORS_ORIGIN = '*';
      (env as any).NODE_ENV = 'development';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['*']);
    });
  });

  describe('Startup S3_ALLOWED_ORIGINS Validation in envSchema (SEC-008)', () => {
    const baseValidProdEnv = {
      PORT: '4000',
      NODE_ENV: 'production' as const,
      API_BASE_URL: 'https://api.studio.ai/api',
      CORS_ORIGIN: 'https://studio.ai',
      JWT_SECRET: 'super-secure-production-jwt-secret-key-12345',
      INTERNAL_WORKER_SECRET: 'super-secure-worker-secret-key-12345',
      MONGODB_URI: 'mongodb://localhost:27017/prod',
      AWS_ACCESS_KEY_ID: 'AKIA_PROD_12345',
      AWS_SECRET_ACCESS_KEY: 'secret_key_prod_12345',
      S3_BUCKET_NAME: 'prod-bucket',
    };

    it('rejects wildcard S3_ALLOWED_ORIGINS in production mode', () => {
      const result = envSchema.safeParse({
        ...baseValidProdEnv,
        S3_ALLOWED_ORIGINS: '*',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('S3_ALLOWED_ORIGINS'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain(
          'Wildcard S3_ALLOWED_ORIGINS ("*") is prohibited in production'
        );
      }
    });

    it('rejects non-HTTPS S3_ALLOWED_ORIGINS in production mode', () => {
      const result = envSchema.safeParse({
        ...baseValidProdEnv,
        S3_ALLOWED_ORIGINS: 'http://insecure.studio.ai',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('S3_ALLOWED_ORIGINS'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('must use HTTPS protocol in production');
      }
    });

    it('accepts valid HTTPS S3_ALLOWED_ORIGINS in production mode', () => {
      const result = envSchema.safeParse({
        ...baseValidProdEnv,
        S3_ALLOWED_ORIGINS: 'https://app.studio.ai, https://editor.studio.ai',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('S3Service.configureBucketCors', () => {
    it('configures least-privilege CORS rules rejecting DELETE and POST methods', async () => {
      (s3Client.send as any).mockResolvedValueOnce({});

      const success = await S3Service.configureBucketCors('test-secure-bucket', [
        'https://app.studio.ai',
      ]);

      expect(success).toBe(true);
      expect(s3Client.send).toHaveBeenCalledTimes(1);

      const commandArg = (s3Client.send as any).mock.calls[0][0];
      expect(commandArg).toBeInstanceOf(PutBucketCorsCommand);

      const rules = commandArg.input.CORSConfiguration.CORSRules;
      expect(rules).toHaveLength(1);

      const rule = rules[0];
      // AllowedMethods MUST strictly be GET, PUT, HEAD
      expect(rule.AllowedMethods).toEqual(['GET', 'PUT', 'HEAD']);
      expect(rule.AllowedMethods).not.toContain('POST');
      expect(rule.AllowedMethods).not.toContain('DELETE');

      // AllowedOrigins must match resolved origins
      expect(rule.AllowedOrigins).toEqual(['https://app.studio.ai']);

      // AllowedHeaders must whitelist essential browser multipart upload headers
      expect(rule.AllowedHeaders).toContain('Content-Type');
      expect(rule.AllowedHeaders).toContain('Content-MD5');
      expect(rule.AllowedHeaders).toContain('Range');
      expect(rule.AllowedHeaders).toContain('x-amz-*');
      expect(rule.AllowedHeaders).not.toEqual(['*']);

      // ExposeHeaders must include ETag and media streaming ranges
      expect(rule.ExposeHeaders).toContain('ETag');
      expect(rule.ExposeHeaders).toContain('x-amz-request-id');
      expect(rule.ExposeHeaders).toContain('Accept-Ranges');
      expect(rule.ExposeHeaders).toContain('Content-Range');
    });

    it('handles S3 errors gracefully and returns false without throwing', async () => {
      (s3Client.send as any).mockRejectedValueOnce(new Error('S3 Access Denied: PutBucketCors'));

      const success = await S3Service.configureBucketCors('test-secure-bucket');
      expect(success).toBe(false);
    });
  });
});
