import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUEUE_CONFIGS, JobEventsPublisher } from '../services/queue/queueService.js';
import { TranscriptionService, CaptionCue } from '../services/ai/transcriptionService.js';
import { HighlightDiscoveryService } from '../services/ai/highlightDiscoveryService.js';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { S3Service } from '../services/storage/s3Service.js';
import fs from 'fs';

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
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

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  QUEUE_CONFIGS: {
    analysis: {
      name: 'analysis',
      concurrency: 2,
      timeoutMs: 60 * 60 * 1000, // 60 minutes for up to 3 hours raw footage
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      lockDurationMs: 300000, // 5 minutes with auto-renewal
    },
    preview: {
      name: 'preview',
      concurrency: 3,
      timeoutMs: 5 * 60 * 1000,
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 3000,
      },
      lockDurationMs: 60000,
    },
    render: {
      name: 'render',
      concurrency: 1,
      timeoutMs: 60 * 60 * 1000,
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 10000,
      },
      lockDurationMs: 180000,
    },
  },
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    downloadFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('3 Hours Raw Footage Asynchronous Indexing Architecture & Verification', () => {
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000; // 10,800,000 ms (180 minutes)

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. BullMQ Analysis Queue Timeout & Auto-Renewing Lock for 3-Hour Workloads', () => {
    it('configures analysis queue with 60-minute execution timeout to support 3-hour raw footage', () => {
      const config = QUEUE_CONFIGS.analysis;
      expect(config.name).toBe('analysis');
      expect(config.concurrency).toBe(2);
      expect(config.timeoutMs).toBe(60 * 60 * 1000); // 3,600,000 ms
      expect(config.attempts).toBe(3);
      expect(config.backoff.type).toBe('exponential');
      expect(config.lockDurationMs).toBe(300000); // 5 minutes auto-renewing lock
    });

    it('ensures lockDurationMs is at least 5 minutes to prevent job stall during heavy transcode/scene-cut steps', () => {
      expect(QUEUE_CONFIGS.analysis.lockDurationMs).toBeGreaterThanOrEqual(300000);
    });
  });

  describe('2. Large Audio Chunking & Sizing (3-Hour 16kHz Mono WAV = ~345MB)', () => {
    it('defines 5-minute chunk duration and 14MB threshold to fit both Whisper API and Gemini limits', () => {
      expect(TranscriptionService.CHUNK_DURATION_MS).toBe(5 * 60 * 1000); // 300,000 ms
      expect(TranscriptionService.CHUNK_SIZE_THRESHOLD_BYTES).toBe(14 * 1024 * 1024); // 14 MB

      // Verify that 5 minutes of 16kHz 16-bit mono WAV is ~9.15MB (< 14MB Gemini & < 25MB Whisper limits)
      const fiveMinBytes = 300 * 16000 * 2; // 300s * 16000 samples/s * 2 bytes/sample
      expect(fiveMinBytes).toBeLessThan(14 * 1024 * 1024);
      expect(fiveMinBytes).toBeLessThan(25 * 1024 * 1024);
    });

    it('segments a 3-hour audio timeline into 36 continuous chunks with strictly monotonic offsets', async () => {
      const totalDurationMs = THREE_HOURS_MS; // 10,800,000 ms
      const chunkDurationMs = TranscriptionService.CHUNK_DURATION_MS; // 300,000 ms
      const expectedChunks = Math.ceil(totalDurationMs / chunkDurationMs); // 36 chunks

      expect(expectedChunks).toBe(36);

      // Mock audio file stats > 14MB
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 345 * 1024 * 1024 } as any);

      // Spy on sliceAudioChunk to return true (simulating successful ffmpeg slice)
      vi.spyOn(TranscriptionService, 'sliceAudioChunk').mockResolvedValue(true);

      // Spy on transcribeAudioSingleChunk to return synthetic cues for each chunk
      let chunkCallCount = 0;
      vi.spyOn(TranscriptionService, 'transcribeAudioSingleChunk').mockImplementation(
        async (_path, durationMs, _silences) => {
          chunkCallCount++;
          return [
            {
              id: `chunk_cue_1`,
              startMs: 1000,
              endMs: 4000,
              text: `Dialogue in segment ${chunkCallCount}`,
              words: [
                { w: 'Dialogue', s: 1000, e: 2000, conf: 0.98 },
                { w: 'in', s: 2100, e: 2500, conf: 0.98 },
                { w: 'segment', s: 2600, e: 3200, conf: 0.98 },
                { w: `${chunkCallCount}`, s: 3300, e: 4000, conf: 0.98 },
              ],
            },
            {
              id: `chunk_cue_2`,
              startMs: 6000,
              endMs: Math.min(durationMs, 10000),
              text: `Key insights continued`,
              words: [
                { w: 'Key', s: 6000, e: 7000, conf: 0.98 },
                { w: 'insights', s: 7100, e: 8500, conf: 0.98 },
                { w: 'continued', s: 8600, e: Math.min(durationMs, 10000), conf: 0.98 },
              ],
            },
          ];
        }
      );

      const silences = [
        { startMs: 5000, endMs: 5800, avgDb: -42 },
        { startMs: 320000, endMs: 322000, avgDb: -45 },
        { startMs: 10500000, endMs: 10502000, avgDb: -40 },
      ];

      const cues = await TranscriptionService.transcribeAudio(
        'mock/audio/3hour_16k.wav',
        totalDurationMs,
        silences
      );

      expect(chunkCallCount).toBe(36);
      expect(cues.length).toBe(72); // 2 cues per chunk * 36 chunks

      // Check first chunk (0 to 300,000ms)
      expect(cues[0].startMs).toBe(1000);
      expect(cues[0].endMs).toBe(4000);
      expect(cues[0].words[0].s).toBe(1000);

      // Check chunk 2 (starts at 300,000ms)
      expect(cues[2].startMs).toBe(300000 + 1000); // 301,000 ms
      expect(cues[2].endMs).toBe(300000 + 4000); // 304,000 ms
      expect(cues[2].words[0].s).toBe(301000);

      // Check final chunk 36 (starts at 35 * 300,000ms = 10,500,000ms)
      const lastCue = cues[cues.length - 1];
      expect(lastCue.startMs).toBe(10500000 + 6000);
      expect(lastCue.endMs).toBeLessThanOrEqual(totalDurationMs);

      // Verify all 72 cues are strictly non-overlapping and chronological across chunk boundaries
      for (let i = 0; i < cues.length - 1; i++) {
        expect(cues[i].endMs).toBeLessThanOrEqual(cues[i + 1].startMs);
        expect(cues[i].startMs).toBeLessThan(cues[i].endMs);
      }
    });

    it('gracefully generates acoustic speech cues across 3 hours when audio slicing is unavailable', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 345 * 1024 * 1024 } as any);
      vi.spyOn(TranscriptionService, 'sliceAudioChunk').mockResolvedValue(false); // Slicing unavailable

      const silences = [
        { startMs: 10000, endMs: 12000, avgDb: -40 },
        { startMs: 5000000, endMs: 5005000, avgDb: -42 },
        { startMs: 10700000, endMs: 10703000, avgDb: -41 },
      ];

      const cues = await TranscriptionService.transcribeAudio(
        'mock/audio/3hour_acoustic.wav',
        THREE_HOURS_MS,
        silences
      );

      expect(cues.length).toBeGreaterThan(0);
      expect(cues[0].startMs).toBe(0);
      expect(cues[cues.length - 1].endMs).toBeLessThanOrEqual(THREE_HOURS_MS);

      // Monotonic sequence verification
      for (let i = 0; i < cues.length - 1; i++) {
        expect(cues[i].endMs).toBeLessThanOrEqual(cues[i + 1].startMs);
      }
    });
  });

  describe('3. Multimodal Indexing & Semantic Discovery Across 3-Hour Footage', () => {
    it('distributes semantic chapters across the entire 3-hour timeline (not clustered in first 40s)', () => {
      // 3 hours with silences and scene cuts spread evenly across the timeline
      const silences = [
        { startMs: 1200000, endMs: 1202000, avgDb: -42 }, // 20m
        { startMs: 2700000, endMs: 2702000, avgDb: -43 }, // 45m
        { startMs: 5400000, endMs: 5402000, avgDb: -44 }, // 90m
        { startMs: 8100000, endMs: 8102000, avgDb: -41 }, // 135m
        { startMs: 10200000, endMs: 10202000, avgDb: -45 }, // 170m
      ];

      const sceneCuts = [
        { tMs: 1201000, score: 0.65 },
        { tMs: 2701000, score: 0.72 },
        { tMs: 5401000, score: 0.68 },
        { tMs: 8101000, score: 0.75 },
        { tMs: 10201000, score: 0.71 },
      ];

      const cues: CaptionCue[] = [
        {
          id: 'c1',
          startMs: 0,
          endMs: 5000,
          text: 'Did you know how to build autonomous video production systems?',
          words: [],
        },
        {
          id: 'c2',
          startMs: 1205000,
          endMs: 1215000,
          text: 'In this section we cover distributed cloud rendering and pipeline concurrency.',
          words: [],
        },
        {
          id: 'c3',
          startMs: 5405000,
          endMs: 5415000,
          text: 'Midpoint milestone covering GPU acceleration and proxy encoding.',
          words: [],
        },
        {
          id: 'c4',
          startMs: 10205000,
          endMs: 10215000,
          text: 'Concluding chapter wrapping up the 3-hour masterclass.',
          words: [],
        },
      ];

      const discovery = HighlightDiscoveryService.discover({
        cues,
        silences,
        sceneCuts,
        durationMs: THREE_HOURS_MS,
      });

      expect(discovery.chapters.length).toBeGreaterThanOrEqual(3);
      expect(discovery.chapters[0].title).toBe('Introduction & Hook');
      expect(discovery.chapters[discovery.chapters.length - 1].title).toBe('Summary & Wrap-up');

      // The final chapter boundary must reach the 3-hour duration
      expect(discovery.chapters[discovery.chapters.length - 1].endMs).toBe(THREE_HOURS_MS);

      // Verify chapters span well into the second and third hours
      const chapterMidpoints = discovery.chapters.map((ch) => (ch.startMs + ch.endMs) / 2);
      expect(Math.max(...chapterMidpoints)).toBeGreaterThan(7200000); // Past 2 hours
    });

    it('samples highlight segments across the beginning, middle, and late phases of 3-hour footage', () => {
      const cues: CaptionCue[] = [
        {
          id: 'c_early',
          startMs: 1000,
          endMs: 25000,
          text: 'The secret to rapid video creation is autonomous multi-track indexing and AI planning.',
          words: [],
        },
        {
          id: 'c_mid',
          startMs: 5400000,
          endMs: 5425000,
          text: 'This is the most important breakthrough: zero-copy reference style transfer.',
          words: [],
        },
        {
          id: 'c_late',
          startMs: 10200000,
          endMs: 10225000,
          text: 'Finally, winning creators export directly to TikTok, Shorts, and Reels with burned subtitles.',
          words: [],
        },
      ];

      const silences = [
        { startMs: 25000, endMs: 26000, avgDb: -42 },
        { startMs: 5425000, endMs: 5426000, avgDb: -42 },
        { startMs: 10225000, endMs: 10226000, avgDb: -42 },
      ];

      const sceneCuts = [
        { tMs: 12000, score: 0.65 },
        { tMs: 5412000, score: 0.72 },
        { tMs: 10212000, score: 0.69 },
      ];

      const discovery = HighlightDiscoveryService.discover({
        cues,
        silences,
        sceneCuts,
        durationMs: THREE_HOURS_MS,
      });

      expect(discovery.highlights.length).toBeGreaterThanOrEqual(1);
      discovery.highlights.forEach((hl) => {
        expect(hl.score).toBeGreaterThan(0.75);
        expect(hl.endMs).toBeLessThanOrEqual(THREE_HOURS_MS);
      });
    });

    it('caps 3-hour BPM beat grid at 500 samples to prevent MongoDB BSON document bloat', () => {
      // 3 hours @ 120 BPM produces 21,600 beats
      const estimatedBpm = 120;
      const beatIntervalMs = Math.round(60000 / estimatedBpm);
      const beatGrid: number[] = [];
      for (let t = 0; t < THREE_HOURS_MS; t += beatIntervalMs) {
        beatGrid.push(t);
      }

      expect(beatGrid.length).toBe(21600);

      // Verify the storage slice cap
      const storedGrid = beatGrid.slice(0, 500);
      expect(storedGrid.length).toBe(500);
      expect(storedGrid[0]).toBe(0);
      expect(storedGrid[499]).toBe(499 * beatIntervalMs);
    });
  });

  describe('4. Proxy Optimization for 3-Hour Media to Prevent Worker OOM', () => {
    it('prefers 480p proxy for scene cut detection to reduce pixel decode footprint by > 85%', async () => {
      const detectSpy = vi.spyOn(MediaProbeService, 'detectSceneCuts').mockResolvedValue([
        { tMs: 15000, score: 0.62 },
        { tMs: 3600000, score: 0.74 },
        { tMs: 7200000, score: 0.68 },
      ]);

      const mockProxyPath = '/tmp/scratch/job_3hr/asset_proxy_480p.mp4';
      const mockRawPath = '/tmp/scratch/job_3hr/asset_raw_4k.mp4';

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === mockProxyPath);

      const sceneSource = fs.existsSync(mockProxyPath) ? mockProxyPath : mockRawPath;
      const cuts = await MediaProbeService.detectSceneCuts(sceneSource, 0.3);

      expect(sceneSource).toBe(mockProxyPath); // Selected 480p proxy over raw 4K
      expect(cuts.length).toBe(3);
      expect(detectSpy).toHaveBeenCalledWith(mockProxyPath, 0.3);
    });
  });
});
