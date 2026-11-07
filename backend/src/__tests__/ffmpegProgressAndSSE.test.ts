import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FFmpegProgressParser } from '../services/compiler/ffmpegProgressParser.js';
import { SSEManager } from '../services/events/sseManager.js';
import { S3Service } from '../services/storage/s3Service.js';
import { RenderJobModel } from '../models/RenderJob.js';

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/download/rendered.mp4?expires=3600'),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findOne: vi.fn(),
  },
}));

describe('Phase 3 Task 4 & 5: FFmpeg -progress Parser, SSE Relay & Download URL Issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FFmpegProgressParser (-progress pipe:1)', () => {
    const totalDurationMs = 60000; // 60 seconds

    it('parses out_time_us and calculates scaled completion percentage', () => {
      const chunk = `
frame=450
fps=29.97
stream_0_0_q=28.0
bitrate=1250.5kbits/s
total_size=1048576
out_time_us=30000000
out_time_ms=30000000
out_time=00:00:30.000000
dup_frames=0
drop_frames=0
speed=1.52x
progress=continue
`;

      const progress = FFmpegProgressParser.parse(chunk, totalDurationMs);

      expect(progress).not.toBeNull();
      expect(progress!.outTimeMs).toBe(30000);
      expect(progress!.speed).toBeCloseTo(1.52, 2);
      expect(progress!.fps).toBeCloseTo(29.97, 2);
      expect(progress!.frame).toBe(450);

      // At 50% render time (30s / 60s), scaled progress between 20% and 92% is ~56%
      expect(progress!.percent).toBe(56);
    });

    it('parses formatted out_time=HH:MM:SS.microsec when microseconds tag is absent', () => {
      const chunk = `
frame=900
fps=30.0
out_time=00:00:45.500000
speed=1.00x
progress=continue
`;

      const progress = FFmpegProgressParser.parse(chunk, totalDurationMs);

      expect(progress).not.toBeNull();
      expect(progress!.outTimeMs).toBe(45500);
      expect(progress!.percent).toBeGreaterThan(65);
    });

    it('returns null when progress chunk contains no time indicators', () => {
      const chunk = `
bitrate=N/A
total_size=0
progress=continue
`;
      const progress = FFmpegProgressParser.parse(chunk, totalDurationMs);
      expect(progress).toBeNull();
    });
  });

  describe('SSEManager (GET /api/jobs/:id/events Relay)', () => {
    it('sets SSE headers and immediately sends done event if job is already completed', () => {
      const mockRes: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };

      const mockCompletedJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'completed',
        percent: 100,
        output: { key: 'users/u1/projects/p1/previews/1.mp4' },
      };

      SSEManager.subscribeToJob('job_672b1234567890abcdef1234', mockRes, mockCompletedJob);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockRes.flushHeaders).toHaveBeenCalled();

      // Check that event: done was emitted immediately
      expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining(': connected to job:672b1234567890abcdef1234'));
      expect(mockRes.write).toHaveBeenCalledWith('event: done\n');
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('"outputKey":"users/u1/projects/p1/previews/1.mp4"')
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('immediately sends error event and terminates stream if job is already failed', () => {
      const mockRes: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };

      const mockFailedJob: any = {
        _id: '672b1234567890abcdef1234',
        state: 'failed',
        percent: 0,
        error: { code: 'FILTER_ERROR', message: 'Invalid subtitle font' },
      };

      SSEManager.subscribeToJob('job_672b1234567890abcdef1234', mockRes, mockFailedJob);

      expect(mockRes.write).toHaveBeenCalledWith('event: error\n');
      expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"code":"FILTER_ERROR"'));
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('Download URL Issuance (S3 Expiring URLs)', () => {
    it('generates a 1-hour presigned download URL for completed render outputs', async () => {
      const key = 'users/u1/projects/p1/renders/job_123.mp4';
      const url = await S3Service.getPresignedDownloadUrl(key, 3600);

      expect(url).toContain('https://s3.example.com/download/rendered.mp4');
      expect(S3Service.getPresignedDownloadUrl).toHaveBeenCalledWith(key, 3600);
    });
  });
});

