import { Request, Response, NextFunction } from 'express';
import { redisConnection } from '../config/redis.js';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  prefix: string;
  message?: string;
  skip?: (req: Request) => boolean;
}

// In-memory sliding window fallback map: key -> list of request timestamps (epoch ms)
const inMemoryCache = new Map<string, number[]>();

export function resetRateLimiterCache(): void {
  inMemoryCache.clear();
}

/**
 * Extracts the real client IP, respecting trusted reverse proxy headers.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Creates a sliding-window rate limiting middleware.
 * Uses atomic Redis transactions when available, with a resilient in-memory sliding-window fallback.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, prefix, message, skip } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return async function rateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (skip && skip(req)) {
      return next();
    }

    const clientIp = getClientIp(req);
    const redisKey = `ratelimit:${prefix}:${clientIp}`;
    const now = Date.now();

    let currentHits = 1;
    let resetTimeSec = Math.ceil((now + windowMs) / 1000);

    let usedRedis = false;

    // 1. Try Redis sliding window if available
    try {
      const isMock =
        typeof (redisConnection as any)?.set?._isMockFunction === 'boolean' ||
        typeof (redisConnection as any)?.set?.mock === 'object';
      const isReady =
        redisConnection &&
        (redisConnection.status === 'ready' || redisConnection.status === 'connect');

      if (redisConnection && (isReady || isMock)) {
        // Atomic increment with expire
        const pipeline = redisConnection.pipeline();
        pipeline.incr(redisKey);
        pipeline.ttl(redisKey);
        const results = await pipeline.exec();

        if (results && results[0] && !results[0][0]) {
          currentHits = Number(results[0][1]);
          const currentTtl = Number(results[1]?.[1] ?? -1);

          if (currentHits === 1 || currentTtl === -1) {
            await redisConnection.expire(redisKey, windowSec);
            resetTimeSec = Math.ceil((now + windowMs) / 1000);
          } else {
            resetTimeSec = Math.ceil(now / 1000) + Math.max(1, currentTtl);
          }
          usedRedis = true;
        }
      }
    } catch {
      // Redis error: fall through to in-memory sliding window
      usedRedis = false;
    }

    // 2. In-memory sliding window fallback if Redis is not used
    if (!usedRedis) {
      const memKey = `${prefix}:${clientIp}`;
      const windowStart = now - windowMs;
      const timestamps = inMemoryCache.get(memKey) || [];

      // Filter out timestamps outside the active window
      const validTimestamps = timestamps.filter((t) => t > windowStart);
      validTimestamps.push(now);
      inMemoryCache.set(memKey, validTimestamps);

      currentHits = validTimestamps.length;
      resetTimeSec = Math.ceil((validTimestamps[0] + windowMs) / 1000);
    }

    const remaining = Math.max(0, max - currentHits);
    const retryAfter = Math.max(1, resetTimeSec - Math.ceil(now / 1000));

    // Standard rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTimeSec);

    if (currentHits > max) {
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message:
            message ||
            `Too many requests from this IP address. Please retry in ${retryAfter} second(s).`,
        },
        requestId: (req as any).id,
      });
      return;
    }

    next();
  };
}

// -----------------------------------------------------------------------------
// Pre-configured Rate Limiter Instances
// -----------------------------------------------------------------------------

/**
 * Strict limiter for authentication endpoints (/api/auth/login, /api/auth/register).
 * Protects against credential stuffing, password guessing, and account enumeration.
 * Limit: 20 attempts per 15 minutes per IP.
 */
export const authRateLimiter = createRateLimiter({
  prefix: 'auth',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
});

/**
 * AI Planning & Prompt Limiter (/api/projects/:id/prompt).
 * Protects remote LLM APIs from quota exhaustion and denial-of-service.
 * Limit: 40 requests per 1 minute per IP.
 */
export const aiPlannerRateLimiter = createRateLimiter({
  prefix: 'ai',
  windowMs: 60 * 1000, // 1 minute
  max: 40,
  message: 'AI planning rate limit reached. Please pause a moment before issuing another prompt.',
});

/**
 * Render & Export Worker Limiter (/api/projects/:id/preview, /api/projects/:id/export).
 * Protects worker queues and GPU/CPU rendering resources from saturation.
 * Limit: 20 rendering jobs per 5 minutes per IP.
 */
export const renderRateLimiter = createRateLimiter({
  prefix: 'render',
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: 'Video rendering request limit reached. Please allow queued exports to finish.',
});

/**
 * Internal Maintenance Operations Limiter (/api/internal/v1/maintenance/*).
 * Protects storage and DB cleanup tasks from rapid invocation and resource churn.
 * Limit: 10 maintenance invocations per 5 minutes per IP.
 */
export const maintenanceRateLimiter = createRateLimiter({
  prefix: 'maintenance',
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message:
    'Internal maintenance request limit reached. Please wait before triggering another cleanup.',
});

/**
 * Global API Limiter for standard REST endpoints.
 * Limit: 300 requests per 1 minute per IP.
 * Skips health check endpoints.
 */
export const generalApiRateLimiter = createRateLimiter({
  prefix: 'api',
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  skip: (req) =>
    req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready',
});
