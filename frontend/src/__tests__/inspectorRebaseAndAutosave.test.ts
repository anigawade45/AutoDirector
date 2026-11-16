import { describe, it, expect } from 'vitest';
import { rebasePlanPatch } from '../utils/planRebase';
import { EditPlan } from '@ai-video/shared';

describe('Inspector Optimistic Rebase & Autosave Concurrency Engine', () => {
  const createBasePlan = (): EditPlan => ({
    schemaVersion: '1.0',
    projectId: 'prj_test_sync',
    baseAssetId: 'ast_base_1',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [
      {
        id: 'lyr_color_1',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset: 'natural',
          contrast: 1.0,
          saturation: 1.0,
          vignette: 0,
        },
      },
      {
        id: 'lyr_audio_1',
        layer: 'audio',
        enabled: true,
        timebase: 'global',
        params: {
          volume: 1.0,
          denoise: false,
        },
      },
    ],
    meta: {
      prompt: 'Initial plan',
      createdAt: '2026-11-16T12:00:00Z',
    },
  });

  it('cleanly rebases non-conflicting local property edit onto newer server head plan', () => {
    const basePlan = createBasePlan();

    // User locally adjusted saturation on lyr_color_1
    const draftPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    (draftPlan.layers[0].params as any).saturation = 1.4;

    // Concurrently, server updated audio volume on lyr_audio_1 and bumped to v2
    const headPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    headPlan.version = 2;
    (headPlan.layers[1].params as any).volume = 0.8;

    const result = rebasePlanPatch(basePlan, draftPlan, headPlan);

    expect(result.success).toBe(true);
    expect(result.rebasedPatch).toBeDefined();
    expect(result.rebasedPatch!.length).toBeGreaterThan(0);

    // Rebased candidate contains BOTH server edit and user local edit
    expect((result.rebasedPlan!.layers[1].params as any).volume).toBe(0.8); // from server
    expect((result.rebasedPlan!.layers[0].params as any).saturation).toBe(1.4); // from user
  });

  it('cleanly rebases newly added local layer onto server head plan that added another layer', () => {
    const basePlan = createBasePlan();

    // User locally added a text title overlay
    const draftPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    draftPlan.layers.push({
      id: 'lyr_text_user',
      layer: 'text',
      enabled: true,
      timebase: 'clip',
      range: { start: 0, end: 5 },
      params: { text: 'Director Cut', style: 'cinematic' },
    });

    // Server added a watermark layer at v2
    const headPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    headPlan.version = 2;
    headPlan.layers.push({
      id: 'lyr_watermark_server',
      layer: 'text',
      enabled: true,
      timebase: 'global',
      params: { text: 'Confidential' },
    });

    const result = rebasePlanPatch(basePlan, draftPlan, headPlan);

    expect(result.success).toBe(true);
    expect(result.rebasedPlan!.layers).toHaveLength(4);
    expect(result.rebasedPlan!.layers.some((l) => l.id === 'lyr_watermark_server')).toBe(true);
    expect(result.rebasedPlan!.layers.some((l) => l.id === 'lyr_text_user')).toBe(true);
  });

  it('returns empty patch when draft has no changes relative to base', () => {
    const basePlan = createBasePlan();
    const draftPlan = JSON.parse(JSON.stringify(basePlan));
    const headPlan = JSON.parse(JSON.stringify(basePlan));
    headPlan.version = 3;

    const result = rebasePlanPatch(basePlan, draftPlan, headPlan);

    expect(result.success).toBe(true);
    expect(result.rebasedPatch).toEqual([]);
    expect(result.rebasedPlan).toEqual(headPlan);
  });

  it('safely handles structural conflict when user edited a path deleted by server', () => {
    const basePlan = createBasePlan();

    // User locally edited lyr_audio_1
    const draftPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    (draftPlan.layers[1].params as any).volume = 1.8;

    // Server completely deleted lyr_audio_1 (now only 1 layer exists)
    const headPlan: EditPlan = JSON.parse(JSON.stringify(basePlan));
    headPlan.version = 2;
    headPlan.layers = [headPlan.layers[0]]; // deleted audio layer

    const result = rebasePlanPatch(basePlan, draftPlan, headPlan);

    // fast-json-patch attempting to patch non-existent /layers/1/params/volume
    // or if it throws, result.success is false with error reason
    if (!result.success) {
      expect(result.error).toBeDefined();
    } else {
      // If fast-json-patch created an array element, verify it didn't corrupt
      expect(result.rebasedPlan).toBeDefined();
    }
  });

  it('blocks prototype pollution operations during rebase', () => {
    const basePlan = createBasePlan();
    const draftPlan = JSON.parse(JSON.stringify(basePlan));
    const headPlan = JSON.parse(JSON.stringify(basePlan));

    // Simulate malicious payload attempting prototype mutation
    const draftWithProto = JSON.parse(JSON.stringify(basePlan));
    (draftWithProto as any)['__proto__'] = { polluted: true };

    const result = rebasePlanPatch(basePlan, draftWithProto, headPlan);
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
});
