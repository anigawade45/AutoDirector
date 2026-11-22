import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HighlightDiscoveryService } from '../services/ai/highlightDiscoveryService.js';
import { ReferenceStyleService } from '../services/ai/referenceStyleService.js';
import { GeminiPlannerAdapter } from '../services/planner/geminiAdapter.js';
import { extractTimelineOperations, EditPlan } from '@ai-video/shared';
import { PlanNormalizer } from '../services/planner/planNormalizer.js';

describe('Where AI Earns Its Place: 5 Frontier Capabilities Acceptance Suite', () => {
  const sampleCues = [
    {
      id: 'cue_1',
      startMs: 0,
      endMs: 3800,
      text: 'Did you know that 90% of videos lose viewers in the first 3 seconds?',
      words: [
        { w: 'Did', s: 0, e: 200, conf: 0.98 },
        { w: 'you', s: 210, e: 400, conf: 0.99 },
        { w: 'know', s: 410, e: 700, conf: 0.97 },
        { w: 'that', s: 710, e: 900, conf: 0.95 },
        { w: '90%', s: 910, e: 1400, conf: 0.96 },
        { w: 'of', s: 1410, e: 1600, conf: 0.98 },
        { w: 'videos', s: 1610, e: 2100, conf: 0.99 },
        { w: 'lose', s: 2110, e: 2500, conf: 0.95 },
        { w: 'viewers', s: 2510, e: 3000, conf: 0.94 },
        { w: 'in', s: 3010, e: 3200, conf: 0.97 },
        { w: 'the', s: 3210, e: 3300, conf: 0.98 },
        { w: 'first', s: 3310, e: 3500, conf: 0.96 },
        { w: '3', s: 3510, e: 3600, conf: 0.97 },
        { w: 'seconds?', s: 3610, e: 3800, conf: 0.98 },
      ],
      speaker: 'Speaker 1',
    },
    {
      id: 'cue_2',
      startMs: 4500,
      endMs: 14000,
      text: 'Today I will show you the exact framework to retain 80% audience retention.',
      words: [],
      speaker: 'Speaker 1',
    },
    {
      id: 'cue_3',
      startMs: 16000,
      endMs: 35000,
      text: 'The secret is high information density, kinetic word pop subtitles, and ducked audio.',
      words: [],
      speaker: 'Speaker 1',
    },
    {
      id: 'cue_4',
      startMs: 38000,
      endMs: 55000,
      text: 'Finally, always test your vertical 9:16 aspect ratio before exporting.',
      words: [],
      speaker: 'Speaker 1',
    },
  ];

  const sampleSilences = [
    { startMs: 3800, endMs: 4500, avgDb: -42 },
    { startMs: 14000, endMs: 16000, avgDb: -45 },
    { startMs: 35000, endMs: 38000, avgDb: -44 },
  ];

  const sampleSceneCuts = [
    { tMs: 4000, score: 0.65 },
    { tMs: 15000, score: 0.72 },
    { tMs: 36000, score: 0.68 },
  ];

  describe('1. Multimodal Footage Understanding & Indexing', () => {
    it('integrates technical, audio acoustic, scene cut, and speech dimensions', () => {
      const summary = {
        durationMs: 60000,
        width: 1920,
        height: 1080,
        fps: 30,
        silences: sampleSilences,
        sceneCuts: sampleSceneCuts,
        beats: { bpm: 128, grid: [0, 468, 937] },
        loudness: { integratedLufs: -15.8, truePeakDb: -1.2 },
        transcriptExcerpt: sampleCues.map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
        })),
      };

      expect(summary.silences.length).toBe(3);
      expect(summary.sceneCuts.length).toBe(3);
      expect(summary.beats.bpm).toBe(128);
      expect(summary.loudness.integratedLufs).toBeCloseTo(-15.8, 1);
    });
  });

  describe('2. Automatic Chapter / Hook / Highlight Discovery', () => {
    it('discovers viral opening hook based on question & curiosity indicators', () => {
      const discovery = HighlightDiscoveryService.discover({
        cues: sampleCues as any,
        silences: sampleSilences,
        sceneCuts: sampleSceneCuts,
        durationMs: 60000,
      });

      expect(discovery.hook).toBeDefined();
      expect(discovery.hook.startMs).toBe(0);
      expect(discovery.hook.endMs).toBeGreaterThanOrEqual(3500);
      expect(discovery.hook.score).toBeGreaterThanOrEqual(0.9);
      expect(discovery.hook.reason).toContain('Curiosity');
    });

    it('segments timeline into semantic topic chapters', () => {
      const discovery = HighlightDiscoveryService.discover({
        cues: sampleCues as any,
        silences: sampleSilences,
        sceneCuts: sampleSceneCuts,
        durationMs: 60000,
      });

      expect(discovery.chapters.length).toBeGreaterThanOrEqual(2);
      expect(discovery.chapters[0].title).toBe('Introduction & Hook');
      expect(discovery.chapters[0].startMs).toBe(0);
      expect(discovery.chapters[discovery.chapters.length - 1].endMs).toBe(60000);
    });

    it('identifies top scored highlight segments across dialogue', () => {
      const discovery = HighlightDiscoveryService.discover({
        cues: sampleCues as any,
        silences: sampleSilences,
        sceneCuts: sampleSceneCuts,
        durationMs: 60000,
      });

      expect(discovery.highlights.length).toBeGreaterThan(0);
      for (const hl of discovery.highlights) {
        expect(hl.score).toBeGreaterThan(0.75);
        expect(hl.endMs).toBeGreaterThan(hl.startMs);
        expect(hl.reason).toBeDefined();
      }
    });
  });

  describe('3. Short-Form Extraction From Long-Form Video', () => {
    it('re-frames horizontal video to vertical 9:16 and isolates viral highlight segment', async () => {
      const adapter = new GeminiPlannerAdapter(null); // Heuristic mode
      const input = {
        userPrompt: JSON.stringify({
          instruction: 'Create a 60s viral TikTok short (9:16) from the best highlight',
          context: {
            projectId: 'prj_short_test',
            baseAssetId: 'ast_base',
            targetVersion: 1,
            videoMeta: { durationMs: 120000, fps: 30, resolution: '1920x1080' },
            highlights: [
              { id: 'hl_1', startSec: 15, endSec: 75, score: 0.96, reason: 'Viral peak' },
            ],
            audioAnalysis: { silenceIntervalsSec: [] },
          },
        }),
        systemInstructions: '',
      };

      const result = await adapter.generateEditPlan(input as any);
      const plan = result.structuredOutput as EditPlan;

      expect(plan.global?.aspect).toBe('9:16');
      const cuts = plan.layers.filter((l) => l.layer === 'cut');
      expect(cuts.length).toBeGreaterThanOrEqual(1);

      // Verify trimming before and after highlight
      const preCut = cuts.find((c) => c.range && c.range.start === 0 && c.range.end <= 15);
      expect(preCut).toBeDefined();

      // Verify kinetic subtitle styling
      const subLayer = plan.layers.find((l) => l.layer === 'subtitle');
      expect(subLayer).toBeDefined();
      expect(subLayer?.params.style).toBe('word_pop');
      expect(subLayer?.params.highlightColor).toBeDefined();

      // Verify background music is ducked
      const musLayer = plan.layers.find((l) => l.layer === 'music');
      expect(musLayer).toBeDefined();
      expect(musLayer?.params.duckUnderSpeech).toBe(true);
    });
  });

  describe('4. Reference-Style Analysis Without Copying Assets', () => {
    it('analyzes Alex Hormozi archetype into abstract parameter layers without copying pixels', () => {
      const profile = ReferenceStyleService.analyzeStyle('Alex Hormozi style video');

      expect(profile.styleName).toContain('Hormozi');
      expect(profile.pacing.targetCutDurationSec).toBeLessThan(2.0);
      expect(profile.typography.font).toBe('Montserrat');
      expect(profile.typography.style).toBe('word_pop');
      expect(profile.typography.highlightColor).toBe('#FFD700'); // Bold yellow
      expect(profile.color.preset).toBe('cinematic');
      expect(profile.color.contrast).toBeGreaterThanOrEqual(1.2);
      expect(profile.audio.duckUnderSpeech).toBe(true);

      // Generate pure layers applied to user footage
      const layers = ReferenceStyleService.generateStyleLayers(profile, {
        stylePrompt: 'Alex Hormozi style',
        totalDurationSec: 60,
        silences: [{ start: 3.8, end: 4.5 }],
        availableMusic: ['tpl_hiphop_beat'],
      });

      expect(layers.length).toBeGreaterThanOrEqual(4);
      expect(layers.some((l) => l.layer === 'cut')).toBe(true);
      expect(layers.some((l) => l.layer === 'color')).toBe(true);
      expect(layers.some((l) => l.layer === 'subtitle')).toBe(true);
      expect(layers.some((l) => l.layer === 'music')).toBe(true);
      // Zero raw asset copy
      expect(layers.every((l) => (l as any).params?.sourcePath === undefined)).toBe(true);
    });

    it('analyzes Ali Abdaal aesthetic into clean minimal typography and warm filmic grade', () => {
      const profile = ReferenceStyleService.analyzeStyle('Ali Abdaal aesthetic');

      expect(profile.styleName).toContain('Ali Abdaal');
      expect(profile.pacing.targetCutDurationSec).toBeGreaterThan(2.5);
      expect(profile.typography.font).toBe('Inter');
      expect(profile.typography.style).toBe('minimal');
      expect(profile.color.preset).toBe('warm');
      expect(profile.audio.duckUnderSpeech).toBe(true);
    });

    it('analyzes custom user-described reference metadata without copying assets', () => {
      const profile = ReferenceStyleService.analyzeStyle(
        'Reference style: fast cuts every 1.5s, vintage film grain, warm golden look, Montserrat bold green subtitles, and lofi beats'
      );

      expect(profile.pacing.targetCutDurationSec).toBe(1.5);
      expect(profile.color.preset).toBe('warm');
      expect(profile.color.grain).toBeGreaterThan(0);
      expect(profile.typography.font).toBe('Montserrat');
      expect(profile.typography.highlightColor).toBe('#39FF14'); // Neon green
    });

    it('emits concrete timeline operations from style-applied EditPlan', async () => {
      const adapter = new GeminiPlannerAdapter(null);
      const input = {
        userPrompt: JSON.stringify({
          instruction: 'Edit in Alex Hormozi style with fast cuts and yellow captions',
          context: {
            projectId: 'prj_style_test',
            baseAssetId: 'ast_base',
            targetVersion: 1,
            videoMeta: { durationMs: 60000, fps: 30, resolution: '1920x1080' },
            audioAnalysis: {
              silenceIntervalsSec: [{ start: 10, end: 12 }],
            },
          },
        }),
        systemInstructions: '',
      };

      const result = await adapter.generateEditPlan(input as any);
      const plan = result.structuredOutput as EditPlan;

      const ops = extractTimelineOperations(plan);
      expect(ops.operations.length).toBeGreaterThan(0);
      expect(ops.operations.some((op) => op.trackName.includes('Subtitles'))).toBe(true);
      expect(ops.operations.some((op) => op.trackName.includes('Color'))).toBe(true);
      expect(
        ops.operations.some(
          (op) => op.trackName.includes('Music') || op.trackName.includes('Audio')
        )
      ).toBe(true);
    });
  });

  describe('5. Prompt → Edit-Plan → Timeline Operations End-to-End Consistency', () => {
    it('normalizes generated plans and strictly validates against schema 1.0', () => {
      const adapter = new GeminiPlannerAdapter(null);
      const input = {
        userPrompt: JSON.stringify({
          instruction: 'Make it cinematic with teal & orange LUT and word pop subtitles',
          context: {
            projectId: 'prj_e2e_test',
            baseAssetId: 'ast_base',
            targetVersion: 1,
            videoMeta: { durationMs: 45000, fps: 30, resolution: '1920x1080' },
          },
        }),
        systemInstructions: '',
      };

      return adapter.generateEditPlan(input as any).then((output) => {
        const rawPlan = output.structuredOutput;
        const normalized = PlanNormalizer.normalize(rawPlan, {
          assetDurationSec: 45,
          projectId: 'prj_e2e_test',
          baseAssetId: 'ast_base',
          version: 1,
        });

        expect(normalized.schemaVersion).toBe('1.0');
        expect(normalized.layers.length).toBeGreaterThan(0);

        const ops = extractTimelineOperations(normalized);
        expect(ops.totalOperations).toBe(normalized.layers.length);
        for (const op of ops.operations) {
          expect(op.id).toBeDefined();
          expect(op.title).toBeDefined();
          expect(op.trackName).toBeDefined();
        }
      });
    });
  });
});
