import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { redisConnection } from './config/redis.js';
import { S3Service } from './services/storage/s3Service.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { securityHeadersMiddleware } from './middleware/securityHeaders.js';
import { generalApiRateLimiter } from './middleware/rateLimiter.js';
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

  // Trust first proxy hop (Nginx reverse proxy, Render / Cloudflare ingress)
  // Ensures req.ip, req.protocol, and rate-limiting headers accurately reflect the client
  app.set('trust proxy', 1);

  // OWASP Security Headers (Clickjacking, MIME sniffing, HSTS, CSP, and tech stack hiding)
  app.use(securityHeadersMiddleware);

  // Resolve allowed origins for CORS (supports comma-separated list and dev fallbacks)
  const configuredOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const isProduction = env.NODE_ENV === 'production';
  const defaultDevOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];

  const allowedOriginsSet = new Set<string>([
    ...configuredOrigins,
    ...(!isProduction ? defaultDevOrigins : []),
  ]);

  const isWildcardConfigured = configuredOrigins.includes('*');

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        // 1. Allow non-browser requests (e.g. mobile apps, curl, server-to-server, health probes)
        if (!requestOrigin) {
          return callback(null, true);
        }

        // 2. Exact match against configured and default development origins
        if (allowedOriginsSet.has(requestOrigin)) {
          return callback(null, true);
        }

        // 3. Handle wildcard origin
        if (isWildcardConfigured) {
          if (isProduction) {
            console.warn(
              `[CORS] Warning: Wildcard CORS origin is configured in production. Rejecting credentialed origin: ${requestOrigin}`
            );
            return callback(
              new Error(`Origin ${requestOrigin} not permitted by production CORS policy`)
            );
          }
          // In development, reflect request origin for testing
          return callback(null, true);
        }

        // 4. In development, allow localhost/127.0.0.1 on any port
        if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) {
          return callback(null, true);
        }

        return callback(new Error(`Origin ${requestOrigin} not permitted by CORS policy`));
      },
      credentials: !isWildcardConfigured || !isProduction,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'X-Worker-Id',
        'X-Event-Id',
        'X-Event-Timestamp',
        'X-Event-Signature',
        'X-Internal-Secret',
        'X-Worker-Secret',
      ],
      exposedHeaders: ['X-Request-Id'],
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

  // Rate Limiting & Mount API routers
  app.use('/api', generalApiRateLimiter);
  app.use('/api', apiRouter);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
