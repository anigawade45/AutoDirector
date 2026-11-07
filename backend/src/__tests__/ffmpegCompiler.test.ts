import { describe, it, expect } from 'vitest';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { EditPlan, CompactAnalysisSummary } from '@ai-video/shared';

describe('Phase 3 Task 2: Pure FFmpeg Compiler compile(plan, analysis, profile)', () => {
  const baseAnalysis: CompactAnalysisSummary = {
    durationMs: 30000, // 30 seconds
    width: 1920,
    height: 1080,
    fps: 30,
    silences: [{ startMs: 5000, endMs: 8000, avgDb: -32 }],
    sceneCuts: [{ tMs: 12000, score: 0.45 }],
    beats: { bpm: 120, grid: [] },
    loudness: { integratedLufs: -16.2, truePeakDb: -1.1 },
    transcriptExcerpt: [
      { startMs: 1000, endMs: 4500, text: 'Hello and welcome to the show' },
      { startMs: 9000, endMs: 14000, text: 'Here is our automated video preview' },
    ],
  };

  const createBasePlan = (): EditPlan => ({
    schemaVersion: '1.0',
    projectId: 'prj_compiler_test',
    baseAssetId: 'ast_compiler_test',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [],
    meta: {
      prompt: 'Baseline compile test',
      model: 'test',
      createdAt: new Date().toISOString(),
    },
  });

  it('is a strictly pure and deterministic function', () => {
    const plan = createBasePlan();
    const result1 = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p');
    const result2 = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p');

    expect(result1.args).toEqual(result2.args);
    expect(result1.inputs).toEqual(result2.inputs);
    expect(result1.assFiles).toEqual(result2.assFiles);
  });

  describe('Pass 1: Segment Build & Cuts', () => {
    it('applies cut layers, merges overlapping cut ranges, and produces keep-segments', () => {
      const plan = createBasePlan();
      plan.layers.push(
        {
          id: 'cut_1',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 5, end: 10 },
          params: { reason: 'silence', padding: 0 },
        },
        // Overlapping cut (9 to 14)
        {
          id: 'cut_2',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 9, end: 14 },
          params: { reason: 'silence', padding: 0 },
        }
      );

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');

      // The cuts 5..10 and 9..14 merge into 5..14
      // Keep segments: [0..5] and [14..30]
      const filterStr = result.args.join(' ');
      expect(filterStr).toContain('trim=0:5');
      expect(filterStr).toContain('trim=14:30');
      expect(filterStr).toContain('concat=n=2:v=1:a=0');
      expect(filterStr).toContain('concat=n=2:v=0:a=1');
    });
  });

  describe('Pass 2: Speed adjustments & atempo chaining', () => {
    it('adjusts setpts and atempo when speed layer is enabled', () => {
      const plan = createBasePlan();
      plan.layers.push({
        id: 'speed_1',
        layer: 'speed',
        enabled: true,
        timebase: 'source',
        range: { start: 0, end: 30 },
        params: { factor: 1.5, keepPitch: true },
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p');
      const filterStr = result.args.join(' ');

      expect(filterStr).toContain('setpts=(PTS-STARTPTS)/1.500');
      expect(filterStr).toContain('atempo=1.500');
    });

    it('chains multiple atempo filters when factor exceeds 2.0', () => {
      const plan = createBasePlan();
      plan.layers.push({
        id: 'speed_fast',
        layer: 'speed',
        enabled: true,
        timebase: 'source',
        range: { start: 0, end: 30 },
        params: { factor: 3.0, keepPitch: true },
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p');
      const filterStr = result.args.join(' ');

      // Factor 3.0 requires chaining: atempo=2.0,atempo=1.500
      expect(filterStr).toContain('atempo=2.0,atempo=1.500');
    });
  });

  describe('Pass 4: Color Grading & Subtitles (ASS)', () => {
    it('applies color grading parameters and vignette', () => {
      const plan = createBasePlan();
      plan.layers.push({
        id: 'col_1',
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
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p');
      const filterStr = result.args.join(' ');

      expect(filterStr).toContain('eq=contrast=1.15:saturation=0.9:brightness=0');
      expect(filterStr).toContain('vignette=PI*0.075');
    });

    it('generates .ass subtitle content with word-pop karaoke tags and burns into video', () => {
      const plan = createBasePlan();
      plan.layers.push({
        id: 'sub_1',
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
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p', {
        assSubtitlePath: 'custom_subs.ass',
      });

      // Validates assFiles array has generated subtitle content
      expect(result.assFiles.length).toBe(1);
      expect(result.assFiles[0].filename).toBe('subtitles.ass');
      expect(result.assFiles[0].content).toContain('[Script Info]');
      expect(result.assFiles[0].content).toContain('PlayResY: 1080');
      expect(result.assFiles[0].content).toContain('\\fscx110\\fscy110');

      // Validates filter graph contains subtitles filter
      const filterStr = result.args.join(' ');
      expect(filterStr).toContain("subtitles='custom_subs.ass'");
    });
  });

  describe('Pass 5: Music Ducking & Loudness Normalization', () => {
    it('adds music input, applies sidechain ducking under dialogue, and runs EBU R128 loudnorm', () => {
      const plan = createBasePlan();
      plan.layers.push({
        id: 'mus_1',
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          volume: 0.35,
          duckUnderSpeech: true,
          fadeIn: 1.5,
          fadeOut: 3.0,
          beatSync: false,
        },
      });

      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p', {
        musicSourcePath: 'background.mp3',
      });

      // Expect music added to inputs and -i flags
      expect(result.inputs).toEqual([
        { key: 'source.mp4', type: 'video' },
        { key: 'background.mp3', type: 'audio' },
      ]);
      expect(result.args).toContain('background.mp3');

      // Expect sidechain compression ducking & amix
      const filterStr = result.args.join(' ');
      expect(filterStr).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400');
      expect(filterStr).toContain('amix=inputs=2:normalize=0');
      expect(filterStr).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    });
  });

  describe('Pass 6: Profiles (preview_480p, final_1080p, final_4k)', () => {
    it('compiles 480p preview profile flags', () => {
      const plan = createBasePlan();
      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'preview_480p', {
        outputPath: 'preview.mp4',
      });

      expect(result.args).toContain('-s');
      expect(result.args).toContain('854x480');
      expect(result.args).toContain('-preset');
      expect(result.args).toContain('veryfast');
      expect(result.args).toContain('-crf');
      expect(result.args).toContain('28');
      expect(result.args).toContain('preview.mp4');
    });

    it('compiles 1080p final export profile flags', () => {
      const plan = createBasePlan();
      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_1080p', {
        outputPath: 'export_1080p.mp4',
      });

      expect(result.args).toContain('-s');
      expect(result.args).toContain('1920x1080');
      expect(result.args).toContain('-preset');
      expect(result.args).toContain('medium');
      expect(result.args).toContain('-crf');
      expect(result.args).toContain('18');
      expect(result.args).toContain('export_1080p.mp4');
    });

    it('compiles 4k final export profile flags', () => {
      const plan = createBasePlan();
      const result = FFmpegCompiler.compile(plan, baseAnalysis, 'final_4k', {
        outputPath: 'export_4k.mp4',
      });

      expect(result.args).toContain('-s');
      expect(result.args).toContain('3840x2160');
      expect(result.args).toContain('384k');
      expect(result.args).toContain('export_4k.mp4');
    });
  });
});

