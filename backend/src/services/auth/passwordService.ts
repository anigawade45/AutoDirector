import crypto from 'crypto';

export class PasswordService {
  /**
   * Hashes a password using crypto.scryptSync with a unique 16-byte cryptographic salt.
   */
  static hashPassword(password: string): { salt: string; hash: string } {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  }

  /**
   * Verifies a password against the stored salt and hash using timingSafeEqual to prevent timing attacks.
   */
  static verifyPassword(password: string, salt: string, storedHash: string): boolean {
    try {
      const derivedHash = crypto.scryptSync(password, salt, 64).toString('hex');
      const storedBuf = Buffer.from(storedHash, 'hex');
      const derivedBuf = Buffer.from(derivedHash, 'hex');

      if (storedBuf.length !== derivedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(storedBuf, derivedBuf);
    } catch {
      return false;
    }
  }
}
