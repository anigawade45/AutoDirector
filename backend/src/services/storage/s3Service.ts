import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, StorageKeys } from '../../config/s3.js';
import { env } from '../../config/env.js';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export const PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MB chunks

export class S3Service {
  /**
   * Automatically ensures the S3 bucket exists and configures CORS for direct browser PUT uploads.
   * Retries up to 5 times to allow local emulators (LocalStack) time to complete initialization.
   */
  static async ensureBucketExists(maxRetries = 5): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET_NAME }));
        console.log(`[S3] Connected to bucket '${env.S3_BUCKET_NAME}'.`);
        await this.configureBucketCors();
        await this.configureBucketEncryption();
        await this.configureBucketLifecycle();
        return;
      } catch (err: any) {
        const isNotFound = err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404;

        if (isNotFound) {
          console.log(`[S3] Bucket '${env.S3_BUCKET_NAME}' does not exist yet. Creating...`);
          try {
            await s3Client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET_NAME }));
            console.log(`[S3] Bucket '${env.S3_BUCKET_NAME}' created successfully.`);
            await this.configureBucketCors();
            await this.configureBucketEncryption();
            await this.configureBucketLifecycle();
            return;
          } catch (createErr: any) {
            console.warn(
              `[S3] Bucket creation error:`,
              createErr.message || createErr.name || createErr
            );
            return;
          }
        }

        // Connection failed or gateway booting
        const innerErrors = err.errors
          ? err.errors.map((e: any) => e.message || e.code).join(', ')
          : '';
        if (attempt < maxRetries) {
          console.log(
            `[S3] Waiting for S3 gateway at ${env.S3_ENDPOINT} (attempt ${attempt}/${maxRetries})...`
          );
          await new Promise((r) => setTimeout(r, 2500));
        } else {
          console.warn(
            `[S3] Could not connect to S3 gateway at ${env.S3_ENDPOINT}: ${err.name} ${innerErrors || err.message}`
          );
        }
      }
    }
  }

  /**
   * Resolves the list of allowed CORS origins for S3 direct browser interactions.
   * Prioritizes explicit customOrigins parameter, then env.S3_ALLOWED_ORIGINS,
   * then env.CORS_ORIGIN, falling back safely to production frontend domains or localhost in dev.
   */
  static resolveAllowedOrigins(customOrigins?: string[]): string[] {
    if (customOrigins && customOrigins.length > 0) {
      return customOrigins;
    }

    if (env.S3_ALLOWED_ORIGINS && env.S3_ALLOWED_ORIGINS.trim()) {
      return env.S3_ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    }

    if (env.CORS_ORIGIN && env.CORS_ORIGIN.trim() && env.CORS_ORIGIN !== '*') {
      return env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    }

    // In production, avoid blanket '*' wildcard unless explicitly overridden
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === '*') {
      return [
        'https://ai-video-frontend-57bk.onrender.com',
        'http://localhost:5173',
        'http://localhost:3000',
      ];
    }

    // In local development / test, allow wildcard if CORS_ORIGIN is '*'
    if (env.CORS_ORIGIN === '*') {
      return ['*'];
    }

    return ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
  }

  /**
   * Configures least-privilege CORS rules on the S3 bucket for browser multipart direct PUT uploads
   * and partial-content range streaming.
   *
   * Security Hardening:
   * 1. AllowedMethods: Restricted strictly to ['GET', 'PUT', 'HEAD']. (DELETE and POST are rejected;
   *    uploads are completed and assets purged solely through authenticated backend API routes).
   * 2. AllowedOrigins: Scoped to configured application origins (rejecting unconstrained wildcard * in prod).
   * 3. AllowedHeaders: Explicitly whitelisted for multipart upload & range queries (Content-Type, Content-MD5, x-amz-*, Range, etc.).
   * 4. ExposeHeaders: Exposes ETag, request IDs, and video range metadata for media playback.
   */
  static async configureBucketCors(
    bucketName: string = env.S3_BUCKET_NAME,
    customOrigins?: string[]
  ): Promise<boolean> {
    try {
      const allowedOrigins = this.resolveAllowedOrigins(customOrigins);

      await s3Client.send(
        new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: allowedOrigins,
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: [
                  'Content-Type',
                  'Content-MD5',
                  'Content-Length',
                  'x-amz-*',
                  'Range',
                  'Authorization',
                  'Origin',
                  'If-Match',
                  'If-None-Match',
                  'If-Modified-Since',
                  'If-Unmodified-Since',
                ],
                ExposeHeaders: [
                  'ETag',
                  'x-amz-request-id',
                  'x-amz-id-2',
                  'Accept-Ranges',
                  'Content-Range',
                  'Content-Length',
                ],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        })
      );
      console.log(
        `[S3] Configured hardened bucket CORS for '${bucketName}' (Origins: [${allowedOrigins.join(', ')}], Methods: [GET, PUT, HEAD]).`
      );
      return true;
    } catch (corsErr: any) {
      console.warn(`[S3] Note on bucket CORS configuration:`, corsErr.message || corsErr);
      return false;
    }
  }

  /**
   * Configures AES256 default server-side encryption with Amazon S3 managed keys (SSE-S3).
   */
  static async configureBucketEncryption(
    bucketName: string = env.S3_BUCKET_NAME
  ): Promise<boolean> {
    try {
      await s3Client.send(
        new PutBucketEncryptionCommand({
          Bucket: bucketName,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'AES256',
                },
                BucketKeyEnabled: true,
              },
            ],
          },
        })
      );
      console.log(
        `[S3] Configured AES256 default server-side encryption for bucket '${bucketName}'.`
      );
      return true;
    } catch (err: any) {
      console.warn(`[S3] Note on bucket encryption configuration:`, err.message || err);
      return false;
    }
  }

  /**
   * Configures S3 Lifecycle rules:
   * 1. Purge abandoned multipart uploads after 1 day (24 hours).
   * 2. Expire proxy previews older than 7 days per Specification §4.7.
   * 3. Expire temporary scratch objects after 1 day.
   */
  static async configureBucketLifecycle(bucketName: string = env.S3_BUCKET_NAME): Promise<boolean> {
    try {
      await s3Client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucketName,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'AbortIncompleteMultipartUploadRule',
                Status: 'Enabled',
                Filter: { Prefix: '' },
                AbortIncompleteMultipartUpload: {
                  DaysAfterInitiation: 1,
                },
              },
              {
                ID: 'ExpireStalePreviewsRule',
                Status: 'Enabled',
                Filter: { Prefix: 'previews/' },
                Expiration: {
                  Days: 7,
                },
              },
              {
                ID: 'ExpireTempScratchRule',
                Status: 'Enabled',
                Filter: { Prefix: 'temp/' },
                Expiration: {
                  Days: 1,
                },
              },
            ],
          },
        })
      );
      console.log(
        `[S3] Configured bucket lifecycle rules (7-day preview expiry, 24h multipart abort) on '${bucketName}'.`
      );
      return true;
    } catch (err: any) {
      console.warn(`[S3] Note on bucket lifecycle configuration:`, err.message || err);
      return false;
    }
  }

  /**
   * Initializes an S3 multipart upload session and produces presigned PUT URLs for each chunk.
   */
  static async createMultipartUpload(
    userId: string,
    projectId: string,
    assetId: string,
    sizeBytes: number,
    contentType: string = 'video/mp4'
  ) {
    const rawKey = StorageKeys.rawVideo(userId, projectId, assetId);

    const createCommand = new CreateMultipartUploadCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: rawKey,
      ContentType: contentType,
    });

    const session = await s3Client.send(createCommand);
    const uploadId = session.UploadId!;

    const totalParts = Math.max(1, Math.ceil(sizeBytes / PART_SIZE_BYTES));
    const parts: Array<{ partNumber: number; url: string; expiresAt: string }> = [];

    // Presigned upload URLs valid for 15 minutes (900 seconds)
    const expiresIn = 900;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const partCommand = new UploadPartCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: rawKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(s3Client, partCommand, { expiresIn });
      parts.push({ partNumber, url, expiresAt });
    }

    return {
      uploadId,
      rawKey,
      partSizeBytes: PART_SIZE_BYTES,
      parts,
      expiresAt,
    };
  }

  /**
   * Completes an S3 multipart upload session after all parts are uploaded.
   */
  static async completeMultipartUpload(
    rawKey: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ) {
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: rawKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      },
    });

    return await s3Client.send(completeCommand);
  }

  /**
   * Aborts an incomplete multipart upload.
   */
  static async abortMultipartUpload(rawKey: string, uploadId: string) {
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: rawKey,
      UploadId: uploadId,
    });
    return await s3Client.send(abortCommand);
  }

  /**
   * Cleans up abandoned multipart uploads older than specified age (default 24h).
   */
  static async cleanupAbandonedUploads(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const listCommand = new ListMultipartUploadsCommand({
        Bucket: env.S3_BUCKET_NAME,
      });
      const response = await s3Client.send(listCommand);
      let abortedCount = 0;
      const cutoffTime = Date.now() - olderThanMs;

      if (response.Uploads && response.Uploads.length > 0) {
        for (const upload of response.Uploads) {
          if (upload.Initiated && upload.Initiated.getTime() < cutoffTime) {
            if (upload.Key && upload.UploadId) {
              await this.abortMultipartUpload(upload.Key, upload.UploadId);
              abortedCount++;
              console.log(
                `[S3] Aborted stale multipart upload: key=${upload.Key}, uploadId=${upload.UploadId}`
              );
            }
          }
        }
      }
      return abortedCount;
    } catch (err: any) {
      console.warn('[S3] Error cleaning up abandoned uploads:', err.message);
      return 0;
    }
  }

  /**
   * Cleans up preview videos older than specified retention (default 7 days) per Specification §4.7.
   * Programmatic sweep for maintenance routines and local/testing environments without S3 Lifecycle.
   */
  static async cleanupStalePreviews(
    olderThanMs: number = 7 * 24 * 60 * 60 * 1000
  ): Promise<number> {
    let deletedCount = 0;
    const cutoffTime = Date.now() - olderThanMs;

    try {
      let continuationToken: string | undefined = undefined;
      do {
        const listCmd: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: env.S3_BUCKET_NAME,
          Prefix: 'previews/',
          ContinuationToken: continuationToken,
        });
        const resp = await s3Client.send(listCmd);

        if (resp.Contents && resp.Contents.length > 0) {
          const staleObjects = resp.Contents.filter(
            (c) => c.Key && c.LastModified && c.LastModified.getTime() < cutoffTime
          ).map((c) => ({ Key: c.Key! }));

          if (staleObjects.length > 0) {
            await s3Client.send(
              new DeleteObjectsCommand({
                Bucket: env.S3_BUCKET_NAME,
                Delete: { Objects: staleObjects },
              })
            );
            deletedCount += staleObjects.length;
          }
        }
        continuationToken = resp.NextContinuationToken;
      } while (continuationToken);

      if (deletedCount > 0) {
        console.log(
          `[S3] Programmatically purged ${deletedCount} stale preview(s) older than ${Math.round(olderThanMs / 86400000)}d.`
        );
      }
      return deletedCount;
    } catch (err: any) {
      console.warn('[S3] Note on cleaning up stale previews:', err.message || err);
      return deletedCount;
    }
  }

  /**
   * Checks if an object exists in the S3 bucket.
   */
  static async fileExists(key: string): Promise<boolean> {
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: env.S3_BUCKET_NAME,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generates a 1-hour presigned GET URL for downloading rendered video.
   */
  static async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Downloads an S3 object to a local file path.
   */
  static async downloadFile(key: string, localFilePath: string): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error(`S3 object '${key}' has no body content`);
    }
    await pipeline(response.Body as Readable, fs.createWriteStream(localFilePath));
  }

  /**
   * Uploads a local file to S3.
   */
  static async uploadFile(
    key: string,
    localFilePath: string,
    contentType: string = 'video/mp4'
  ): Promise<void> {
    const fileStream = fs.createReadStream(localFilePath);
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ContentType: contentType,
    });
    await s3Client.send(command);
  }

  /**
   * Deletes all objects in S3 matching the given key prefix.
   * Handles pagination with ContinuationToken and batch deletion up to 1,000 objects per command.
   */
  static async deleteObjectsByPrefix(
    prefix: string,
    bucketName: string = env.S3_BUCKET_NAME
  ): Promise<number> {
    let deletedCount = 0;
    try {
      let continuationToken: string | undefined = undefined;
      do {
        const listCmd: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });
        const resp = await s3Client.send(listCmd);
        if (resp.Contents && resp.Contents.length > 0) {
          const toDelete = resp.Contents.filter((c) => c.Key).map((c) => ({ Key: c.Key! }));
          if (toDelete.length > 0) {
            await s3Client.send(
              new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: { Objects: toDelete },
              })
            );
            deletedCount += toDelete.length;
          }
        }
        continuationToken = resp.NextContinuationToken;
      } while (continuationToken);

      console.log(`[S3] Deleted ${deletedCount} object(s) with prefix '${prefix}'.`);
      return deletedCount;
    } catch (err: any) {
      console.warn(`[S3] Note on deleting objects with prefix '${prefix}':`, err.message || err);
      return deletedCount;
    }
  }

  /**
   * Purges all S3 assets and rendered files belonging to a specific user (GDPR / right-to-be-forgotten).
   */
  static async purgeUserStorage(userId: string): Promise<number> {
    const userPrefix = `users/${userId}/`;
    return await this.deleteObjectsByPrefix(userPrefix);
  }
}
