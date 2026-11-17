import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';
import { redisConnection } from '../config/redis.js';

// Local in-memory sliding TTL map for test environments or temporary Redis disconnects
const inMemoryFallbackMap = new Map<string, number>();
const REPLAY_TTL_SECONDS = 600; // 10 minutes (clock skew is max 5 minutes)

function cleanExpiredInMemoryEntries(): void {
  const now = Date.now();
  for (const [id, expiresAt] of inMemoryFallbackMap.entries()) {
    if (expiresAt <= now) {
      inMemoryFallbackMap.delete(id);
    }
  }
}

/**
 * Resets local in-memory replay cache (primarily for automated test suite isolation).
 */
export function resetWorkerAuthReplayCache(): void {
  inMemoryFallbackMap.clear();
}

/**
 * Atomically marks an event as processed in Redis with a 10-minute TTL.
 * Returns true if the event was already processed (replay detected), or false if new.
 */
async function checkAndMarkProcessed(eventId: string): Promise<boolean> {
  const redisKey = `worker:event:${eventId}`;
  const isProd = env.NODE_ENV === 'production';

  try {
    const isMock =
      typeof (redisConnection as any)?.set?._isMockFunction === 'boolean' ||
      typeof (redisConnection as any)?.set?.mock === 'object';
    const isReady =
      redisConnection &&
      (redisConnection.status === 'ready' || redisConnection.status === 'connect');

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

    if (isProd) {
      console.error(
        `[WorkerAuth] CRITICAL: Redis unavailable in production (status: ${redisConnection?.status || 'uninitialized'}). Distributed replay protection degraded.`
      );
    }
  } catch (err: any) {
    if (isProd) {
      console.error(
        `[WorkerAuth] CRITICAL: Redis error during replay check in production: ${err?.message}`
      );
    } else {
      console.warn(
        '[WorkerAuth] Redis replay check error, falling back to local cache:',
        err?.message
      );
    }
  }

  // Graceful fallback to local sliding TTL Map when Redis is not ready/mocked
  cleanExpiredInMemoryEntries();
  const now = Date.now();
  const expiresAt = inMemoryFallbackMap.get(eventId);

  if (expiresAt && expiresAt > now) {
    return true; // Replay detected
  }

  inMemoryFallbackMap.set(eventId, now + REPLAY_TTL_SECONDS * 1000);
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

/**
 * Helper to determine if an IP address belongs to loopback, link-local,
 * or private RFC 1918 / RFC 4193 subnets.
 */
export function isPrivateOrLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;

  let cleanIp = ip.trim();

  // Strip brackets from IPv6 host if formatted as [::1]:port
  const bracketMatch = cleanIp.match(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/);
  if (bracketMatch) {
    cleanIp = bracketMatch[1];
  }

  // Strip IPv4-mapped IPv6 prefix: ::ffff:127.0.0.1 -> 127.0.0.1
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  // Strip port from IPv4 address if present (e.g. 127.0.0.1:4000)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(cleanIp)) {
    cleanIp = cleanIp.split(':')[0];
  }

  // Loopback check
  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp.startsWith('127.')
  ) {
    return true;
  }

  // RFC 1918 Private IPv4: 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) {
    return true;
  }

  // RFC 1918 Private IPv4: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  const match172 = cleanIp.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const octet2 = parseInt(match172[1], 10);
    if (octet2 >= 16 && octet2 <= 31) {
      return true;
    }
  }

  // RFC 1918 Private IPv4: 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) {
    return true;
  }

  // RFC 3927 Link-local IPv4: 169.254.0.0/16
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) {
    return true;
  }

  // RFC 4193 Unique Local IPv6 (fc00::/7 -> fc00.. to fdff..)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp)) {
    return true;
  }

  // RFC 4291 Link-Local IPv6 (fe80::/10)
  if (/^fe[89ab][0-9a-f]{1}:/i.test(cleanIp)) {
    return true;
  }

  return false;
}

/**
 * Network boundary restriction middleware (SEC-002).
 * Prohibits direct access to internal endpoints from external networks or public reverse proxies.
 * Enforces that callers originate strictly from private subnets (RFC 1918 / RFC 4193) or loopback interfaces.
 */
export function restrictInternalNetwork(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const socketIp = (req.socket?.remoteAddress || req.ip || '').trim();
  const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;

  // Verify direct connecting socket IP
  if (!isPrivateOrLoopbackIp(socketIp)) {
    return next(
      new AppError(
        403,
        'FORBIDDEN_NETWORK_ACCESS',
        'Direct access to internal endpoints from external networks is prohibited'
      )
    );
  }

  // If X-Forwarded-For is present, every IP in the forwarding chain must also belong to private/internal subnets
  if (forwardedFor) {
    const forwardedIps = forwardedFor.split(',').map((part) => part.trim());
    for (const ip of forwardedIps) {
      if (ip && !isPrivateOrLoopbackIp(ip)) {
        return next(
          new AppError(
            403,
            'FORBIDDEN_NETWORK_ACCESS',
            'Direct access to internal endpoints through public ingress proxies is prohibited'
          )
        );
      }
    }
  }

  next();
}
