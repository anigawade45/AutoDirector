import crypto from 'crypto';

/**
 * Native cryptographic ID generator replacement for nanoid.
 * Uses Node.js crypto.randomBytes to generate URL-safe, collision-resistant identifiers.
 */
export function nanoid(size = 12): string {
  return crypto.randomBytes(size).toString('base64url').slice(0, size);
}
