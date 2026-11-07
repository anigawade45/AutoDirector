import { describe, it, expect } from 'vitest';
import {
  RegressionClipService,
  SyncMetrics,
  EffectVerification,
} from '../services/compiler/regressionClips.js';
import { EditPlan, CompactAnalysisSummary } from '@ai-video/shared';

describe('Phase 5 Task 5: Regression Clips for Audio/Video Sync and Effect Correctness', () => {
  const createBaseAnalysis = (durationMs: number = 60000): CompactAnalysisSummary => ({
    durationMs,
    width: 1920,
    height: 1080,
    fps: 30,
    silences: [],
    sceneCuts: [],
    beats: { bpm: 120, grid: [] },
    loudness: { integratedLufs: -16, truePeakDb: -1.5 },
    transcriptExcerpt: [
      {
        startMs: 1000,
        endMs: 4000,
        text: 'Automated video creation platform',
        words: [
          { w: 'Automated', s: 1000, e: 1800, conf: 0.99 },
          { w: 'video', s: 1800, e: 2400, conf: 0.98 },
          { w: 'creation', s: 2400, e: 3200, conf: 0.99 },
          { w: 'platform', s: 3200, e: 4000, conf: 0.98 },
        ],
      },
    ] as any,
  });

  const createBasePlan = (): EditPlan => ({
    schemaVersion: '1.0',
    projectId: 'prj_regression_sync',
    baseAssetId: 'ast_regression_sync',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [],
    meta: {
      prompt: 'Audio/Video Sync & Effect Regression',
      model: 'gemini-1.5-pro',
      createdAt: new Date().toISOString(),
    },
  });

  describe('Scenario 1: Multiple Ripple Cuts & Silence Removal Sync', () => {
    it('maintains 0.000 ms A/V drift across 5 successive cuts and verifies exact segment boundaries', () => {
      const plan = createBasePlan();
      // 5 cut intervals across a 60-second asset
      plan.layers.push(
        { id: 'c1', layer: 'cut', enabled: true, timebase: 'source', range: { start: 5, end: 8 }, params: { reason: 'silence', padding: 0 } },
        { id: 'c2', layer: 'cut', enabled: true, timebase: 'source', range: { start: 14, end: 17 }, params: { reason: 'silence', padding: 0 } },
        { id: 'c3', layer: 'cut', enabled: true, timebase: 'source', range: { start: 25, end: 28 }, params: { reason: 'silence', padding: 0 } },
        { id: 'c4', layer: 'cut', enabled: true, timebase: 'source', range: { start: 38, end: 42 }, params: { reason: 'silence', padding: 0 } },
        { id: 'c5', layer: 'cut', enabled: true, timebase: 'source', range: { start: 50, end: 54 }, params: { reason: 'silence', padding: 0 } }
      );

      const analysis = createBaseAnalysis(60000);
      const report = RegressionClipService.runScenario('sc_1_cuts', 'Multiple Ripple Cuts', plan, analysis);

      // Verify A/V sync metrics
      expect(report.syncMetrics.driftMs).toBe(0);
      expect(report.syncMetrics.isWithinTolerance).toBe(true);

      // Total cut duration: (3 + 3 + 3 + 4 + 4) = 17s. Expected output = 60 - 17 = 43s
      expect(report.syncMetrics.videoDurationSec).toBe(43);
      expect(report.syncMetrics.audioDurationSec).toBe(43);

      // 6 segments joined with concat
      const filterStr = report.compilerResult.args.join(' ');
      expect(filterStr).toContain('concat=n=6:v=1:a=0[vc]');
      expect(filterStr).toContain('concat=n=6:v=0:a=1[ac]');
    });
  });

  describe('Scenario 2: Speed Ramps (Fast Motion & Slow Motion with Chained Atempo)', () => {
    it('maintains perfect A/V sync when fast-motion (3.0x) and slow-motion (0.4x) are chained', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // Segment 1: [0..10] at 3.0x speed -> 3.333s
        { id: 'c1', layer: 'cut', enabled: true, timebase: 'source', range: { start: 10, end: 12 }, params: { reason: 'user', padding: 0 } },
        { id: 'spd_fast', layer: 'speed', enabled: true, timebase: 'source', range: { start: 0, end: 10 }, params: { factor: 3.0, keepPitch: true } },
        // Segment 2: [12..20] at 0.4x speed -> 20.000s
        { id: 'spd_slow', layer: 'speed', enabled: true, timebase: 'source', range: { start: 12, end: 20 }, params: { factor: 0.4, keepPitch: true } }
      );

      const analysis = createBaseAnalysis(20000);
      const report = RegressionClipService.runScenario('sc_2_speed', 'Speed Ramps', plan, analysis);

      expect(report.syncMetrics.driftMs).toBe(0);
      expect(report.syncMetrics.isWithinTolerance).toBe(true);

      const filterStr = report.compilerResult.args.join(' ');
      // 3.0x speed video setpts and audio chained atempo
      expect(filterStr).toContain('setpts=(PTS-STARTPTS)/3.000');
      expect(filterStr).toContain('atempo=2.0,atempo=1.500');

      // 0.4x speed video setpts and audio chained atempo
      expect(filterStr).toContain('setpts=(PTS-STARTPTS)/0.400');
      expect(filterStr).toContain('atempo=0.5,atempo=0.800');
    });
  });

  describe('Scenario 3: Multi-Segment Chained Transitions (xfade & acrossfade)', () => {
    it('verifies cumulative offset tracking and paired acrossfade without drift', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // Cuts produce 4 segments: [0..10] (10s), [12..20] (8s), [22..30] (8s), [32..40] (8s)
        { id: 'c1', layer: 'cut', enabled: true, timebase: 'source', range: { start: 10, end: 12 }, params: { reason: 'user', padding: 0 } },
        { id: 'c2', layer: 'cut', enabled: true, timebase: 'source', range: { start: 20, end: 22 }, params: { reason: 'user', padding: 0 } },
        { id: 'c3', layer: 'cut', enabled: true, timebase: 'source', range: { start: 30, end: 32 }, params: { reason: 'user', padding: 0 } },
        // Transition 1 at 10s: dissolve 1.0s
        { id: 'tr1', layer: 'transition', enabled: true, timebase: 'source', range: { start: 10, end: 11 }, params: { type: 'dissolve', duration: 1.0, at: 10 } },
        // Transition 2 at 20s: slideup 0.5s
        { id: 'tr2', layer: 'transition', enabled: true, timebase: 'source', range: { start: 20, end: 20.5 }, params: { type: 'slideup', duration: 0.5, at: 20 } },
        // Transition 3 at 30s: fade 0.6s
        { id: 'tr3', layer: 'transition', enabled: true, timebase: 'source', range: { start: 30, end: 30.6 }, params: { type: 'fade', duration: 0.6, at: 30 } }
      );

      const analysis = createBaseAnalysis(40000);
      const report = RegressionClipService.runScenario('sc_3_transitions', 'Multi-Segment Chained Transitions', plan, analysis);

      expect(report.syncMetrics.driftMs).toBe(0);
      expect(report.syncMetrics.isWithinTolerance).toBe(true);
      expect(report.effectVerification.hasTransitions).toBe(true);

      const filterStr = report.compilerResult.args.join(' ');
      // Cumulative offsets:
      // Trans 1 offset: 10.0 - 1.0 = 9.000s
      expect(filterStr).toContain('xfade=transition=dissolve:duration=1.000:offset=9.000');
      // Stream dur after trans 1: 10.0 + 8.0 - 1.0 = 17.0s. Trans 2 offset: 17.0 - 0.5 = 16.500s
      expect(filterStr).toContain('xfade=transition=slideup:duration=0.500:offset=16.500');
      // Stream dur after trans 2: 17.0 + 8.0 - 0.5 = 24.5s. Trans 3 offset: 24.5 - 0.6 = 23.900s
      expect(filterStr).toContain('xfade=transition=fade:duration=0.600:offset=23.900');

      // Matching acrossfades
      expect(filterStr).toContain('acrossfade=d=1.000:c1=tri:c2=tri');
      expect(filterStr).toContain('acrossfade=d=0.500:c1=tri:c2=tri');
      expect(filterStr).toContain('acrossfade=d=0.600:c1=tri:c2=tri');
    });
  });

  describe('Scenario 4: Full Production Pipeline (Intro + Cuts + Transitions + Color + Subtitles + Outro + Music)', () => {
    it('executes the full composition pipeline and asserts complete effect correctness and 0.000 ms drift', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // 1. Intro Template
        { id: 'l_intro', layer: 'intro', enabled: true, timebase: 'output', range: { start: 0, end: 5 }, params: { template: 'cinematic', duration: 5, text: 'Regression Intro' } },
        // 2. Cut & Transition
        { id: 'l_cut', layer: 'cut', enabled: true, timebase: 'source', range: { start: 10, end: 12 }, params: { reason: 'user', padding: 0 } },
        { id: 'l_trans', layer: 'transition', enabled: true, timebase: 'source', range: { start: 10, end: 10.5 }, params: { type: 'dissolve', duration: 0.5, at: 10 } },
        // 3. Color preset: warm
        { id: 'l_col', layer: 'color', enabled: true, timebase: 'global', params: { preset: 'warm', contrast: 1.05, saturation: 1.15 } },
        // 4. Subtitle: word_pop
        { id: 'l_sub', layer: 'subtitle', enabled: true, timebase: 'source', params: { style: 'word_pop', position: 'bottom', primaryColor: '#FFFFFF', highlightColor: '#FFD84D' } },
        // 5. Audio normalization
        { id: 'l_aud', layer: 'audio', enabled: true, timebase: 'global', params: { normalizeLufs: -16, denoise: false } },
        // 6. Background music with ducking
        { id: 'l_mus', layer: 'music', enabled: true, timebase: 'output', params: { trackId: 'track_1', volume: 0.3, duckUnderSpeech: true } },
        // 7. Outro Template
        { id: 'l_outro', layer: 'outro', enabled: true, timebase: 'output', range: { start: 0, end: 4 }, params: { template: 'credits', duration: 4, text: 'Regression Outro' } }
      );

      const analysis = createBaseAnalysis(30000);
      const report = RegressionClipService.runScenario('sc_4_full', 'Full Production Pipeline', plan, analysis, 'final_1080p', {
        musicSourcePath: 'bg_music.mp3',
        assSubtitlePath: 'subtitles.ass',
      });

      // 1. Sync Invariant
      expect(report.syncMetrics.driftMs).toBe(0);
      expect(report.syncMetrics.isWithinTolerance).toBe(true);

      // 2. Effect Correctness Invariants
      expect(report.effectVerification.hasColorFilter).toBe(true);
      expect(report.effectVerification.hasSubtitles).toBe(true);
      expect(report.effectVerification.hasAudioNormalization).toBe(true);
      expect(report.effectVerification.hasMusicDucking).toBe(true);
      expect(report.effectVerification.hasTransitions).toBe(true);
      expect(report.effectVerification.hasIntroOutro).toBe(true);
      expect(report.effectVerification.hasDimensionFpsNormalization).toBe(true);

      // 3. Subtitle file generation
      expect(report.compilerResult.assFiles).toHaveLength(1);
      expect(report.compilerResult.assFiles[0].content).toContain('[Script Info]');
      expect(report.compilerResult.assFiles[0].content).toContain('\\fscx110\\fscy110');
    });
  });

  describe('Scenario 5: Multi-Framerate Grid Parity (24, 25, 30, 60 fps)', () => {
    it('verifies that frame-grid alignment prevents sub-frame rounding drift across all standard broadcast frame rates', () => {
      const frameRates: Array<24 | 25 | 30 | 60> = [24, 25, 30, 60];

      for (const fps of frameRates) {
        const plan = createBasePlan();
        plan.global.fps = fps;
        plan.layers.push(
          { id: 'cut_fps', layer: 'cut', enabled: true, timebase: 'source', range: { start: 8.333, end: 12.666 }, params: { reason: 'user', padding: 0 } },
          { id: 'tr_fps', layer: 'transition', enabled: true, timebase: 'source', range: { start: 8.333, end: 8.833 }, params: { type: 'fade', duration: 0.5, at: 8.333 } }
        );

        const analysis = createBaseAnalysis(25000);
        analysis.fps = fps;

        const report = RegressionClipService.runScenario(`sc_5_fps_${fps}`, `${fps} FPS Grid Sync`, plan, analysis);

        // Even across diverse framerates, drift must be strictly <= 40 ms
        expect(report.syncMetrics.driftMs).toBeLessThanOrEqual(40);
        expect(report.syncMetrics.isWithinTolerance).toBe(true);
      }
    });
  });

  describe('Scenario 6: Cross-Aspect Ratio Normalization (16:9, 9:16, 1:1, 4:5)', () => {
    it('correctly adapts canvas geometry and maintains zero A/V drift across all social media aspect ratios', () => {
      const aspects: Array<{ aspect: '16:9' | '9:16' | '1:1' | '4:5'; expectedRes: string }> = [
        { aspect: '16:9', expectedRes: '1920x1080' },
        { aspect: '9:16', expectedRes: '1080x1920' },
        { aspect: '1:1', expectedRes: '1080x1080' },
        { aspect: '4:5', expectedRes: '1080x1350' },
      ];

      for (const { aspect, expectedRes } of aspects) {
        const plan = createBasePlan();
        plan.global.aspect = aspect;
        plan.layers.push(
          { id: 'intro_asp', layer: 'intro', enabled: true, timebase: 'output', range: { start: 0, end: 3 }, params: { template: 'title', duration: 3 } },
          { id: 'outro_asp', layer: 'outro', enabled: true, timebase: 'output', range: { start: 0, end: 3 }, params: { template: 'credits', duration: 3 } }
        );

        const analysis = createBaseAnalysis(20000);
        const report = RegressionClipService.runScenario(`sc_6_${aspect}`, `${aspect} Aspect Ratio`, plan, analysis, 'final_1080p');

        expect(report.syncMetrics.driftMs).toBe(0);
        expect(report.syncMetrics.isWithinTolerance).toBe(true);

        const filterStr = report.compilerResult.args.join(' ');
        expect(filterStr).toContain(`s=${expectedRes}`);
      }
    });
  });
});
