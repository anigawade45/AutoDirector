import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getHealthStatus, createApp } from '../app.js';
import { redisConnection } from '../config/redis.js';
import { S3Service } from '../services/storage/s3Service.js';
import { s3Client } from '../config/s3.js';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { Request, Response } from 'express';

vi.mock('../config/redis.js', () => ({
  redisConnection: {
    status: 'ready',
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
  },
  createRedisConnection: vi.fn(),
}));

vi.mock('../config/s3.js', () => ({
  s3Client: {
    send: vi.fn(),
  },
  StorageKeys: {},
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    checkHealth: vi.fn().mockResolvedValue(true),
    ensureBucketExists: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Health & Startup Degradation Defense Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (S3Service.checkHealth as any).mockResolvedValue(true);
    (redisConnection as any).status = 'ready';
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1); // 1 = connected
  });

  describe('getHealthStatus (Readiness Logic)', () => {
    it('returns 200 OK and healthy status when MongoDB, Redis, and S3 are all operational', async () => {
      const health = await getHealthStatus();

      expect(health.statusCode).toBe(200);
      expect(health.isHealthy).toBe(true);
      expect(health.payload.status).toBe('healthy');
      expect(health.payload.checks).toEqual({
        mongodb: 'connected',
        redis: 'connected',
        s3: 'accessible',
      });
      expect(health.payload.service).toBe('ai-video-editing-platform-api');
      expect(health.payload.timestamp).toBeDefined();
    });

    it('returns 503 Service Unavailable when MongoDB is disconnected', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0); // 0 = disconnected

      const health = await getHealthStatus();

      expect(health.statusCode).toBe(503);
      expect(health.isHealthy).toBe(false);
      expect(health.payload.status).toBe('degraded');
      expect(health.payload.checks.mongodb).toBe('disconnected');
      expect(health.payload.checks.redis).toBe('connected');
      expect(health.payload.checks.s3).toBe('accessible');
    });

    it('returns 503 Service Unavailable when Redis is disconnected', async () => {
      (redisConnection as any).status = 'end';

      const health = await getHealthStatus();

      expect(health.statusCode).toBe(503);
      expect(health.isHealthy).toBe(false);
      expect(health.payload.status).toBe('degraded');
      expect(health.payload.checks.redis).toBe('disconnected');
      expect(health.payload.checks.mongodb).toBe('connected');
    });

    it('returns 503 Service Unavailable when S3 is inaccessible', async () => {
      (S3Service.checkHealth as any).mockResolvedValue(false);

      const health = await getHealthStatus();

      expect(health.statusCode).toBe(503);
      expect(health.isHealthy).toBe(false);
      expect(health.payload.status).toBe('degraded');
      expect(health.payload.checks.s3).toBe('inaccessible');
    });
  });

  describe('Express Health Endpoints Routing', () => {
    it('serves fast liveness probe at /health/live with 200 OK', () => {
      const app = createApp();
      const mockReq = {} as Request;
      let status = 0;
      let body: any = null;

      const mockRes = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      } as unknown as Response;

      // Locate the /health/live handler
      const liveRoute = (app as any)._router.stack.find(
        (layer: any) => layer.route && layer.route.path === '/health/live'
      );
      expect(liveRoute).toBeDefined();

      liveRoute.route.stack[0].handle(mockReq, mockRes);

      expect(status).toBe(200);
      expect(body.status).toBe('alive');
      expect(body.service).toBe('ai-video-editing-platform-api');
    });

    it('serves readiness probe at /health and /health/ready', async () => {
      const app = createApp();
      const mockReq = {} as Request;
      let status = 0;
      let body: any = null;

      const mockRes = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      } as unknown as Response;

      const healthRoute = (app as any)._router.stack.find(
        (layer: any) =>
          layer.route && Array.isArray(layer.route.path) && layer.route.path.includes('/health')
      );
      expect(healthRoute).toBeDefined();

      await healthRoute.route.stack[0].handle(mockReq, mockRes);

      expect(status).toBe(200);
      expect(body.status).toBe('healthy');
    });
  });
});
