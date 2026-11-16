import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { redisConnection } from './config/redis.js';
import { S3Service } from './services/storage/s3Service.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes/index.js';

export async function getHealthStatus() {
  const isMongoOk = mongoose.connection.readyState === 1;
  const isRedisOk = redisConnection.status === 'ready' || redisConnection.status === 'connect';
  let isS3Ok = false;
  try {
    isS3Ok = await S3Service.checkHealth();
  } catch {
    isS3Ok = false;
  }

  const isHealthy = isMongoOk && isRedisOk && isS3Ok;
  return {
    isHealthy,
    statusCode: isHealthy ? 200 : 503,
    payload: {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'ai-video-editing-platform-api',
      checks: {
        mongodb: isMongoOk ? 'connected' : 'disconnected',
        redis: isRedisOk ? 'connected' : 'disconnected',
        s3: isS3Ok ? 'accessible' : 'inaccessible',
      },
    },
  };
}

export function createApp() {
  const app = express();

  // Support comma-separated origins or wildcard
  const allowedOrigins =
    !env.CORS_ORIGIN || env.CORS_ORIGIN === '*'
      ? '*'
      : env.CORS_ORIGIN.split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  // Parse JSON payloads with reasonable size limit
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Attach request ID for traceability
  app.use(requestIdMiddleware);

  // Health & Readiness check endpoint
  app.get(['/health', '/health/ready'], async (req, res) => {
    const health = await getHealthStatus();
    res.status(health.statusCode).json(health.payload);
  });

  // Fast Liveness check endpoint
  app.get('/health/live', (req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      service: 'ai-video-editing-platform-api',
    });
  });

  // Mount API routers
  app.use('/api', apiRouter);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
