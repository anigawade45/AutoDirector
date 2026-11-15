import crypto from 'crypto';
import { env } from '../../config/env.js';

export interface JwtPayload {
  sub: string;
  email: string;
  tier: string;
  name?: string;
  iat?: number;
  exp?: number;
}

export class TokenService {
  private static getSecret(): string {
    return env.JWT_SECRET || 'ai-video-studio-jwt-secret-key-2026';
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
}
