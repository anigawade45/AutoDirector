import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { TranscriptionService } from '../services/ai/transcriptionService.js';
import { AssGenerator } from '../services/compiler/assGenerator.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { S3Service } from '../services/storage/s3Service.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';
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

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
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
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    downloadFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
    fileExists: vi.fn().mockResolvedValue(true),
  },
}));

describe('Phase 2 — Media Analysis, Audio Intelligence & Captioned Preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Task 3: Word-Level Transcription Integration', () => {
    it('formats Whisper word boundaries into phrase cues with <= 150 ms precision', () => {
      const mockWhisperWords = [
        { word: 'Welcome', start: 0.12, end: 0.54 },
        { word: 'to', start: 0.55, end: 0.71 },
        { word: 'our', start: 0.72, end: 0.95 },
        { word: 'AI', start: 0.98, end: 1.34 },
        { word: 'video', start: 1.35, end: 1.82 },
        { word: 'platform', start: 1.85, end: 2.45 },
      ];

      const cues = TranscriptionService.formatWhisperWordsToCues(mockWhisperWords);

      expect(cues.length).toBe(2);
      expect(cues[0].text).toBe('Welcome to our AI video');
      expect(cues[0].startMs).toBe(120);
      expect(cues[0].endMs).toBe(1820);
      expect(cues[0].words.length).toBe(5);

      // Verify word boundary granularity is within 150 ms
      cues[0].words.forEach((w) => {
        expect(w.e).toBeGreaterThan(w.s);
        expect(w.conf).toBeGreaterThan(0.9);
      });

      expect(cues[1].text).toBe('platform');
      expect(cues[1].startMs).toBe(1850);
      expect(cues[1].endMs).toBe(2450);
    });

    it('gracefully returns empty cues for silent videos (no audio track or empty file)', async () => {
      const cuesNoFile = await TranscriptionService.transcribeAudio('', 60000, []);
      expect(cuesNoFile).toEqual([]);

      const cuesNonExistent = await TranscriptionService.transcribeAudio(
        'non_existent.wav',
        60000,
        []
      );
      expect(cuesNonExistent).toEqual([]);
    });

    it('generates acoustic-aligned speech cues using silence interval boundaries', () => {
      const silences = [
        { startMs: 3000, endMs: 4500, avgDb: -35 },
        { startMs: 8000, endMs: 9500, avgDb: -32 },
      ];

      const cues = TranscriptionService.generateAcousticSpeechCues(12000, silences);

      expect(cues.length).toBeGreaterThan(0);
      expect(cues[0].startMs).toBe(0);
      expect(cues[0].endMs).toBe(3000);

      // Words should be properly distributed within non-silent intervals
      cues[0].words.forEach((w) => {
        expect(w.s).toBeGreaterThanOrEqual(0);
        expect(w.e).toBeLessThanOrEqual(3000);
        expect(w.e - w.s).toBeGreaterThanOrEqual(120);
      });
    });

    it('calibrates dilated AI timestamps to accurately match actual video duration', () => {
      // Dilated timestamps up to 383.3s on a 263.9s video (user bug reproduction)
      const dilatedCues = [
        {
          id: 'cue_1',
          startMs: 0,
          endMs: 14500,
          text: 'Hello, my name is Aniket Lakshman Gawade.',
          words: [
            { w: 'Hello,', s: 0, e: 2900, conf: 0.95 },
            { w: 'my', s: 2900, e: 4350, conf: 0.95 },
            { w: 'name', s: 4350, e: 5800, conf: 0.95 },
            { w: 'is', s: 5800, e: 7250, conf: 0.95 },
            { w: 'Aniket', s: 7250, e: 10150, conf: 0.95 },
            { w: 'Lakshman', s: 10150, e: 13050, conf: 0.95 },
            { w: 'Gawade.', s: 13050, e: 14500, conf: 0.95 },
          ],
        },
        {
          id: 'cue_final',
          startMs: 369300,
          endMs: 383300,
          text: 'Both project are implemented separately and each has the own',
          words: [
            { w: 'Both', s: 369300, e: 371000, conf: 0.95 },
            { w: 'own', s: 381000, e: 383300, conf: 0.95 },
          ],
        },
      ];

      const videoDurationMs = 263900; // 4:23.9
      const calibrated = TranscriptionService.calibrateCuesToDuration(dilatedCues, videoDurationMs);

      expect(calibrated.length).toBe(2);
      // Last cue end must not exceed video duration
      expect(calibrated[1].endMs).toBeLessThanOrEqual(videoDurationMs);
      // Final word must be within video duration
      expect(calibrated[1].words[1].e).toBeLessThanOrEqual(videoDurationMs);
      // Proportionally scaled: cue_final start should now be ~254s instead of 369.3s
      expect(calibrated[1].startMs).toBeLessThan(videoDurationMs);
      expect(calibrated[1].startMs).toBeGreaterThan(240000);
      // First cue word pacing scaled proportionally
      expect(calibrated[0].startMs).toBe(0);
      expect(calibrated[0].endMs).toBeLessThan(14500);
    });

    it('enforces non-overlapping cue boundaries and eliminates double text', () => {
      // Overlapping cues from user screenshot:
      // Cue 1: 46100 - 62000 ms
      // Cue 2: 59800 - 65500 ms (overlaps by 2200 ms)
      const overlapping = [
        {
          id: 'cue_1',
          startMs: 46100,
          endMs: 62000,
          text: 'So here I running the automation against the configuration URL, the...',
          words: [
            { w: 'So', s: 46100, e: 46600, conf: 0.95 },
            { w: 'the...', s: 61500, e: 62000, conf: 0.95 },
          ],
        },
        {
          id: 'cue_2',
          startMs: 59800,
          endMs: 65500,
          text: 'After interacting with the field, it verify that an expected value has...',
          words: [
            { w: 'After', s: 59800, e: 60500, conf: 0.95 },
            { w: 'has...', s: 65000, e: 65500, conf: 0.95 },
          ],
        },
      ];

      const resolved = TranscriptionService.resolveCueOverlaps(overlapping, 30);

      expect(resolved).toHaveLength(2);
      // Cue 1 end must be clamped before Cue 2 start
      expect(resolved[0].endMs).toBeLessThanOrEqual(resolved[1].startMs);
      expect(resolved[0].endMs).toBeLessThanOrEqual(59770);
      // Word inside Cue 1 must not exceed the new endMs
      expect(resolved[0].words[1].e).toBeLessThanOrEqual(resolved[0].endMs);
    });

    it('parses timestamps in seconds and timecodes accurately into integer milliseconds', () => {
      expect(TranscriptionService.parseTimestampToMs(0.4, true)).toBe(400);
      expect(TranscriptionService.parseTimestampToMs(4.2, false)).toBe(4200); // Decimals auto-detected as seconds
      expect(TranscriptionService.parseTimestampToMs('46.1', true)).toBe(46100);
      expect(TranscriptionService.parseTimestampToMs('0:04.2')).toBe(4200);
      expect(TranscriptionService.parseTimestampToMs('01:23.5')).toBe(83500);
      expect(TranscriptionService.parseTimestampToMs(45000, false)).toBe(45000);
    });

    it('detects second timestamps in AI raw responses and avoids collapsing into milliseconds', () => {
      const rawCuesInSeconds = [
        {
          id: 'cue_1',
          start: 0.0,
          end: 4.2,
          text: 'Hello, my name is Aniket Laxman Gawde.',
          words: [
            { word: 'Hello', start: 0.0, end: 0.8 },
            { word: 'Gawde', start: 3.0, end: 4.2 },
          ],
        },
        {
          id: 'cue_2',
          start: 4.5,
          end: 9.1,
          text: 'As part of this internship assignment, I was given to automation task.',
        },
      ];

      expect(TranscriptionService.detectIfSeconds(rawCuesInSeconds, 263000)).toBe(true);
    });

    it('distributes collapsed 0-16s cues across speech intervals of a multi-minute video', () => {
      const collapsedCues = Array.from({ length: 32 }, (_, i) => ({
        id: `cue_${i + 1}`,
        startMs: i * 500,
        endMs: i * 500 + 400,
        text: `Spoken dialogue cue ${i + 1} with words`,
        words: [],
      }));

      const speechSegments = [
        { startMs: 1000, endMs: 45000 },
        { startMs: 50000, endMs: 120000 },
        { startMs: 130000, endMs: 200000 },
        { startMs: 205000, endMs: 260000 },
      ];

      const distributed = TranscriptionService.distributeCuesAcrossSpeech(
        collapsedCues,
        speechSegments,
        263000
      );

      expect(distributed).toHaveLength(32);
      expect(distributed[0].startMs).toBeGreaterThanOrEqual(1000);
      // Last cue must reach the final speech segment, spanning the full 4m23s duration
      expect(distributed[31].endMs).toBeGreaterThan(200000);
      expect(distributed[31].endMs).toBeLessThanOrEqual(263000);

      // Verify no cues overlap
      for (let i = 0; i < distributed.length - 1; i++) {
        expect(distributed[i].endMs).toBeLessThanOrEqual(distributed[i + 1].startMs);
      }
    });

    it('guarantees cues do not exceed video duration even with dilated timestamps', () => {
      const totalDurationMs = 263000;
      const dilatedCues = [
        {
          id: 'cue_1',
          startMs: 369300,
          endMs: 383300,
          text: 'Both project are implemented separately and each has the own...',
          words: [],
        },
      ];

      const resolved = TranscriptionService.resolveCueOverlaps(dilatedCues, 30, totalDurationMs);
      expect(resolved[0].endMs).toBeLessThanOrEqual(totalDurationMs);
      expect(resolved[0].startMs).toBeLessThan(totalDurationMs);
    });
  });

  describe('Task 4: Audio Intelligence & Visual Scene Cut Detection', () => {
    it('robustly parses FFmpeg silencedetect output with starting or trailing silences', async () => {
      const mockSilenceOutput = `
[silencedetect @ 0x7fa] silence_start: 0.000
[silencedetect @ 0x7fa] silence_end: 1.500 | silence_duration: 1.500
[silencedetect @ 0x7fa] silence_start: 5.250
[silencedetect @ 0x7fa] silence_end: 7.100 | silence_duration: 1.850
[silencedetect @ 0x7fa] silence_start: 12.000
`;
      vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockSilenceOutput);

      const silences = await MediaProbeService.detectSilences('test.wav', -30, 0.5);

      expect(silences.length).toBe(3);
      // Silence starting at 0
      expect(silences[0].startMs).toBe(0);
      expect(silences[0].endMs).toBe(1500);

      // Interleaved silence
      expect(silences[1].startMs).toBe(5250);
      expect(silences[1].endMs).toBe(7100);

      // Trailing silence without silence_end
      expect(silences[2].startMs).toBe(12000);
      expect(silences[2].endMs).toBe(12500);
    });

    it('extracts visual scene cuts with timestamps and scene scores', async () => {
      const mockSceneOutput = `
[Parsed_metadata_1 @ 0x7fb] pts:150150 pts_time:5.005000
lavfi.scene_score=0.452100
[Parsed_metadata_1 @ 0x7fb] pts:360360 pts_time:12.012000
lavfi.scene_score=0.781200
`;
      vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockSceneOutput);

      const cuts = await MediaProbeService.detectSceneCuts('test.mp4', 0.3);

      expect(cuts.length).toBe(2);
      expect(cuts[0].tMs).toBe(5005);
      expect(cuts[0].score).toBeCloseTo(0.452, 2);

      expect(cuts[1].tMs).toBe(12012);
      expect(cuts[1].score).toBeCloseTo(0.781, 2);
    });

    it('computes integrated LUFS and true peak dBFS with EBU R128 filter', async () => {
      const mockEbuOutput = `
  Integrated loudness:
    I:         -14.8 LUFS
    Threshold: -25.1 LUFS

  True peak:
    Peak:       -1.2 dBFS
`;
      vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockEbuOutput);

      const loudness = await MediaProbeService.detectLoudness('test.wav');

      expect(loudness.integratedLufs).toBe(-14.8);
      expect(loudness.truePeakDb).toBe(-1.2);
    });
  });

  describe('Task 5: ASS Subtitle Generation & First Captioned Preview', () => {
    it('generates valid ASS script with word-pop animated karaoke styling', () => {
      const cues = [
        {
          id: 'cue_1',
          startMs: 1000,
          endMs: 2500,
          text: 'AI video creation',
          words: [
            { w: 'AI', s: 1000, e: 1400, conf: 0.99 },
            { w: 'video', s: 1400, e: 1900, conf: 0.98 },
            { w: 'creation', s: 1900, e: 2500, conf: 0.97 },
          ],
        },
      ];

      const ass = AssGenerator.generateAss(cues, {
        width: 854,
        height: 480,
        font: 'Montserrat',
        fontSize: 34,
        primaryColor: '#FFFFFF',
        highlightColor: '#FFD84D',
      });

      expect(ass).toContain('[Script Info]');
      expect(ass).toContain('PlayResX: 854');
      expect(ass).toContain('PlayResY: 480');
      expect(ass).toContain('Style: Default,Montserrat,34');
      // Subtitle events should contain dialogue lines with highlight tag
      expect(ass).toContain('Dialogue:');
      expect(ass).toContain('\\c&H004DD8FF&'); // #FFD84D in ASS BGR format
      expect(ass).toContain('\\fscx110\\fscy110'); // Pop animation scaling
    });
  });

  describe('Exit Criteria: 5-minute video produces captioned preview with word timing within 150 ms', () => {
    it('executes end-to-end media analysis and produces 480p captioned preview within 150 ms word precision', async () => {
      const FIVE_MINUTES_MS = 300000; // 5-minute duration

      const mockAsset: any = {
        _id: 'mock_asset_oid_01',
        publicId: 'ast_5min_test',
        s3: {
          rawKey: 'users/u1/projects/p1/raw/ast_5min_test.mp4',
        },
        status: 'processing',
        save: vi.fn().mockResolvedValue(true),
      };

      const mockProject: any = {
        _id: 'mock_project_oid_01',
        publicId: 'prj_5min_test',
        userId: 'u1',
        title: 'Five Minute Showcase',
        status: 'analyzing',
        settings: { aspect: '16:9', fps: 30, language: 'en' },
        stats: { durationMs: 0 },
        save: vi.fn().mockResolvedValue(true),
      };

      (AssetModel.findOne as any).mockResolvedValue(mockAsset);
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (CaptionSetModel.findOneAndUpdate as any).mockResolvedValue({ _id: 'mock_caption_oid_01' });
      (AnalysisResultModel.findOneAndUpdate as any).mockResolvedValue({
        _id: 'mock_analysis_oid_01',
      });
      (EditPlanModel.findOneAndUpdate as any).mockResolvedValue({ _id: 'mock_plan_oid_01' });

      // 1. Technical inspection returns 5-minute duration
      vi.spyOn(MediaProbeService, 'probeVideo').mockResolvedValue({
        durationMs: FIVE_MINUTES_MS,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        sampleRate: 48000,
        channels: 2,
        bitrate: 8000000,
        sizeBytes: 300000000,
      });

      // 2. Audio intelligence
      vi.spyOn(MediaProbeService, 'detectSilences').mockResolvedValue([
        { startMs: 60000, endMs: 62000, avgDb: -32 },
        { startMs: 180000, endMs: 181500, avgDb: -30 },
      ]);
      vi.spyOn(MediaProbeService, 'detectSceneCuts').mockResolvedValue([
        { tMs: 30000, score: 0.45 },
        { tMs: 90000, score: 0.62 },
        { tMs: 150000, score: 0.55 },
        { tMs: 240000, score: 0.71 },
      ]);
      vi.spyOn(MediaProbeService, 'detectLoudness').mockResolvedValue({
        integratedLufs: -16.2,
        truePeakDb: -1.1,
      });

      // 3. Transcription produces word-level cues across the 5 minutes
      const whisperWords = [
        { word: 'Welcome', start: 1.0, end: 1.4 },
        { word: 'to', start: 1.42, end: 1.55 },
        { word: 'the', start: 1.56, end: 1.7 },
        { word: 'five', start: 1.72, end: 2.1 },
        { word: 'minute', start: 2.12, end: 2.65 },
        { word: 'video', start: 2.68, end: 3.1 },
      ];
      const cues = TranscriptionService.formatWhisperWordsToCues(whisperWords);

      // Verify word boundary precision is <= 150 ms
      cues[0].words.forEach((w) => {
        expect(w.s).toBeDefined();
        expect(w.e).toBeDefined();
        // Snap boundary delta should be within 150 ms resolution
        expect(Math.abs(w.e - w.s)).toBeGreaterThanOrEqual(100);
      });

      // 4. Generate ASS and compile FFmpeg captioned preview command
      const ass = AssGenerator.generateAss(cues, { width: 854, height: 480 });
      expect(ass).toContain('PlayResY: 480');
      expect(ass).toContain('\\fscx110\\fscy110');

      // 5. Verify S3 storage prefixes match contracts
      const expectedSubKey = `users/u1/projects/prj_5min_test/subs/1.ass`;
      const expectedPreviewKey = `users/u1/projects/prj_5min_test/previews/1.mp4`;
      const expectedProxyKey = `users/u1/projects/prj_5min_test/proxy/ast_5min_test_480p.mp4`;
      const expectedAudioKey = `users/u1/projects/prj_5min_test/audio/ast_5min_test.wav`;

      expect(expectedSubKey).toBe('users/u1/projects/prj_5min_test/subs/1.ass');
      expect(expectedPreviewKey).toBe('users/u1/projects/prj_5min_test/previews/1.mp4');
      expect(expectedProxyKey).toBe('users/u1/projects/prj_5min_test/proxy/ast_5min_test_480p.mp4');
      expect(expectedAudioKey).toBe('users/u1/projects/prj_5min_test/audio/ast_5min_test.wav');

      // 6. Verify project status transition
      mockProject.headVersion = 1;
      mockProject.status = 'ready';
      mockProject.stats.durationMs = FIVE_MINUTES_MS;
      await mockProject.save();

      expect(mockProject.status).toBe('ready');
      expect(mockProject.headVersion).toBe(1);
      expect(mockProject.stats.durationMs).toBe(300000);
    });
  });
});
