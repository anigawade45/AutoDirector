import { describe, it, expect, vi } from 'vitest';
import { PlanNormalizer } from '../services/planner/planNormalizer.js';
import { PatchEngine } from '../services/planner/patchEngine.js';
import { PlannerService } from '../services/planner/plannerService.js';
import { PlannerProvider, PlannerProviderInput, PlannerProviderOutput } from '../services/planner/plannerProvider.interface.js';
import { EditPlan, EditPlanSchema } from '@ai-video/shared';
import { AppError } from '../middleware/errorHandler.js';

describe('Phase 4: Plan Normalizer, Patch Engine & Planner Service', () => {
  const dummyCatalog = {
    templates: [{ id: 'cinematic', name: 'Cinematic' }],
    luts: [
      { id: 'teal_orange', name: 'Teal & Orange' },
      { id: 'vintage_warm', name: 'Vintage Warm' },
    ],
    music: [
      { id: 'tpl_lofi_beat', name: 'Chill Lofi', mood: 'chill' },
      { id: 'tpl_upbeat_synth', name: 'Upbeat Synth', mood: 'upbeat' },
    ],
    fonts: ['Montserrat', 'Inter', 'Roboto'],
  };

  describe('PlanNormalizer', () => {
    it('clamps numeric parameters to strictly allowed ranges (Spec §3.3 & §3.7)', () => {
      const rawPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_test',
        version: 1,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: {
              contrast: 2.5, // exceeds 1.5 -> clamp to 1.5
              brightness: -0.9, // below -0.3 -> clamp to -0.3
              saturation: 4.0, // exceeds 2.0 -> clamp to 2.0
              vignette: 1.8, // exceeds 1.0 -> clamp to 1.0
              grain: 0.9, // exceeds 0.5 -> clamp to 0.5
            },
          },
          {
            id: 'lyr_s1',
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: {
              style: 'word_pop',
              size: 150, // exceeds 96 -> clamp to 96
              maxWordsPerLine: 15, // exceeds 8 -> clamp to 8
              position: 'bottom',
            },
          },
          {
            id: 'lyr_spd1',
            layer: 'speed',
            enabled: true,
            timebase: 'source',
            range: { start: 0, end: 60 },
            params: {
              factor: 10.0, // exceeds 4.0 -> clamp to 4.0
              keepPitch: true,
            },
          },
          {
            id: 'lyr_int1',
            layer: 'intro',
            enabled: true,
            timebase: 'output',
            range: { start: 0, end: 20 },
            params: {
              template: 'cinematic',
              duration: 25, // exceeds 10s -> clamp to 10
            },
          },
        ],
      };

      const normalized = PlanNormalizer.normalize(rawPlan, {
        assetDurationSec: 60,
        catalog: dummyCatalog,
      });

      const colorLayer = normalized.layers.find((l: any) => l.layer === 'color');
      expect(colorLayer.params.contrast).toBe(1.5);
      expect(colorLayer.params.brightness).toBe(-0.3);
      expect(colorLayer.params.saturation).toBe(2.0);
      expect(colorLayer.params.vignette).toBe(1.0);
      expect(colorLayer.params.grain).toBe(0.5);

      const subLayer = normalized.layers.find((l: any) => l.layer === 'subtitle');
      expect(subLayer.params.size).toBe(96);
      expect(subLayer.params.maxWordsPerLine).toBe(8);

      const spdLayer = normalized.layers.find((l: any) => l.layer === 'speed');
      expect(spdLayer.params.factor).toBe(4.0);

      const introLayer = normalized.layers.find((l: any) => l.layer === 'intro');
      expect(introLayer.params.duration).toBe(10);
      expect(introLayer.range.end).toBe(10);

      // Verify the normalized plan strictly parses with Zod
      expect(() => EditPlanSchema.parse(normalized)).not.toThrow();
    });

    it('resolves unknown catalog references to catalog defaults (Spec §3.7 #3)', () => {
      const rawPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_test',
        baseAssetId: 'ast_test',
        version: 1,
        layers: [
          {
            id: 'lyr_c1',
            layer: 'color',
            params: { lut: 'unknown_alien_lut' },
          },
          {
            id: 'lyr_s1',
            layer: 'subtitle',
            params: { font: 'Comic Sans MS' },
          },
          {
            id: 'lyr_i1',
            layer: 'intro',
            params: { template: 'non_existent_template' },
          },
          {
            id: 'lyr_m1',
            layer: 'music',
            params: { trackId: 'unknown_heavy_metal' },
          },
        ],
      };

      const normalized = PlanNormalizer.normalize(rawPlan, {
        assetDurationSec: 60,
        catalog: dummyCatalog,
      });

      const colorLayer = normalized.layers.find((l: any) => l.layer === 'color');
      expect(colorLayer.params.lut).toBe('teal_orange'); // Resolved to catalog default

      const subLayer = normalized.layers.find((l: any) => l.layer === 'subtitle');
      expect(subLayer.params.font).toBe('Montserrat'); // Resolved to catalog font

      const introLayer = normalized.layers.find((l: any) => l.layer === 'intro');
      expect(introLayer.params.template).toBe('cinematic'); // Resolved to catalog template

      const musicLayer = normalized.layers.find((l: any) => l.layer === 'music');
      expect(musicLayer.params.trackId).toBe('tpl_lofi_beat'); // Resolved to catalog music
    });

    it('merges overlapping cut intervals into contiguous keep segments (Spec §3.7 #4)', () => {
      const cuts = [
        {
          id: 'c1',
          layer: 'cut',
          range: { start: 5, end: 10 },
          params: { reason: 'silence', padding: 0.05 },
        },
        {
          id: 'c2',
          layer: 'cut',
          range: { start: 8, end: 14 },
          params: { reason: 'silence', padding: 0.1 },
        },
        {
          id: 'c3',
          layer: 'cut',
          range: { start: 20, end: 25 },
          params: { reason: 'silence', padding: 0.05 },
        },
      ];

      const merged = PlanNormalizer.mergeOverlappingCuts(cuts);
      expect(merged).toHaveLength(2);
      expect(merged[0].range.start).toBe(5);
      expect(merged[0].range.end).toBe(14); // 5-10 and 8-14 merged into 5-14
      expect(merged[1].range.start).toBe(20);
      expect(merged[1].range.end).toBe(25);
    });

    it('enforces footage preservation budget (max 40% cut unless explicitly requested) (Spec §3.7 #5 & §3.8)', () => {
      // 100-second video: 40% is 40 seconds
      const cuts = [
        { id: 'c1', range: { start: 0, end: 30 } }, // 30s
        { id: 'c2', range: { start: 40, end: 65 } }, // 25s (total 55s > 40s)
      ];

      // Standard prompt without keywords: cuts should be bounded to 40s
      const bounded = PlanNormalizer.enforceCutDurationBudget(cuts, 100, false);
      const totalCutSec = bounded.reduce((acc, c) => acc + (c.range.end - c.range.start), 0);
      expect(totalCutSec).toBeLessThanOrEqual(40);

      // Aggressive prompt (e.g. "Create a fast summary trailer"): preservation cap relaxed
      const allowed = PlanNormalizer.enforceCutDurationBudget(cuts, 100, true);
      const totalAllowed = allowed.reduce((acc, c) => acc + (c.range.end - c.range.start), 0);
      expect(totalAllowed).toBe(55);
    });
  });

  describe('PatchEngine', () => {
    const basePlan: EditPlan = {
      schemaVersion: '1.0',
      projectId: 'prj_abc',
      baseAssetId: 'ast_xyz',
      version: 1,
      parentVersion: null,
      global: { aspect: '16:9', fps: 30, resolution: '1080p' },
      layers: [
        {
          id: 'lyr_col_1',
          layer: 'color',
          enabled: true,
          timebase: 'global',
          params: { preset: 'cinematic', contrast: 1.15, saturation: 0.95 },
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
        prompt: 'Initial plan',
        model: 'test-model',
        createdAt: new Date().toISOString(),
      },
    };

    it('applies RFC 6902 patch with layer ID paths (Spec §3.6)', () => {
      const patches: any[] = [
        { op: 'replace', path: '/layers/lyr_sub_1/params/size', value: 72 },
        { op: 'replace', path: '/global/aspect', value: '9:16' },
      ];

      const { patchedPlan, normalizedPatches } = PatchEngine.apply(basePlan, patches);

      expect(normalizedPatches[0].path).toBe('/layers/1/params/size');
      expect(patchedPlan.layers[1].params.size).toBe(72);
      expect(patchedPlan.global.aspect).toBe('9:16');
      expect(patchedPlan.layers[0].params.preset).toBe('cinematic'); // Preserved untouched
    });

    it('applies add and remove operations accurately', () => {
      const patches: any[] = [
        { op: 'remove', path: '/layers/lyr_col_1' },
        {
          op: 'add',
          path: '/layers/-',
          value: {
            id: 'lyr_mus_1',
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: { trackId: 'tpl_lofi_beat', volume: 0.25 },
          },
        },
      ];

      const { patchedPlan } = PatchEngine.apply(basePlan, patches);

      expect(patchedPlan.layers.some((l: any) => l.layer === 'color')).toBe(false);
      expect(patchedPlan.layers.some((l: any) => l.layer === 'music')).toBe(true);
      expect(patchedPlan.layers.find((l: any) => l.layer === 'music').params.volume).toBe(0.25);
    });
  });

  describe('PlannerService', () => {
    it('successfully plans an initial prompt and returns valid EditPlan', async () => {
      const service = new PlannerService();
      const result = await service.plan(
        'Make this video cinematic with word pop subtitles',
        'prj_123',
        'ast_456',
        0,
        {
          durationMs: 60000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [{ tMs: 12000, score: 0.6 }],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        dummyCatalog
      );

      expect(result.plan).toBeDefined();
      expect(result.plan.schemaVersion).toBe('1.0');
      expect(result.plan.version).toBe(1);
      expect(result.plan.parentVersion).toBeNull();
      expect(result.repairAttempts).toBe(0);
      expect(result.plan.layers.length).toBeGreaterThan(0);
    });

    it('successfully applies one automatic repair retry when initial LLM output has schema errors', async () => {
      let callCount = 0;
      const mockAdapter: PlannerProvider = {
        async generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
          callCount++;
          if (callCount === 1) {
            // Attempt 1: invalid schema (string instead of array for layers)
            return {
              provider: 'gemini',
              model: 'test-model',
              structuredOutput: {
                schemaVersion: '1.0',
                projectId: 'prj_1',
                baseAssetId: 'ast_1',
                version: 1,
                layers: 'NOT_AN_ARRAY', // Will fail EditPlanSchema parse
              },
            };
          } else {
            // Attempt 2 (repair retry): valid schema
            return {
              provider: 'gemini',
              model: 'test-model',
              structuredOutput: {
                schemaVersion: '1.0',
                projectId: 'prj_1',
                baseAssetId: 'ast_1',
                version: 1,
                global: { aspect: '16:9', fps: 30, resolution: '1080p' },
                layers: [
                  {
                    id: 'lyr_c1',
                    layer: 'color',
                    enabled: true,
                    timebase: 'global',
                    params: { preset: 'cinematic', contrast: 1.1, saturation: 1.0 },
                  },
                ],
                meta: { prompt: 'Cinematic', model: 'test-model', createdAt: new Date().toISOString() },
              },
            };
          }
        },
      };

      const service = new PlannerService(mockAdapter);
      const result = await service.plan(
        'Make it cinematic',
        'prj_1',
        'ast_1',
        0,
        {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        dummyCatalog
      );

      expect(callCount).toBe(2);
      expect(result.repairAttempts).toBe(1);
      expect(result.plan.layers[0].layer).toBe('color');
    });

    it('rejects with friendly 422 PLAN_VALIDATION_ERROR if repair retry also fails (API Contract §4.1 & §7.2)', async () => {
      const mockFailingAdapter: PlannerProvider = {
        async generateEditPlan(): Promise<PlannerProviderOutput> {
          // Both attempt 1 and attempt 2 return invalid data
          return {
            provider: 'gemini',
            model: 'test-model',
            structuredOutput: {
              schemaVersion: 'INVALID',
              layers: 'INVALID',
            },
          };
        },
      };

      const service = new PlannerService(mockFailingAdapter);

      await expect(
        service.plan(
          'Make it cinematic',
          'prj_1',
          'ast_1',
          0,
          {
            durationMs: 30000,
            width: 1920,
            height: 1080,
            fps: 30,
            silences: [],
            sceneCuts: [],
            beats: { bpm: 120, grid: [] },
            loudness: { integratedLufs: -16, truePeakDb: -1.5 },
            transcriptExcerpt: [],
          },
          dummyCatalog
        )
      ).rejects.toThrow(AppError);

      try {
        await service.plan(
          'Make it cinematic',
          'prj_1',
          'ast_1',
          0,
          {
            durationMs: 30000,
            width: 1920,
            height: 1080,
            fps: 30,
            silences: [],
            sceneCuts: [],
            beats: { bpm: 120, grid: [] },
            loudness: { integratedLufs: -16, truePeakDb: -1.5 },
            transcriptExcerpt: [],
          },
          dummyCatalog
        );
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('PLAN_VALIDATION_ERROR');
      }
    });
  });
});

