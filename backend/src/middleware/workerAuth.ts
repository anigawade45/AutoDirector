import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

// Set of processed event IDs for replay protection (in production, use Redis with TTL)
const processedEventIds = new Set<string>();

export function verifyWorkerSignature(req: Request, res: Response, next: NextFunction): void {
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

  // 2. Replay check
  if (processedEventIds.has(eventId)) {
    // Monotonic idempotent delivery: return 200 without reprocessing
    res.status(200).json({
      success: true,
      data: { accepted: true, duplicate: true },
      requestId: req.id,
    });
    return;
  }

  // 3. Signature verification
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

    processedEventIds.add(eventId);
    // Cleanup old IDs periodically
    if (processedEventIds.size > 10000) {
      processedEventIds.clear();
    }

    next();
  } catch (err) {
    return next(new AppError(401, 'WORKER_AUTH_SIGNATURE_ERROR', 'Signature comparison error'));
  }
}
