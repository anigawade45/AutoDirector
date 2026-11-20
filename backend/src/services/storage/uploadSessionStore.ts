import { redisConnection } from '../../config/redis.js';

export interface UploadSessionRecord {
  userId: string;
  projectId: string;
  assetId: string;
  rawKey: string;
  sizeBytes: number;
  contentType: string;
  totalParts: number;
  partSizeBytes?: number;
  checksumSha256?: string;
  createdAt: string;
  uploadedParts?: Array<{ partNumber: number; etag: string; sizeBytes?: number }>;
}

export const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Fallback cache if Redis is initializing or mocked in test environments
const inMemoryFallback = new Map<string, UploadSessionRecord>();
const inMemoryProjectFallback = new Map<string, string>();

export class UploadSessionStore {
  private static getKey(uploadId: string): string {
    return `upload_session:${uploadId}`;
  }

  private static getProjectKey(projectId: string): string {
    return `project_upload_session:${projectId}`;
  }

  /**
   * Persists the upload session with a 24-hour expiration TTL.
   */
  static async saveSession(uploadId: string, data: UploadSessionRecord): Promise<void> {
    inMemoryFallback.set(uploadId, data);
    if (data.projectId) {
      inMemoryProjectFallback.set(data.projectId, uploadId);
    }
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getKey(uploadId);
        await redisConnection.setex(key, UPLOAD_SESSION_TTL_SECONDS, JSON.stringify(data));
        if (data.projectId) {
          await redisConnection.setex(
            this.getProjectKey(data.projectId),
            UPLOAD_SESSION_TTL_SECONDS,
            uploadId
          );
        }
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
   * Records a successfully uploaded part in the session record for quick resumability tracking.
   */
  static async recordPart(
    uploadId: string,
    partNumber: number,
    etag: string,
    sizeBytes?: number
  ): Promise<void> {
    const session = await this.getSession(uploadId);
    if (session) {
      if (!session.uploadedParts) {
        session.uploadedParts = [];
      }
      const existingIdx = session.uploadedParts.findIndex((p) => p.partNumber === partNumber);
      if (existingIdx !== -1) {
        session.uploadedParts[existingIdx] = { partNumber, etag, sizeBytes };
      } else {
        session.uploadedParts.push({ partNumber, etag, sizeBytes });
        session.uploadedParts.sort((a, b) => a.partNumber - b.partNumber);
      }
      await this.saveSession(uploadId, session);
    }
  }

  /**
   * Finds active upload session ID by projectId.
   */
  static async getActiveUploadByProject(projectId: string): Promise<string | null> {
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getProjectKey(projectId);
        const uploadId = await redisConnection.get(key);
        if (uploadId) return uploadId;
      } catch (err: any) {
        console.warn('[UploadSessionStore] Redis get notice for project session:', err.message);
      }
    }
    return inMemoryProjectFallback.get(projectId) || null;
  }

  /**
   * Deletes the session upon successful completion or abort.
   */
  static async deleteSession(uploadId: string): Promise<void> {
    const session = inMemoryFallback.get(uploadId);
    if (session?.projectId) {
      inMemoryProjectFallback.delete(session.projectId);
    }
    inMemoryFallback.delete(uploadId);
    if (redisConnection.status === 'ready') {
      try {
        const key = this.getKey(uploadId);
        await redisConnection.del(key);
        if (session?.projectId) {
          await redisConnection.del(this.getProjectKey(session.projectId));
        }
      } catch (err: any) {
        console.warn('[UploadSessionStore] Redis del notice:', err.message);
      }
    }
  }
}
