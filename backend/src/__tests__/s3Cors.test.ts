import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/s3.js';
import { S3Service } from '../services/storage/s3Service.js';
import { env } from '../config/env.js';

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
    it('prioritizes explicit customOrigins argument when provided', () => {
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

    it('restricts wildcard to trusted origins in production environment by default', () => {
      (env as any).S3_ALLOWED_ORIGINS = '';
      (env as any).CORS_ORIGIN = '*';
      (env as any).NODE_ENV = 'production';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toContain('https://ai-video-frontend-57bk.onrender.com');
      expect(resolved).toContain('http://localhost:5173');
      expect(resolved).not.toContain('*');
    });

    it('allows wildcard in development environment when CORS_ORIGIN is *', () => {
      (env as any).S3_ALLOWED_ORIGINS = '';
      (env as any).CORS_ORIGIN = '*';
      (env as any).NODE_ENV = 'development';

      const resolved = S3Service.resolveAllowedOrigins();
      expect(resolved).toEqual(['*']);
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
