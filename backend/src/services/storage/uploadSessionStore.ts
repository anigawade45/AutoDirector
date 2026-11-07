import { redisConnection } from '../../config/redis.js';

export interface UploadSessionRecord {
  userId: string;
  projectId: string;
  assetId: string;
  rawKey: string;
  sizeBytes: number;
  contentType: string;
  totalParts: number;
  checksumSha256?: string;
  createdAt: string;
}

export const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Fallback cache if Redis is initializing or mocked in test environments
const inMemoryFallback = new Map<string, UploadSessionRecord>();

export class UploadSessionStore {
  private static getKey(uploadId: string): string {
    return `upload_session:${uploadId}`;
  }

  /**
   * Persists the upload session with a 24-hour expiration TTL.
   */
  static async saveSession(uploadId: string, data: UploadSessionRecord): Promise<void> {
    inMemoryFallback.set(uploadId, data);
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getKey(uploadId);
        await redisConnection.setex(key, UPLOAD_SESSION_TTL_SECONDS, JSON.stringify(data));
      } catch (err: any) {
        console.warn(
          '[UploadSessionStore] Redis setex notice (using memory fallback):',
          err.message
        );
      }
    }
  }

  /**
   * Retrieves an active upload session by uploadId from Redis or memory fallback.
   */
  static async getSession(uploadId: string): Promise<UploadSessionRecord | null> {
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getKey(uploadId);
        const raw = await redisConnection.get(key);
        if (raw) {
          return JSON.parse(raw) as UploadSessionRecord;
        }
      } catch (err: any) {
        console.warn(
          '[UploadSessionStore] Redis get notice (checking memory fallback):',
          err.message
        );
      }
    }

    return inMemoryFallback.get(uploadId) || null;
  }

  /**
   * Deletes the session upon successful completion or abort.
   */
  static async deleteSession(uploadId: string): Promise<void> {
    inMemoryFallback.delete(uploadId);
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getKey(uploadId);
        await redisConnection.del(key);
      } catch (err: any) {
        console.warn('[UploadSessionStore] Redis del notice:', err.message);
      }
    }
  }
}
