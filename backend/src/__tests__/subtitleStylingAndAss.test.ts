import { describe, it, expect } from 'vitest';
import { AssGenerator } from '../services/compiler/assGenerator.js';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { CaptionCue, EditPlan } from '@ai-video/shared';

describe('Phase 5 Task 3: Subtitle Styling & ASS Generation with Per-Word Timing/Animation', () => {
  const sampleCues: CaptionCue[] = [
    {
      id: 'cue_1',
      startMs: 1000,
      endMs: 4000,
      text: 'Welcome to the future of generative video',
      words: [
        { w: 'Welcome', s: 1000, e: 1500, conf: 0.99 },
        { w: 'to', s: 1500, e: 1800, conf: 0.98 },
        { w: 'the', s: 1800, e: 2100, conf: 0.99 },
        { w: 'future', s: 2100, e: 2600, conf: 0.97 },
        { w: 'of', s: 2600, e: 2900, conf: 0.98 },
        { w: 'generative', s: 2900, e: 3500, conf: 0.99 },
        { w: 'video', s: 3500, e: 4000, conf: 0.98 },
      ],
    },
  ];

  describe('Color Conversion & ASS Sanitization (Spec §4.8)', () => {
    it('converts RGB hex to ASS BGR format accurately', () => {
      // #FFFFFF -> &H00FFFFFF&
      expect(AssGenerator.hexToAssColor('#FFFFFF')).toBe('&H00FFFFFF&');
      // #FFD84D (R=FF, G=D8, B=4D) -> BGR is 4D D8 FF -> &H004DD8FF&
      expect(AssGenerator.hexToAssColor('#FFD84D')).toBe('&H004DD8FF&');
      // #000000 -> &H00000000&
      expect(AssGenerator.hexToAssColor('#000000')).toBe('&H00000000&');
      // Alpha support
      expect(AssGenerator.hexToAssColor('#FFFFFF', '80')).toBe('&H80FFFFFF&');
    });

    it('escapes braces and backslashes to prevent ASS tag injection attacks (Spec §4.8)', () => {
      const malicious = 'Test {\\an8\\fs100\\c&H0000FF&} injection attack \\path';
      const escaped = AssGenerator.escapeAssText(malicious);

      expect(escaped).not.toContain('{\\an8');
      expect(escaped).toContain('\\{\\\\an8');
      expect(escaped).toContain('\\}');
      expect(escaped).toContain('\\\\path');
    });

    it('formats millisecond timestamps to standard ASS H:MM:SS.CC centiseconds', () => {
      expect(AssGenerator.formatAssTime(0)).toBe('0:00:00.00');
      expect(AssGenerator.formatAssTime(1500)).toBe('0:00:01.50');
      expect(AssGenerator.formatAssTime(65430)).toBe('0:01:05.43');
      expect(AssGenerator.formatAssTime(3661250)).toBe('1:01:01.25');
    });
  });

  describe('Word Pagination & maxWordsPerLine Chunking (Spec §3.3)', () => {
    it('chunks a 7-word cue into readable lines of at most 4 words', () => {
      const ass = AssGenerator.generateAss(sampleCues, {
        style: 'classic',
        maxWordsPerLine: 4,
      });

      // 7 words with maxWordsPerLine 4 produces 2 chunks:
      // Chunk 1: "Welcome to the future" (words 0..3)
      // Chunk 2: "of generative video" (words 4..6)
      const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      expect(dialogues).toHaveLength(2);

      expect(dialogues[0]).toContain('Welcome to the future');
      expect(dialogues[1]).toContain('of generative video');

      // Check chunk 1 timing: start = 1000ms (0:00:01.00), end = 2600ms (0:00:02.60)
      expect(dialogues[0]).toContain('0:00:01.00,0:00:02.60');
      // Check chunk 2 timing: start = 2600ms (0:00:02.60), end = 4000ms (0:00:04.00)
      expect(dialogues[1]).toContain('0:00:02.60,0:00:04.00');
    });
  });

  describe('Word-Pop Animation Style (Spec §3.3 & §4.4)', () => {
    it('generates word-pop highlighting and scaling for each active word in sequence', () => {
      const ass = AssGenerator.generateAss(sampleCues, {
        style: 'word_pop',
        primaryColor: '#FFFFFF',
        highlightColor: '#FFD84D',
        maxWordsPerLine: 4,
      });

      const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      // Chunk 1 has 4 words -> 4 dialogue events
      // Chunk 2 has 3 words -> 3 dialogue events
      // Total 7 dialogue events
      expect(dialogues).toHaveLength(7);

      // In the first dialogue event: "Welcome" is active (highlighted + scaled 110%)
      expect(dialogues[0]).toContain('{\\c&H004DD8FF&\\fscx110\\fscy110}Welcome{\\r}');
      expect(dialogues[0]).toContain('{\\c&H00FFFFFF&\\fscx100\\fscy100}to{\\r}');

      // In the second dialogue event: "to" is active
      expect(dialogues[1]).toContain('{\\c&H00FFFFFF&\\fscx100\\fscy100}Welcome{\\r}');
      expect(dialogues[1]).toContain('{\\c&H004DD8FF&\\fscx110\\fscy110}to{\\r}');
    });
  });

  describe('Karaoke Style with \\kf Tags (Spec §3.3 & §4.4)', () => {
    it('generates smooth karaoke \\kf tags with accurate centisecond timing', () => {
      const ass = AssGenerator.generateAss(sampleCues, {
        style: 'karaoke',
        maxWordsPerLine: 4,
      });

      const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      expect(dialogues).toHaveLength(2); // 2 chunks

      // "Welcome" is 1000ms to 1500ms = 500ms = 50 centiseconds -> \kf50
      expect(dialogues[0]).toContain('{\\kf50}Welcome');
      // "to" is 1500ms to 1800ms = 300ms = 30 centiseconds -> \kf30
      expect(dialogues[0]).toContain('{\\kf30}to');
      // "the" is 1800ms to 2100ms = 300ms = 30 centiseconds -> \kf30
      expect(dialogues[0]).toContain('{\\kf30}the');
      // "future" is 2100ms to 2600ms = 500ms = 50 centiseconds -> \kf50
      expect(dialogues[0]).toContain('{\\kf50}future');

      // Includes fade in/out tag
      expect(dialogues[0]).toContain('{\\fad(60,60)}');
    });
  });

  describe('Positions & Alignments (Spec §3.3)', () => {
    it('sets correct ASS alignment and vertical margins for bottom, center, and top', () => {
      const bottomAss = AssGenerator.generateAss(sampleCues, { position: 'bottom', height: 1080 });
      // Alignment 2 = bottom-center, MarginV = 86 (8% of 1080)
      expect(bottomAss).toContain('Alignment, MarginL, MarginR, MarginV');
      expect(bottomAss).toContain(',2,30,30,86,1');

      const centerAss = AssGenerator.generateAss(sampleCues, { position: 'center', height: 1080 });
      // Alignment 5 = middle-center, MarginV = 0
      expect(centerAss).toContain(',5,30,30,0,1');

      const topAss = AssGenerator.generateAss(sampleCues, { position: 'top', height: 1080 });
      // Alignment 8 = top-center, MarginV = 86
      expect(topAss).toContain(',8,30,30,86,1');
    });
  });

  describe('Minimal Style with Bounding Box Background (Spec §3.3)', () => {
    it('configures minimal style with borderStyle 3 and fade tags', () => {
      const ass = AssGenerator.generateAss(sampleCues, { style: 'minimal' });

      // BorderStyle 3 = opaque box / translucent box
      expect(ass).toContain(',0,0,0,100,100,0,0,3,1,0,');
      // Dialogue events include gentle fade
      expect(ass).toContain('{\\fad(100,100)}');
    });
  });

  describe('Integration with FFmpegCompiler Pass 4B', () => {
    it('compiles subtitle ASS file and injects subtitles filter into FFmpeg args', () => {
      const plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_sub_test',
        baseAssetId: 'ast_sub_test',
        version: 1,
        parentVersion: null,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_s1',
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: {
              style: 'karaoke',
              font: 'Montserrat',
              size: 56,
              position: 'bottom',
              primaryColor: '#FFFFFF',
              highlightColor: '#FFD84D',
              maxWordsPerLine: 4,
            },
          },
        ],
        meta: { prompt: 'Subtitles test', model: 'test', createdAt: new Date().toISOString() },
      };

      const result = FFmpegCompiler.compile(
        plan,
        {
          durationMs: 10000,
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
              endMs: 3000,
              text: 'Animated karaoke caption test',
            },
          ],
        },
        'final_1080p',
        {
          assSubtitlePath: 'custom_subs.ass',
        }
      );

      // Verify generated ASS file
      expect(result.assFiles).toHaveLength(1);
      expect(result.assFiles[0].filename).toBe('subtitles.ass');
      expect(result.assFiles[0].content).toContain('[Script Info]');
      expect(result.assFiles[0].content).toContain('Montserrat');
      expect(result.assFiles[0].content).toContain('{\\kf'); // Karaoke tags

      // Verify FFmpeg filter complex argument
      const filterComplex = result.args[result.args.indexOf('-filter_complex') + 1];
      expect(filterComplex).toContain("subtitles='custom_subs.ass'[vsubs]");
    });
  });
});
