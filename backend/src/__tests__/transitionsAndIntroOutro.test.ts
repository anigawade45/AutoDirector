import { describe, it, expect } from 'vitest';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { EditPlan, CompactAnalysisSummary } from '@ai-video/shared';

describe('Phase 5 Task 4: Transitions (xfade/acrossfade), Intro/Outro Templates & Dimension/FPS Normalization', () => {
  const baseAnalysis: CompactAnalysisSummary = {
    durationMs: 30000, // 30 seconds
    width: 1920,
    height: 1080,
    fps: 30,
    silences: [],
    sceneCuts: [{ tMs: 10000, score: 0.8 }],
    beats: { bpm: 120, grid: [] },
    loudness: { integratedLufs: -16, truePeakDb: -1.5 },
    transcriptExcerpt: [],
  };

  const createBasePlan = (): EditPlan => ({
    schemaVersion: '1.0',
    projectId: 'prj_trans_test',
    baseAssetId: 'ast_trans_test',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [],
    meta: {
      prompt: 'Transition and intro/outro test',
      model: 'gemini-1.5-pro',
      createdAt: new Date().toISOString(),
    },
  });

  describe('Transitions with xfade & acrossfade (Spec §4.4 & Plan Phase 5 Task 4)', () => {
    it('generates paired xfade and acrossfade filters between two keep-segments', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // Segment 1: [0..10], Segment 2: [12..30]
        {
          id: 'cut_1',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 10, end: 12 },
          params: { reason: 'user', padding: 0 },
        },
        // Transition at boundary 10s: dissolve 0.5s
        {
          id: 'tr_1',
          layer: 'transition',
          enabled: true,
          timebase: 'source',
          range: { start: 10, end: 10.5 },
          params: { type: 'dissolve', duration: 0.5, at: 10.0 },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      // Seg 0 duration: 10s. Transition dur: 0.5s -> offset: 9.5s
      expect(filterStr).toContain('xfade=transition=dissolve:duration=0.500:offset=9.500');
      // Audio acrossfade duration: 0.5s with tri curve
      expect(filterStr).toContain('acrossfade=d=0.500:c1=tri:c2=tri');
      // Outputs mapped to [xv_0_0] and [xa_0_0]
      expect(filterStr).toContain('[xv_0_0]');
      expect(filterStr).toContain('[xa_0_0]');
    });

    it('supports all 5 transition types: fade, dissolve, wipeleft, slideup, zoom (mapped to zoomin)', () => {
      const types = [
        { in: 'fade', expected: 'fade' },
        { in: 'dissolve', expected: 'dissolve' },
        { in: 'wipeleft', expected: 'wipeleft' },
        { in: 'slideup', expected: 'slideup' },
        { in: 'zoom', expected: 'zoomin' },
      ];

      for (const t of types) {
        const plan = createBasePlan();
        plan.layers.push(
          {
            id: 'cut_1',
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: { start: 10, end: 12 },
            params: { reason: 'user', padding: 0 },
          },
          {
            id: 'tr_1',
            layer: 'transition',
            enabled: true,
            timebase: 'source',
            range: { start: 10, end: 10.8 },
            params: { type: t.in as any, duration: 0.8, at: 10.0 },
          }
        );

        const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
        const filterStr = result.args.join(' ');
        expect(filterStr).toContain(`xfade=transition=${t.expected}:duration=0.800`);
      }
    });

    it('correctly calculates cumulative offsets across chained multi-segment transitions', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // Cut at 10..12 -> seg 0 is 10s [0..10]
        {
          id: 'cut_1',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 10, end: 12 },
          params: { reason: 'user', padding: 0 },
        },
        // Cut at 20..22 -> seg 1 is 8s [12..20], seg 2 is 8s [22..30]
        {
          id: 'cut_2',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 20, end: 22 },
          params: { reason: 'user', padding: 0 },
        },
        // Transition 1 at 10s: dur 1.0s
        {
          id: 'tr_1',
          layer: 'transition',
          enabled: true,
          timebase: 'source',
          range: { start: 10, end: 11 },
          params: { type: 'dissolve', duration: 1.0, at: 10.0 },
        },
        // Transition 2 at 20s: dur 0.5s
        {
          id: 'tr_2',
          layer: 'transition',
          enabled: true,
          timebase: 'source',
          range: { start: 20, end: 20.5 },
          params: { type: 'fade', duration: 0.5, at: 20.0 },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      // Seg 0 is 10.0s. Trans 1 is 1.0s -> offset 0 = 10.0 - 1.0 = 9.0s
      expect(filterStr).toContain('xfade=transition=dissolve:duration=1.000:offset=9.000');
      // Stream duration after trans 1: 10.0 + 8.0 - 1.0 = 17.0s
      // Seg 1 is 8.0s. Trans 2 is 0.5s -> offset 1 = 17.0 - 0.5 = 16.5s
      expect(filterStr).toContain('xfade=transition=fade:duration=0.500:offset=16.500');
    });

    it('handles mixed sequences with both transitions and hard cuts via group concatenation', () => {
      const plan = createBasePlan();
      plan.layers.push(
        // 3 cuts producing 4 segments: [0..5], [6..12], [13..18], [19..30]
        {
          id: 'cut_1',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 5, end: 6 },
          params: { reason: 'user', padding: 0 },
        },
        {
          id: 'cut_2',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 12, end: 13 },
          params: { reason: 'user', padding: 0 },
        },
        {
          id: 'cut_3',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 18, end: 19 },
          params: { reason: 'user', padding: 0 },
        },
        // Only ONE transition between seg 0 and seg 1 at 5s; seg 1-2 and seg 2-3 are hard cuts
        {
          id: 'tr_1',
          layer: 'transition',
          enabled: true,
          timebase: 'source',
          range: { start: 5, end: 5.5 },
          params: { type: 'dissolve', duration: 0.5, at: 5.0 },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      // xfade between seg 0 and seg 1
      expect(filterStr).toContain('xfade=transition=dissolve:duration=0.500:offset=4.500');
      // Group 0 [xv_0_0], Group 1 [v2], Group 2 [v3] are joined with concat
      expect(filterStr).toContain('concat=n=3:v=1:a=0[vc]');
      expect(filterStr).toContain('concat=n=3:v=0:a=1[ac]');
    });
  });

  describe('Intro & Outro Templates & Normalization (Plan Phase 5 Task 4)', () => {
    it('generates synthetic intro and outro templates with normalized dimensions, fps, and silent audio', () => {
      const plan = createBasePlan();
      plan.layers.push(
        {
          id: 'intro_1',
          layer: 'intro',
          enabled: true,
          timebase: 'output',
          range: { start: 0, end: 4 },
          params: {
            template: 'title_card',
            duration: 4,
            text: 'Welcome to AI Video',
            theme: '#1E1E2E',
          },
        },
        {
          id: 'outro_1',
          layer: 'outro',
          enabled: true,
          timebase: 'output',
          range: { start: 0, end: 3 },
          params: {
            template: 'credits',
            duration: 3,
            text: 'Thank You For Watching',
            theme: '#0F172A',
          },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      // Intro video: synthetic color + drawtext + format=yuv420p
      expect(filterStr).toContain('color=c=0x1E1E2E:s=1920x1080:r=30:d=4.000,format=yuv420p');
      expect(filterStr).toContain("drawtext=text='Welcome to AI Video'");
      expect(filterStr).toContain('[v_intro]');

      // Intro audio: anullsrc
      expect(filterStr).toContain('anullsrc=r=44100:cl=stereo,atrim=0:4.000,asetpts=PTS-STARTPTS[a_intro]');

      // Outro video & audio
      expect(filterStr).toContain('color=c=0x0F172A:s=1920x1080:r=30:d=3.000,format=yuv420p');
      expect(filterStr).toContain("drawtext=text='Thank You For Watching'");
      expect(filterStr).toContain('[v_outro]');
      expect(filterStr).toContain('anullsrc=r=44100:cl=stereo,atrim=0:3.000,asetpts=PTS-STARTPTS[a_outro]');

      // All elements concatenated: [v_intro][v0][v_outro]
      expect(filterStr).toContain('[v_intro][v0][v_outro]concat=n=3:v=1:a=0[vc]');
      expect(filterStr).toContain('[a_intro][a0][a_outro]concat=n=3:v=0:a=1[ac]');
    });

    it('normalizes pre-rendered external intro and outro media files to target dimensions and fps', () => {
      const plan = createBasePlan();
      plan.layers.push(
        {
          id: 'intro_pre',
          layer: 'intro',
          enabled: true,
          timebase: 'output',
          range: { start: 0, end: 5 },
          params: { template: 'custom', duration: 5 },
        },
        {
          id: 'outro_pre',
          layer: 'outro',
          enabled: true,
          timebase: 'output',
          range: { start: 0, end: 4 },
          params: { template: 'custom', duration: 4 },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p', {
        inputSourcePath: 'source.mp4',
        introSourcePath: 'intro_clip.mp4',
        outroSourcePath: 'outro_clip.mp4',
      });

      // Inputs array includes source, intro, and outro
      expect(result.inputs).toHaveLength(3);
      expect(result.inputs[0].key).toBe('source.mp4');
      expect(result.inputs[1].key).toBe('intro_clip.mp4');
      expect(result.inputs[2].key).toBe('outro_clip.mp4');

      const filterStr = result.args.join(' ');
      // Normalization scale and pad to 480p (854x480)
      expect(filterStr).toContain('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p');
      // Audio normalization to 44.1kHz stereo
      expect(filterStr).toContain('aformat=sample_rates=44100:channel_layouts=stereo');
    });

    it('correctly adapts normalization dimensions for 9:16 vertical video profile', () => {
      const plan = createBasePlan();
      plan.global.aspect = '9:16';
      plan.layers.push({
        id: 'intro_vertical',
        layer: 'intro',
        enabled: true,
        timebase: 'output',
        range: { start: 0, end: 3 },
        params: { template: 'title_card', duration: 3, text: 'Shorts Intro' },
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      // 9:16 1080p resolution is 1080x1920
      expect(filterStr).toContain('s=1080x1920:r=30:d=3.000');
    });
  });
});

