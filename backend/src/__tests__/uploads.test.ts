import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadsController } from '../controllers/uploadsController.js';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { S3Service } from '../services/storage/s3Service.js';
import { UploadSessionStore } from '../services/storage/uploadSessionStore.js';
import { Request, Response } from 'express';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    create: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  analysisQueue: {
    add: vi.fn().mockResolvedValue({ id: 'bull_123' }),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    createMultipartUpload: vi.fn(),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
  },
}));

vi.mock('../config/redis.js', () => ({
  redisConnection: {
    status: 'ready',
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
  },
  createRedisConnection: vi.fn(),
}));

describe('UploadsController - MIME, Size & Session Validation', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: any;
  let jsonMock: any;
  let statusMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (AssetModel.findOne as any).mockResolvedValue(null);
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    nextFn = vi.fn();
  });

  it('rejects unsupported MIME types with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'image.png',
        contentType: 'image/png',
        sizeBytes: 1048576,
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_1',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    );
  });

  it('rejects 0-byte or negative sizes with 400 INVALID_FILE_SIZE', async () => {
    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'empty.mp4',
        contentType: 'video/mp4',
        sizeBytes: 0,
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_2',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_FILE_SIZE',
      })
    );
  });

  it('rejects files smaller than 1024 bytes with 400 FILE_TOO_SMALL', async () => {
    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'tiny.mp4',
        contentType: 'video/mp4',
        sizeBytes: 500,
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_3',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'FILE_TOO_SMALL',
      })
    );
  });

  it('rejects files exceeding 5GB with 413 UPLOAD_TOO_LARGE', async () => {
    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'huge.mp4',
        contentType: 'video/mp4',
        sizeBytes: 6 * 1024 * 1024 * 1024, // 6 GB
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_4',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        code: 'UPLOAD_TOO_LARGE',
      })
    );
  });

  it('creates upload session and persists to UploadSessionStore for valid video', async () => {
    (ProjectModel.findOne as any).mockResolvedValue({
      _id: 'prj_id_1',
      publicId: 'prj_test',
      userId: 'usr_1',
    });

    (S3Service.createMultipartUpload as any).mockResolvedValue({
      uploadId: 'upl_mock_123',
      rawKey: 'users/usr_1/projects/prj_test/raw/ast_1.mp4',
      partSizeBytes: 16777216,
      parts: [{ partNumber: 1, url: 'https://s3/test', expiresAt: '2026-11-06' }],
      expiresAt: '2026-11-06',
    });

    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'valid_travel_video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10 * 1024 * 1024, // 10 MB
        checksumSha256: 'a1b2c3d4e5',
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_5',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          uploadId: 'upl_mock_123',
        }),
      })
    );

    // Verify session was saved to store
    const storedSession = await UploadSessionStore.getSession('upl_mock_123');
    expect(storedSession).not.toBeNull();
    expect(storedSession?.userId).toBe('usr_1');
    expect(storedSession?.checksumSha256).toBe('a1b2c3d4e5');
  });

  it('rejects completeUpload if parts are non-contiguous or missing ETags', async () => {
    await UploadSessionStore.saveSession('upl_mock_999', {
      userId: 'usr_1',
      projectId: 'prj_test',
      assetId: 'ast_test',
      rawKey: 'users/usr_1/...',
      sizeBytes: 30000000,
      contentType: 'video/mp4',
      totalParts: 2,
      createdAt: new Date().toISOString(),
    });

    // Parts have a gap: part 1 then part 3 (missing part 2)
    mockReq = {
      params: { id: 'upl_mock_999' },
      body: {
        parts: [
          { partNumber: 1, etag: '"etag1"' },
          { partNumber: 3, etag: '"etag3"' },
        ],
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_6',
    };

    await UploadsController.completeUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_PART_SEQUENCE',
      })
    );
  });

  it('rejects completeUpload if parts count does not match totalParts', async () => {
    await UploadSessionStore.saveSession('upl_mock_parts_count', {
      userId: 'usr_1',
      projectId: 'prj_test',
      assetId: 'ast_test',
      rawKey: 'users/usr_1/...',
      sizeBytes: 30000000,
      contentType: 'video/mp4',
      totalParts: 3,
      createdAt: new Date().toISOString(),
    });

    mockReq = {
      params: { id: 'upl_mock_parts_count' },
      body: {
        parts: [
          { partNumber: 1, etag: '"etag1"' },
          { partNumber: 2, etag: '"etag2"' },
        ], // Only 2 parts sent, but 3 expected
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_7',
    };

    await UploadsController.completeUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INCOMPLETE_PARTS',
      })
    );
  });

  it('rejects completeUpload with 403 FORBIDDEN if caller does not own the session', async () => {
    await UploadSessionStore.saveSession('upl_mock_tenant', {
      userId: 'usr_victim',
      projectId: 'prj_test',
      assetId: 'ast_test',
      rawKey: 'users/usr_victim/...',
      sizeBytes: 10000000,
      contentType: 'video/mp4',
      totalParts: 1,
      createdAt: new Date().toISOString(),
    });

    mockReq = {
      params: { id: 'upl_mock_tenant' },
      body: {
        parts: [{ partNumber: 1, etag: '"etag1"' }],
      },
      user: { _id: 'usr_attacker', id: 'usr_attacker' } as any,
      id: 'req_8',
    };

    await UploadsController.completeUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      })
    );
  });

  it('deduplicates upload when existing verified asset matches checksumSha256', async () => {
    const mockExistingAsset = {
      _id: 'ast_existing_id',
      publicId: 'ast_existing_123',
      checksum: 'sha256_match_hash',
      status: 'ready',
    };

    const mockProject = {
      _id: 'prj_1',
      publicId: 'prj_test',
      userId: 'usr_1',
      baseAssetId: null,
      status: 'draft',
      save: vi.fn().mockResolvedValue(true),
    };

    (ProjectModel.findOne as any).mockResolvedValue(mockProject);
    (AssetModel.findOne as any) = vi.fn().mockResolvedValue(mockExistingAsset);

    mockReq = {
      body: {
        projectId: 'prj_test',
        fileName: 'reuploaded_video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 20000000,
        checksumSha256: 'sha256_match_hash',
      },
      user: { _id: 'usr_1', id: 'usr_1' } as any,
      id: 'req_9',
    };

    await UploadsController.createUpload(mockReq as Request, mockRes as Response, nextFn);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          deduplicated: true,
          assetId: 'ast_existing_123',
        }),
      })
    );
    expect(mockProject.baseAssetId).toBe('ast_existing_id');
    expect(mockProject.status).toBe('ready');
  });
});
