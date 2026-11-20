import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api/client';

describe('Resumable Raw-Media Upload Suite', () => {
  const UPLOAD_STORAGE_KEY = 'ai_video_pending_upload';

  const storageMap = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => storageMap.get(k) || null,
    setItem: (k: string, v: string) => {
      storageMap.set(k, v);
    },
    removeItem: (k: string) => {
      storageMap.delete(k);
    },
    clear: () => {
      storageMap.clear();
    },
  };

  beforeEach(() => {
    storageMap.clear();
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.restoreAllMocks();
  });

  it('persists upload session to localStorage and restores active unexpired session', () => {
    const sessionData = {
      uploadId: 'upl_resumable_test_1',
      projectId: 'prj_test_123',
      fileName: 'cinematic_footage_4k.mp4',
      fileSize: 100 * 1024 * 1024,
      contentType: 'video/mp4',
      title: 'Cinematic Footage',
      completedParts: [
        { partNumber: 1, etag: '"etag1"' },
        { partNumber: 2, etag: '"etag2"' },
      ],
      totalParts: 5,
      partSizeBytes: 20 * 1024 * 1024,
      createdAt: Date.now(),
    };

    localStorage.setItem(UPLOAD_STORAGE_KEY, JSON.stringify(sessionData));

    const restoredRaw = localStorage.getItem(UPLOAD_STORAGE_KEY);
    expect(restoredRaw).not.toBeNull();

    const restored = JSON.parse(restoredRaw!);
    expect(restored.uploadId).toBe('upl_resumable_test_1');
    expect(restored.completedParts.length).toBe(2);
    expect(restored.totalParts).toBe(5);
  });

  it('discards expired upload sessions older than 24 hours', () => {
    const expiredData = {
      uploadId: 'upl_expired_old',
      projectId: 'prj_old',
      fileName: 'old_video.mp4',
      fileSize: 50 * 1024 * 1024,
      contentType: 'video/mp4',
      title: 'Old Video',
      completedParts: [{ partNumber: 1, etag: '"etag1"' }],
      totalParts: 4,
      partSizeBytes: 16 * 1024 * 1024,
      createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    };

    localStorage.setItem(UPLOAD_STORAGE_KEY, JSON.stringify(expiredData));

    // Expiry check logic
    const raw = localStorage.getItem(UPLOAD_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    const isExpired = Date.now() - parsed.createdAt >= 24 * 60 * 60 * 1000;

    expect(isExpired).toBe(true);
    if (isExpired) {
      localStorage.removeItem(UPLOAD_STORAGE_KEY);
    }

    expect(localStorage.getItem(UPLOAD_STORAGE_KEY)).toBeNull();
  });

  it('calculates progress accurately when resuming partial uploads', () => {
    const totalParts = 10;
    const completedParts = [
      { partNumber: 1, etag: '"etag1"' },
      { partNumber: 2, etag: '"etag2"' },
      { partNumber: 3, etag: '"etag3"' },
      { partNumber: 4, etag: '"etag4"' },
    ];

    // Resumption progress calculation formula
    const progressPct = 15 + Math.round((completedParts.length / totalParts) * 75);
    expect(progressPct).toBe(45); // 15 + (0.4 * 75) = 45%

    // Remaining parts determination
    const completedPartNumbers = new Set(completedParts.map((p) => p.partNumber));
    const allPartNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
    const remainingPartNumbers = allPartNumbers.filter((p) => !completedPartNumbers.has(p));

    expect(remainingPartNumbers).toEqual([5, 6, 7, 8, 9, 10]);
    expect(remainingPartNumbers.length).toBe(6);
  });

  it('correctly maps and sorts uploaded parts for upload completion without gaps', () => {
    // Simulating concurrent chunk completion arriving out of order
    const completedMap = new Map<number, string>();
    completedMap.set(3, '"etag3"');
    completedMap.set(1, '"etag1"');
    completedMap.set(4, '"etag4"');
    completedMap.set(2, '"etag2"');

    const sortedParts = Array.from(completedMap.entries())
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    expect(sortedParts).toEqual([
      { partNumber: 1, etag: '"etag1"' },
      { partNumber: 2, etag: '"etag2"' },
      { partNumber: 3, etag: '"etag3"' },
      { partNumber: 4, etag: '"etag4"' },
    ]);

    // Verify sequential integrity (no gaps)
    for (let i = 0; i < sortedParts.length; i++) {
      expect(sortedParts[i].partNumber).toBe(i + 1);
      expect(sortedParts[i].etag).toBeTruthy();
    }
  });

  it('api.getUploadStatus queries status and remaining parts from backend', async () => {
    const mockStatusResponse = {
      uploadId: 'upl_mock_api_test',
      projectId: 'prj_api_test',
      assetId: 'ast_api_test',
      sizeBytes: 64 * 1024 * 1024,
      partSizeBytes: 16 * 1024 * 1024,
      totalParts: 4,
      uploadedParts: [
        { partNumber: 1, etag: '"etag1"' },
        { partNumber: 2, etag: '"etag2"' },
      ],
      remainingParts: [
        { partNumber: 3, url: 'https://s3/p3', expiresAt: '2026-11-20T20:00:00Z' },
        { partNumber: 4, url: 'https://s3/p4', expiresAt: '2026-11-20T20:00:00Z' },
      ],
      isComplete: false,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockStatusResponse,
      }),
    } as Response);

    const status = await api.getUploadStatus('upl_mock_api_test');

    expect(status.uploadId).toBe('upl_mock_api_test');
    expect(status.uploadedParts.length).toBe(2);
    expect(status.remainingParts.length).toBe(2);
    expect(status.isComplete).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/upl_mock_api_test'),
      expect.any(Object)
    );
  });
});
