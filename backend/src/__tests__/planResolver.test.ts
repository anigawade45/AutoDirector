import { describe, it, expect } from 'vitest';
import { PlanResolver } from '../services/resolver/planResolver.js';
import { EditPlan, EditPlanSchema } from '@ai-video/shared';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { AssGenerator } from '../services/compiler/assGenerator.js';
import { env } from '../config/env.js';

describe('EditPlan & PlanResolver Pipeline', () => {
  const samplePlan: EditPlan = {
    schemaVersion: '1.0',
    projectId: 'prj_test_123',
    baseAssetId: 'ast_base_456',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [
      {
        id: 'lyr_cut_1',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 2.0, end: 4.5 },
        params: { reason: 'silence', padding: 0.05 },
      },
      {
        id: 'lyr_col_1',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset: 'cinematic',
          contrast: 1.15,
          saturation: 0.9,
          vignette: 0.3,
        },
      },
      {
        id: 'lyr_sub_1',
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
    meta: {
      prompt: 'Test prompt',
      model: 'gemini-1.5-pro',
      createdAt: new Date().toISOString(),
    },
  };

  it('validates a correct EditPlan using EditPlanSchema', () => {
    const parse = EditPlanSchema.safeParse(samplePlan);
    if (!parse.success) {
      console.log('Validation errors:', JSON.stringify(parse.error.format(), null, 2));
    }
    expect(parse.success).toBe(true);
  });

  it('rejects an invalid cut layer where end is less than start', () => {
    const invalidPlan = {
      ...samplePlan,
      layers: [
        {
          id: 'lyr_bad_cut',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 5.0, end: 3.0 },
          params: { reason: 'silence' },
        },
      ],
    };
    const parse = EditPlanSchema.safeParse(invalidPlan);
    expect(parse.success).toBe(false);
  });

  it('resolves an EditPlan into a valid Timeline with video and subtitle tracks', () => {
    const timeline = PlanResolver.resolve({
      plan: samplePlan,
      assetDurationMs: 10000, // 10 seconds
      captionSetId: 'cap_123',
    });

    expect(timeline.projectId).toBe('prj_test_123');
    expect(timeline.fps).toBe(30);
    expect(timeline.tracks.length).toBeGreaterThanOrEqual(1);

    const videoTrack = timeline.tracks.find((t) => t.kind === 'video');
    expect(videoTrack).toBeDefined();
    // 10s video with a cut from 2.0 to 4.5s should have 2 segments: [0..2.0] and [4.5..10.0]
    expect(videoTrack?.clips.length).toBe(2);

    const subTrack = timeline.tracks.find((t) => t.kind === 'subtitle');
    expect(subTrack).toBeDefined();
    expect(subTrack?.clips[0].captionSetId).toBe('cap_123');
  });

  it('compiles deterministic FFmpeg argument arrays without errors', () => {
    const result = FFmpegCompiler.compile(
      samplePlan,
      {
        durationMs: 10000,
        width: 1920,
        height: 1080,
        fps: 30,
        silences: [],
        sceneCuts: [],
        beats: { bpm: 120, grid: [] },
        loudness: { integratedLufs: -16, truePeakDb: -1.5 },
        transcriptExcerpt: [],
      },
      'preview_480p',
      {
        inputSourcePath: 'test_source.mp4',
        outputPath: 'test_output.mp4',
      }
    );

    expect(result.args).toContain('-y');
    expect(result.args).toContain('test_source.mp4');
    expect(result.args).toContain('test_output.mp4');
    expect(result.args).toContain('-filter_complex');
  });

  it('generates word-pop animated ASS subtitles', () => {
    const cues = [
      {
        id: 'cue_1',
        startMs: 1000,
        endMs: 3000,
        text: 'Hello world',
        words: [
          { w: 'Hello', s: 1000, e: 2000, conf: 0.99 },
          { w: 'world', s: 2000, e: 3000, conf: 0.98 },
        ],
      },
    ];

    const ass = AssGenerator.generateAss(cues, {
      font: 'Inter',
      fontSize: 48,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFD84D',
    });

    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Dialogue:');
    expect(ass).toContain('Hello');
    expect(ass).toContain('world');
  });
});
