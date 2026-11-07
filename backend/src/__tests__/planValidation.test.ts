import { describe, it, expect } from 'vitest';
import { validateEditPlan, snapPlanToFrameGrid, EditPlan } from '@ai-video/shared';

describe('Phase 5 Task 5: EditPlan Validation & Frame-Grid Alignment Engine', () => {
  const createValidPlan = (): EditPlan => ({
    schemaVersion: '1.0',
    projectId: 'prj_valid_123',
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
        id: 'cut_1',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 2.0, end: 4.5 },
        params: { reason: 'silence', padding: 0.05 },
      },
      {
        id: 'col_1',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset: 'cinematic',
          contrast: 1.15,
          brightness: 0.0,
          saturation: 0.9,
          vignette: 0.3,
          grain: 0.1,
        },
      },
      {
        id: 'sub_1',
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style: 'word_pop',
          position: 'bottom',
          size: 52,
          primaryColor: '#FFFFFF',
          highlightColor: '#FFD84D',
          maxWordsPerLine: 4,
        },
      },
    ],
    meta: {
      prompt: 'Validation suite base plan',
      model: 'gemini-1.5-pro',
      createdAt: new Date().toISOString(),
    },
  });

  describe('Envelope & Structural Invariants', () => {
    it('accepts a fully compliant EditPlan and computes output duration', () => {
      const plan = createValidPlan();
      const res = validateEditPlan(plan, { assetDurationSec: 30, fps: 30 });

      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.computedDurationSec).toBeGreaterThan(0);
      // 30s asset minus cut (4.5 - 2.0 = 2.5s minus padding 0.1s = 2.4s) -> approx 27.6s
      expect(res.computedDurationSec).toBeCloseTo(27.6, 0.5);
    });

    it('rejects an invalid schemaVersion or missing project metadata', () => {
      const plan = createValidPlan();
      (plan as any).schemaVersion = '2.0';
      (plan as any).projectId = '';

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Invalid schemaVersion "2.0". Expected "1.0".');
      expect(res.errors).toContain('projectId is required and must be a non-empty string.');
    });

    it('rejects plans exceeding maximum layer budget of 200 (Spec §3.7 #5)', () => {
      const plan = createValidPlan();
      plan.layers = [];
      for (let i = 0; i < 205; i++) {
        plan.layers.push({
          id: `cut_${i}`,
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 0, end: 1 },
          params: { reason: 'user', padding: 0 },
        });
      }

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('exceeds maximum allowed budget of 200'))).toBe(
        true
      );
    });

    it('enforces singleton layer constraints (at most 1 color, subtitle, intro, outro)', () => {
      const plan = createValidPlan();
      // Add duplicate color layer
      plan.layers.push({
        id: 'col_dup',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: { preset: 'warm' },
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('cannot contain more than 1 color layer'))).toBe(
        true
      );
    });
  });

  describe('Source Ranges & Duration Invariants', () => {
    it('detects inverted source ranges (start >= end)', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'cut_bad',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 15, end: 10 },
        params: { reason: 'user', padding: 0 },
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('range.end must be greater than range.start'))).toBe(
        true
      );
    });

    it('rejects cut ranges that exceed the total source asset duration', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'cut_overflow',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 25, end: 40 }, // Asset is only 30s
        params: { reason: 'user', padding: 0 },
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('exceeds asset duration'))).toBe(true);
    });

    it('rejects plans where cuts eliminate 100% of the media duration', () => {
      const plan = createValidPlan();
      plan.layers = [
        {
          id: 'cut_all',
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 0, end: 30 },
          params: { reason: 'user', padding: 0 },
        },
      ];

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('eliminate 100% of the video duration'))).toBe(true);
    });
  });

  describe('Allowed Parameter Ranges (Spec §3.3 & §3.7)', () => {
    it('validates color grading parameters within strict limits', () => {
      const plan = createValidPlan();
      const colLayer = plan.layers.find((l) => l.layer === 'color') as any;
      colLayer.params.contrast = 2.5; // allowed 0.7 .. 1.5
      colLayer.params.brightness = -0.8; // allowed -0.3 .. 0.3
      colLayer.params.grain = 0.9; // allowed 0 .. 0.5

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Contrast must be between 0.7 and 1.5'))).toBe(true);
      expect(res.errors.some((e) => e.includes('Brightness must be between -0.3 and 0.3'))).toBe(
        true
      );
      expect(res.errors.some((e) => e.includes('Grain must be between 0 and 0.5'))).toBe(true);
    });

    it('validates speed factors within 0.25 to 4.0', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'spd_bad',
        layer: 'speed',
        enabled: true,
        timebase: 'source',
        range: { start: 0, end: 10 },
        params: { factor: 8.0, keepPitch: true },
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Speed factor must be between 0.25 and 4.0'))).toBe(
        true
      );
    });

    it('validates subtitle size and color formats', () => {
      const plan = createValidPlan();
      const subLayer = plan.layers.find((l) => l.layer === 'subtitle') as any;
      subLayer.params.size = 150; // max 96
      subLayer.params.primaryColor = 'invalid_color';

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes('Subtitle font size must be between 24 and 96'))
      ).toBe(true);
      expect(res.errors.some((e) => e.includes('primaryColor must be a valid hex color'))).toBe(
        true
      );
    });

    it('validates transition duration and positioning', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'tr_bad',
        layer: 'transition',
        enabled: true,
        timebase: 'source',
        range: { start: 5, end: 10 },
        params: { type: 'dissolve', duration: 3.5, at: 35.0 }, // duration max 1.5, at exceeds asset
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30 });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes('Transition duration must be between 0.2 and 1.5s'))
      ).toBe(true);
      expect(
        res.errors.some((e) => e.includes('Transition "at" must be between 0 and asset duration'))
      ).toBe(true);
    });
  });

  describe('Frame-Grid Alignment Engine snapPlanToFrameGrid', () => {
    it('detects unaligned timestamps and issues warnings at 30 fps', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'cut_unaligned',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 5.12345, end: 8.7891 },
        params: { reason: 'user', padding: 0 },
      });

      const res = validateEditPlan(plan, { assetDurationSec: 30, fps: 30 });
      expect(res.warnings.some((w) => w.includes('is not frame-aligned at 30 fps'))).toBe(true);
    });

    it('snaps arbitrary timestamps to exact frame-grid boundaries', () => {
      const plan = createValidPlan();
      plan.layers.push({
        id: 'cut_snap',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 5.123, end: 8.789 },
        params: { reason: 'user', padding: 0 },
      });
      plan.layers.push({
        id: 'tr_snap',
        layer: 'transition',
        enabled: true,
        timebase: 'source',
        range: { start: 8.789, end: 9.3 },
        params: { type: 'fade', duration: 0.512, at: 8.789 },
      });

      const snapped = snapPlanToFrameGrid(plan, 30, 30);
      const res = validateEditPlan(snapped, { assetDurationSec: 30, fps: 30 });

      // After snapping, there should be ZERO frame-grid warnings
      expect(res.warnings).toHaveLength(0);
      expect(res.valid).toBe(true);
    });
  });
});
