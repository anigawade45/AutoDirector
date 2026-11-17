import crypto from 'crypto';
import { env } from '../../config/env.js';
import { redisConnection } from '../../config/redis.js';

export interface JwtPayload {
  sub: string;
  email: string;
  tier: string;
  name?: string;
  iat?: number;
  exp?: number;
}

export interface SseTicketPayload {
  userId: string;
  jobId?: string;
  createdAt: number;
}

export class TokenService {
  /**
   * Checks whether a non-empty JWT_SECRET is present in the configuration.
   */
  static hasConfiguredSecret(): boolean {
    const secret = env.JWT_SECRET;
    return typeof secret === 'string' && secret.trim().length > 0;
  }

  private static getSecret(): string {
    const secret = env.JWT_SECRET;
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      throw new Error(
        'JWT_SECRET configuration is missing or empty. Refusing to sign or verify tokens with insecure fallback secret.'
      );
    }
    if (env.NODE_ENV === 'production') {
      const lower = secret.toLowerCase();
      if (
        secret.length < 32 ||
        lower.includes('secret-key') ||
        lower.includes('ai-video-studio-jwt-secret-key-2026') ||
        lower.includes('change_me') ||
        lower.includes('__inject_') ||
        lower.includes('password') ||
        lower.includes('admin') ||
        lower === '123456'
      ) {
        throw new Error(
          'JWT_SECRET is insecure for production. Must be at least 32 characters and cannot use default placeholders.'
        );
      }
    }
    return secret;
  }

  private static base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private static base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  /**
   * Generates a signed RFC 7519 JWT token (HS256)
   */
  static generateToken(
    payload: { id: string; email: string; tier: string; name?: string },
    expiresInSec = 7 * 86400
  ): string {
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      sub: payload.id,
      email: payload.email,
      tier: payload.tier,
      name: payload.name,
      iat: now,
      exp: now + expiresInSec,
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));

    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verifies an incoming JWT token and returns its payload if valid, or null if expired/tampered
   */
  static verifyToken(token: string): JwtPayload | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.getSecret())
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const sigBuf = Buffer.from(signature);
      const expectedSigBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expectedSigBuf.length) {
        return null;
      }

      if (!crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
        return null;
      }

      const payload: JwtPayload = JSON.parse(this.base64UrlDecode(encodedPayload));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }

      return payload;
    } catch {
      return null;
    }
  }

  // In-memory fallback for SSE tickets when Redis is unavailable or in offline testing
  private static localTicketStore = new Map<
    string,
    { payload: SseTicketPayload; expiresAt: number }
  >();

  /**
   * Generates an ephemeral single-use SSE ticket (valid for 30 seconds by default)
   * stored in Redis with atomic consumption semantics.
   */
  static async createSseTicket(
    payload: { userId: string; jobId?: string },
    expiresInSec = 30
  ): Promise<string> {
    const ticketId = `ticket_${crypto.randomBytes(24).toString('hex')}`;
    const ticketData: SseTicketPayload = {
      userId: payload.userId,
      jobId: payload.jobId,
      createdAt: Date.now(),
    };

    if (redisConnection && redisConnection.status === 'ready') {
      try {
        await redisConnection.set(
          `sse:ticket:${ticketId}`,
          JSON.stringify(ticketData),
          'EX',
          expiresInSec,
          'NX'
        );
        return ticketId;
      } catch (err: any) {
        console.warn(
          '[TokenService] Redis set failed for SSE ticket, falling back to local store:',
          err.message
        );
      }
    }

    // In-memory fallback
    this.localTicketStore.set(ticketId, {
      payload: ticketData,
      expiresAt: Date.now() + expiresInSec * 1000,
    });

    // Sweep expired tickets occasionally
    if (this.localTicketStore.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.localTicketStore.entries()) {
        if (v.expiresAt <= now) {
          this.localTicketStore.delete(k);
        }
      }
    }

    return ticketId;
  }

  /**
   * Consumes an ephemeral SSE ticket.
   * Atomic single-use: immediately deletes the ticket so it cannot be reused or replayed.
   */
  static async consumeSseTicket(ticketId: string): Promise<SseTicketPayload | null> {
    if (!ticketId || typeof ticketId !== 'string') return null;

    if (redisConnection && redisConnection.status === 'ready') {
      try {
        const key = `sse:ticket:${ticketId}`;
        const results = await redisConnection.multi().get(key).del(key).exec();
        const raw = results?.[0]?.[1] as string | null;
        if (raw) {
          return JSON.parse(raw) as SseTicketPayload;
        }
        return null;
      } catch (err: any) {
        console.warn(
          '[TokenService] Redis consume failed for SSE ticket, checking local store:',
          err.message
        );
      }
    }

    const localEntry = this.localTicketStore.get(ticketId);
    if (!localEntry) return null;

    // Immediately burn ticket (single use)
    this.localTicketStore.delete(ticketId);

    if (localEntry.expiresAt < Date.now()) {
      return null; // Expired
    }

    return localEntry.payload;
  }

  /**
   * Reset local ticket store (primarily for unit tests)
   */
  static resetLocalTicketStore(): void {
    this.localTicketStore.clear();
  }
}
