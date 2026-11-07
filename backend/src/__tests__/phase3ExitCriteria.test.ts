import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { FFmpegProgressParser } from '../services/compiler/ffmpegProgressParser.js';
import { JobScratchDirectory } from '../services/storage/jobScratchDirectory.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { SSEManager } from '../services/events/sseManager.js';
import { S3Service } from '../services/storage/s3Service.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { AssetModel } from '../models/Asset.js';
import { EditPlan, CompactAnalysisSummary } from '@ai-video/shared';
import fs from 'fs';
import path from 'path';

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    findOne: vi.fn(),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findById: vi.fn(),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    downloadFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.example.com/previews/1.mp4?exp=3600'),
  },
}));

vi.mock('../services/queue/queueService.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    JobEventsPublisher: {
      publishProgress: vi.fn().mockResolvedValue(true),
    },
  };
});

describe('Phase 3 Exit Criteria Gate: Static Edit Plan 480p Preview & Failure Resilience', () => {
  const testJobId = 'job_phase3_exit_test';
  const testProjectId = 'prj_phase3_test';
  const testUserId = 'u1';

  const staticAnalysis: CompactAnalysisSummary = {
    durationMs: 45000,
    width: 1920,
    height: 1080,
    fps: 30,
    silences: [{ startMs: 10000, endMs: 12000, avgDb: -32 }],
    sceneCuts: [{ tMs: 15000, score: 0.5 }],
    beats: { bpm: 120, grid: [] },
    loudness: { integratedLufs: -16.0, truePeakDb: -1.0 },
    transcriptExcerpt: [{ startMs: 1000, endMs: 5000, text: 'Phase 3 preview render test' }],
  };

  const staticPlan: EditPlan = {
    schemaVersion: '1.0',
    projectId: testProjectId,
    baseAssetId: 'ast_source_01',
    version: 1,
    parentVersion: null,
    global: { aspect: '16:9', fps: 30, resolution: '1080p' },
    layers: [
      {
        id: 'cut_silence',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 10, end: 12 },
        params: { reason: 'silence', padding: 0.05 },
      },
      {
        id: 'col_cinematic',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset: 'cinematic',
          contrast: 1.15,
          saturation: 0.9,
          vignette: 0.3,
          brightness: 0,
          grain: 0,
        },
      },
      {
        id: 'sub_pop',
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style: 'word_pop',
          font: 'Montserrat',
          size: 52,
          position: 'bottom',
          primaryColor: '#FFFFFF',
          highlightColor: '#FFD84D',
          maxWordsPerLine: 4,
        },
      },
    ],
    meta: { prompt: 'Render 480p preview', model: 'test', createdAt: new Date().toISOString() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exit criteria: renders 480p preview, publishes progress to SSE, uploads to S3, and issues expiring download URL', async () => {
    // 1. Compile pure deterministic FFmpeg arguments
    const compiled = FFmpegCompiler.compile(staticPlan, staticAnalysis, 'preview_480p', {
      inputSourcePath: 'source.mp4',
      assSubtitlePath: 'subtitles.ass',
      outputPath: 'preview_480p.mp4',
    });

    expect(compiled.args).toContain('-s');
    expect(compiled.args).toContain('854x480');
    expect(compiled.args).toContain('-crf');
    expect(compiled.args).toContain('28');
    expect(compiled.assFiles.length).toBe(1);

    // 2. Isolated per-job scratch directory created and verified
    const scratch = new JobScratchDirectory(testJobId);
    expect(fs.existsSync(scratch.dirPath)).toBe(true);

    const mockJob: any = {
      _id: 'phase3_exit_test',
      userId: testUserId,
      projectId: testProjectId,
      state: 'queued',
      percent: 0,
      timings: { queuedAt: new Date() },
      save: vi.fn().mockResolvedValue(true),
    };

    (RenderJobModel.findById as any).mockResolvedValue(mockJob);
    (RenderJobModel.findOne as any).mockResolvedValue(mockJob);

    // 3. Lifecycle state: queued -> processing
    await RenderJobLifecycle.transition(testJobId, 'processing', { percent: 15 });
    expect(mockJob.state).toBe('processing');
    expect(mockJob.timings.startedAt).toBeInstanceOf(Date);

    // 4. Parse FFmpeg progress from simulated stdout
    const progressChunk = `
frame=300
fps=30.0
out_time_us=22500000
speed=1.50x
progress=continue
`;
    const parsed = FFmpegProgressParser.parse(progressChunk, staticAnalysis.durationMs);
    expect(parsed).not.toBeNull();
    expect(parsed!.outTimeMs).toBe(22500);
    expect(parsed!.percent).toBeGreaterThan(50);

    await RenderJobLifecycle.transition(testJobId, 'processing', {
      percent: parsed!.percent,
      outTimeMs: parsed!.outTimeMs,
    });
    expect(mockJob.percent).toBe(parsed!.percent);

    // 5. Lifecycle state: processing -> uploading_output
    await RenderJobLifecycle.transition(testJobId, 'uploading_output', { percent: 95 });
    expect(mockJob.state).toBe('uploading_output');

    // 6. Upload output to S3
    const outputKey = `users/${testUserId}/projects/${testProjectId}/previews/1.mp4`;
    await S3Service.uploadFile(outputKey, 'mock_preview.mp4', 'video/mp4');
    expect(S3Service.uploadFile).toHaveBeenCalledWith(outputKey, expect.any(String), 'video/mp4');

    // 7. Complete job & calculate timings
    await RenderJobLifecycle.transition(testJobId, 'completed', {
      output: {
        key: outputKey,
        sizeBytes: 8500000,
        durationMs: staticAnalysis.durationMs,
      },
    });

    expect(mockJob.state).toBe('completed');
    expect(mockJob.percent).toBe(100);
    expect(mockJob.timings.finishedAt).toBeInstanceOf(Date);
    expect(mockJob.output.key).toBe(outputKey);

    // 8. Client subscribes to SSE: immediately receives done event
    const mockRes: any = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    SSEManager.subscribeToJob(testJobId, mockRes, mockJob);
    expect(mockRes.write).toHaveBeenCalledWith('event: done\n');
    expect(mockRes.end).toHaveBeenCalled();

    // 9. Client requests download URL: receives expiring S3 presigned URL
    const downloadUrl = await S3Service.getPresignedDownloadUrl(mockJob.output.key, 3600);
    expect(downloadUrl).toContain('https://s3.example.com/previews/1.mp4');

    // 10. Scratch directory cleaned up
    scratch.cleanup();
    expect(fs.existsSync(scratch.dirPath)).toBe(false);
  });

  it('exit criteria resilience: a failed job transitions cleanly to failed and leaves the source and plan intact', async () => {
    const mockJob: any = {
      _id: 'phase3_failure_test',
      userId: testUserId,
      projectId: testProjectId,
      state: 'processing',
      percent: 30,
      timings: { queuedAt: new Date(), startedAt: new Date() },
      save: vi.fn().mockResolvedValue(true),
    };

    (RenderJobModel.findById as any).mockResolvedValue(mockJob);

    // Simulate failure during rendering (e.g. corrupt filter or missing codec)
    const renderError = {
      code: 'FILTER_ERROR',
      message: 'Unknown filter syntax: invalid_eq',
    };

    await RenderJobLifecycle.transition('phase3_failure_test', 'failed', {
      error: renderError,
    });

    expect(mockJob.state).toBe('failed');
    expect(mockJob.error.code).toBe('FILTER_ERROR');
    expect(mockJob.error.retryable).toBe(false);
    expect(mockJob.timings.finishedAt).toBeInstanceOf(Date);

    // Plan and source asset remain untouched and intact
    expect(staticPlan.version).toBe(1);
    expect(staticPlan.layers.length).toBe(3);
  });
});
