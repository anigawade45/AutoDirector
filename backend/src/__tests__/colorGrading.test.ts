import { describe, it, expect } from 'vitest';
import {
  resolveColorParams,
  buildFfmpegColorFilter,
  computeColorCssFilter,
  hasVisibleColorChange,
  COLOR_PRESETS,
  ColorPreset,
  EditPlan,
} from '@ai-video/shared';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { PlanNormalizer } from '../services/planner/planNormalizer.js';

describe('Phase 5 Task 2: Color Presets & Numeric Controls (Brightness, Contrast, Saturation, LUT, Vignette, Grain)', () => {
  describe('Color Presets Parameter Resolution', () => {
    const presets: ColorPreset[] = ['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded'];

    it('resolves all 6 color presets to their documented default values (Spec §3.3 & constants)', () => {
      for (const preset of presets) {
        const resolved = resolveColorParams({ preset });
        const expected = COLOR_PRESETS[preset];

        expect(resolved.preset).toBe(preset);
        expect(resolved.contrast).toBe(expected.contrast);
        expect(resolved.saturation).toBe(expected.saturation);
        expect(resolved.brightness).toBe(expected.brightness);
        expect(resolved.vignette).toBe(expected.vignette);
        expect(resolved.grain).toBe(expected.grain);
        if ('lut' in expected) {
          expect(resolved.lut).toBe((expected as any).lut);
        }
      }
    });

    it('allows numeric controls to override individual preset parameters', () => {
      // Start with 'cinematic', but override contrast, brightness, vignette, and grain
      const resolved = resolveColorParams({
        preset: 'cinematic',
        contrast: 1.35,
        brightness: 0.1,
        vignette: 0.5,
        grain: 0.25,
      });

      expect(resolved.preset).toBe('cinematic');
      expect(resolved.contrast).toBe(1.35); // Overridden
      expect(resolved.brightness).toBe(0.1); // Overridden
      expect(resolved.vignette).toBe(0.5); // Overridden
      expect(resolved.grain).toBe(0.25); // Overridden
      expect(resolved.saturation).toBe(0.9); // Preserved from cinematic preset
      expect(resolved.lut).toBe('teal_orange'); // Preserved from cinematic preset
    });

    it('strictly clamps numeric controls to bounded ranges (Spec §3.3 & §3.7)', () => {
      const resolved = resolveColorParams({
        contrast: 3.5, // max 1.5
        brightness: -0.9, // min -0.3
        saturation: 5.0, // max 2.0
        vignette: 2.2, // max 1.0
        grain: 1.0, // max 0.5
      });

      expect(resolved.contrast).toBe(1.5);
      expect(resolved.brightness).toBe(-0.3);
      expect(resolved.saturation).toBe(2.0);
      expect(resolved.vignette).toBe(1.0);
      expect(resolved.grain).toBe(0.5);

      const resolvedLow = resolveColorParams({
        contrast: 0.2, // min 0.7
        brightness: 0.8, // max 0.3
        saturation: -1.0, // min 0.0
        vignette: -0.5, // min 0.0
        grain: -0.2, // min 0.0
      });

      expect(resolvedLow.contrast).toBe(0.7);
      expect(resolvedLow.brightness).toBe(0.3);
      expect(resolvedLow.saturation).toBe(0.0);
      expect(resolvedLow.vignette).toBe(0.0);
      expect(resolvedLow.grain).toBe(0.0);
    });
  });

  describe('FFmpeg Video Filter Complex Generation', () => {
    it('builds standard eq filter for primary color adjustments', () => {
      const filter = buildFfmpegColorFilter({
        contrast: 1.25,
        saturation: 1.1,
        brightness: -0.05,
      });

      expect(filter).toBe('eq=contrast=1.25:saturation=1.1:brightness=-0.05');
    });

    it('attaches 3D LUT filter when LUT file path is provided', () => {
      const filter = buildFfmpegColorFilter(
        { preset: 'cinematic', lut: 'teal_orange' },
        { lutPath: 'C:/assets/luts/teal_orange.cube' }
      );

      // Colons escaped for FFmpeg filter graph syntax
      expect(filter).toContain("lut3d='C\\:/assets/luts/teal_orange.cube'");
      expect(filter).toContain('eq=contrast=1.15:saturation=0.9:brightness=0');
    });

    it('attaches vignette filter when vignette > 0', () => {
      const filter = buildFfmpegColorFilter({ vignette: 0.4 });
      // vignette = 0.4 -> angle = 0.4 * 0.25 = 0.1
      expect(filter).toContain('vignette=PI*0.1');
    });

    it('attaches temporal film grain noise filter when grain > 0', () => {
      const filter = buildFfmpegColorFilter({ grain: 0.2 });
      // grain = 0.2 -> noise = round(0.2 * 40) = 8
      expect(filter).toContain('noise=alls=8:allf=t');
    });

    it('compiles full composite color grade in FFmpegCompiler Pass 4A', () => {
      const plan: EditPlan = {
        schemaVersion: '1.0',
        projectId: 'prj_col_test',
        baseAssetId: 'ast_col_test',
        version: 1,
        parentVersion: null,
        global: { aspect: '16:9', fps: 30, resolution: '1080p' },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: {
              preset: 'cinematic',
              contrast: 1.2,
              vignette: 0.3,
              grain: 0.15,
            },
          },
        ],
        meta: { prompt: 'Color test', model: 'test', createdAt: new Date().toISOString() },
      };

      const result = FFmpegCompiler.compile(
        plan,
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
        'preview_480p',
        {
          lutPath: 'luts/teal_orange.cube',
        }
      );

      const filterComplex = result.args[result.args.indexOf('-filter_complex') + 1];
      expect(filterComplex).toContain('eq=contrast=1.2:saturation=0.9:brightness=0');
      expect(filterComplex).toContain("lut3d='luts/teal_orange.cube'");
      expect(filterComplex).toContain('vignette=PI*0.075');
      expect(filterComplex).toContain('noise=alls=6:allf=t');
      expect(filterComplex).toContain('[vcolor]');
    });
  });

  describe('Real-Time Client Preview CSS & Canvas Approximation (Spec §5.5)', () => {
    it('computes CSS filter and radial vignette gradient for real-time preview', () => {
      const preview = computeColorCssFilter({
        preset: 'cinematic',
        contrast: 1.15,
        saturation: 0.9,
        brightness: 0.05,
        vignette: 0.3,
      });

      expect(preview.cssFilter).toContain('contrast(115%)');
      expect(preview.cssFilter).toContain('saturate(90%)');
      expect(preview.cssFilter).toContain('brightness(105%)');
      expect(preview.vignetteGradient).toBe(
        'radial-gradient(circle, transparent 50%, rgba(0,0,0,0.30) 100%)'
      );
      expect(preview.vignetteOpacity).toBe(0.3);
    });

    it('emits grayscale(100%) for black-and-white (bw) preset', () => {
      const preview = computeColorCssFilter({ preset: 'bw' });
      expect(preview.cssFilter).toContain('grayscale(100%)');
      expect(preview.cssFilter).toContain('contrast(130%)');
    });
  });

  describe('Acceptance Criterion: Color Preset Visibly Changes Frames (Spec §9 & Phase 5)', () => {
    it('verifies that every color preset produces a measurable visible change from neutral video', () => {
      const presets: ColorPreset[] = ['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded'];

      for (const preset of presets) {
        const hasChange = hasVisibleColorChange({ preset });
        expect(hasChange).toBe(true);

        const resolved = resolveColorParams({ preset });
        // At least one dimension differs from identity (contrast != 1 or sat != 1 or brightness != 0 or vignette > 0)
        const isDifferent =
          resolved.contrast !== 1.0 ||
          resolved.saturation !== 1.0 ||
          resolved.brightness !== 0.0 ||
          resolved.vignette > 0 ||
          resolved.grain > 0;
        expect(isDifferent).toBe(true);
      }
    });

    it('returns false for completely neutral/untouched settings', () => {
      expect(
        hasVisibleColorChange({
          contrast: 1.0,
          saturation: 1.0,
          brightness: 0.0,
          vignette: 0.0,
          grain: 0.0,
        })
      ).toBe(false);
    });
  });
});

