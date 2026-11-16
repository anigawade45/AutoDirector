import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';
import { redisConnection } from '../config/redis.js';

// Local in-memory fallback for offline test environments or temporary Redis disconnects
const inMemoryFallbackSet = new Set<string>();
const REPLAY_TTL_SECONDS = 600; // 10 minutes (clock skew is max 5 minutes)

/**
 * Atomically marks an event as processed in Redis with a 10-minute TTL.
 * Returns true if the event was already processed (replay detected), or false if new.
 */
async function checkAndMarkProcessed(eventId: string): Promise<boolean> {
  const redisKey = `worker:event:${eventId}`;

  try {
    const isMock =
      typeof (redisConnection as any)?.set?._isMockFunction === 'boolean' ||
      typeof (redisConnection as any)?.set?.mock === 'object';
    const isReady = redisConnection && redisConnection.status === 'ready';

    if (redisConnection && (isReady || isMock)) {
      // SET key '1' EX 600 NX returns 'OK' if the key was set (new event),
      // or null if the key already exists (duplicate / replay).
      const result = await Promise.race([
        redisConnection.set(redisKey, '1', 'EX', REPLAY_TTL_SECONDS, 'NX'),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Redis timeout')), 2000)
        ),
      ]);
      return result === null;
    }
  } catch (err: any) {
    console.warn('[WorkerAuth] Redis replay check error, falling back to local set:', err?.message);
  }

  // Graceful fallback to local in-memory set when Redis is not ready/mocked
  if (inMemoryFallbackSet.has(eventId)) {
    return true;
  }
  inMemoryFallbackSet.add(eventId);
  if (inMemoryFallbackSet.size > 10000) {
    inMemoryFallbackSet.clear();
  }
  return false;
}

export async function verifyWorkerSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const workerId = req.headers['x-worker-id'] as string;
  const eventId = req.headers['x-event-id'] as string;
  const timestampStr = req.headers['x-event-timestamp'] as string;
  const signatureHeader = req.headers['x-event-signature'] as string;

  if (!workerId || !eventId || !timestampStr || !signatureHeader) {
    return next(
      new AppError(401, 'WORKER_AUTH_MISSING_HEADERS', 'Missing required worker signature headers')
    );
  }

  // 1. Clock skew validation (5 minutes = 300 seconds)
  const timestamp = parseInt(timestampStr, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return next(
      new AppError(
        401,
        'WORKER_AUTH_CLOCK_SKEW',
        'Event timestamp exceeds allowable 5-minute clock skew window'
      )
    );
  }

  // 2. Cryptographic signature verification (verify authenticity BEFORE checking state)
  const rawBody = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', env.INTERNAL_WORKER_SECRET)
    .update(rawBody)
    .digest('hex');

  const providedSignature = signatureHeader.replace(/^sha256=/, '');

  try {
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const providedBuf = Buffer.from(providedSignature, 'hex');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return next(
        new AppError(401, 'WORKER_AUTH_INVALID_SIGNATURE', 'Invalid worker event HMAC signature')
      );
    }
  } catch (err) {
    return next(new AppError(401, 'WORKER_AUTH_SIGNATURE_ERROR', 'Signature comparison error'));
  }

  // 3. Distributed replay protection using Redis SET with TTL & NX
  try {
    const isReplay = await checkAndMarkProcessed(eventId);
    if (isReplay) {
      // Monotonic idempotent delivery: acknowledge duplicate with HTTP 200 without reprocessing
      res.status(200).json({
        success: true,
        data: { accepted: true, duplicate: true },
        requestId: req.id,
      });
      return;
    }

    next();
  } catch (replayErr) {
    next(replayErr);
  }
}

/**
 * Validates either an internal shared secret header or full worker HMAC signature.
 * Protects maintenance endpoints from unauthenticated external access.
 */
export async function verifyInternalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const secretHeader = (req.headers['x-internal-secret'] || req.headers['x-worker-secret']) as
    string | undefined;

  if (secretHeader && env.INTERNAL_WORKER_SECRET) {
    const expectedBuf = Buffer.from(env.INTERNAL_WORKER_SECRET);
    const providedBuf = Buffer.from(secretHeader);
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return next();
    }
    return next(
      new AppError(401, 'INTERNAL_AUTH_INVALID_SECRET', 'Invalid internal worker secret')
    );
  }

  return await verifyWorkerSignature(req, res, next);
}
