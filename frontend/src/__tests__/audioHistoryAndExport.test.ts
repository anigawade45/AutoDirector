import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditorStore,
  selectEffectivePlan,
  selectMusicLayer,
} from '../stores/editorStore';
import { EditPlan, MusicLayer } from '@ai-video/shared';

describe('Phase 7 Frontend Suite: Audio, History & Export', () => {
  const v1Plan: EditPlan = {
    schemaVersion: '1.0',
    projectId: 'prj_phase7',
    baseAssetId: 'ast_p7',
    version: 1,
    parentVersion: null,
    global: { aspect: '16:9', fps: 30, resolution: '1080p' },
    layers: [
      {
        id: 'lyr_sub_1',
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style: 'word_pop',
          font: 'Montserrat',
          size: 56,
          position: 'bottom',
          primaryColor: '#FFFFFF',
          highlightColor: '#FFD84D',
          maxWordsPerLine: 4,
        },
      },
      {
        id: 'lyr_mus_1',
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          trackId: 'mus_calm_01',
          volume: 0.35,
          duckUnderSpeech: true,
          fadeIn: 1.5,
          fadeOut: 3.0,
          beatSync: false,
        },
      },
    ],
    meta: { prompt: 'Initial plan', model: 'gemini', createdAt: '2026-11-04T10:00:00Z' },
  };

  const v2Plan: EditPlan = {
    ...v1Plan,
    version: 2,
    parentVersion: 1,
    layers: [
      {
        id: 'lyr_sub_1',
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style: 'word_pop',
          font: 'Montserrat',
          size: 72, // Bigger subtitles
          position: 'bottom',
          primaryColor: '#FFFFFF',
          highlightColor: '#FFD84D',
          maxWordsPerLine: 4,
        },
      },
      {
        id: 'lyr_mus_1',
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          trackId: 'mus_calm_01',
          volume: 0.35,
          duckUnderSpeech: true,
          fadeIn: 1.5,
          fadeOut: 3.0,
          beatSync: false,
        },
      },
    ],
    meta: { prompt: 'Make subtitles bigger', model: 'gemini', createdAt: '2026-11-04T10:05:00Z' },
  };

  const v3Plan: EditPlan = {
    ...v2Plan,
    version: 3,
    parentVersion: 2,
    layers: [
      ...v2Plan.layers,
      {
        id: 'lyr_aud_1',
        layer: 'audio',
        enabled: true,
        timebase: 'global',
        params: {
          normalizeLufs: -16,
          denoise: true,
        },
      },
    ],
    meta: { prompt: 'Add background denoise', model: 'gemini', createdAt: '2026-11-04T10:10:00Z' },
  };

  beforeEach(() => {
    // Reset store state
    const store = useEditorStore.getState();
    store.discardDraft();
    store.setPlan(v1Plan);
  });

  describe('Undo/Redo through Immutable Version History Stack', () => {
    it('pushes version history and supports multi-step undo and redo with full plan restoration', () => {
      const store = useEditorStore.getState();
      expect(store.plan.version).toBe(1);
      expect(store.plan.history).toEqual([1]);
      expect(store.plan.cursor).toBe(0);

      // Transition to v2
      useEditorStore.getState().setPlan(v2Plan);
      let state = useEditorStore.getState();
      expect(state.plan.version).toBe(2);
      expect(state.plan.history).toEqual([1, 2]);
      expect(state.plan.cursor).toBe(1);
      let subLayer = state.plan.current?.layers.find((l) => l.layer === 'subtitle') as any;
      expect(subLayer.params.size).toBe(72);

      // Transition to v3
      useEditorStore.getState().setPlan(v3Plan);
      state = useEditorStore.getState();
      expect(state.plan.version).toBe(3);
      expect(state.plan.history).toEqual([1, 2, 3]);
      expect(state.plan.cursor).toBe(2);
      expect(state.plan.current?.layers.some((l) => l.layer === 'audio')).toBe(true);

      // First Undo: v3 -> v2
      useEditorStore.getState().undo();
      state = useEditorStore.getState();
      expect(state.plan.version).toBe(2);
      expect(state.plan.cursor).toBe(1);
      expect(state.plan.current?.layers.some((l) => l.layer === 'audio')).toBe(false);
      subLayer = state.plan.current?.layers.find((l) => l.layer === 'subtitle') as any;
      expect(subLayer.params.size).toBe(72);
      expect(state.preview.stale).toBe(true);

      // Second Undo: v2 -> v1
      useEditorStore.getState().undo();
      state = useEditorStore.getState();
      expect(state.plan.version).toBe(1);
      expect(state.plan.cursor).toBe(0);
      subLayer = state.plan.current?.layers.find((l) => l.layer === 'subtitle') as any;
      expect(subLayer.params.size).toBe(56); // Restored original size

      // Redo: v1 -> v2
      useEditorStore.getState().redo();
      state = useEditorStore.getState();
      expect(state.plan.version).toBe(2);
      expect(state.plan.cursor).toBe(1);
      subLayer = state.plan.current?.layers.find((l) => l.layer === 'subtitle') as any;
      expect(subLayer.params.size).toBe(72);

      // Redo: v2 -> v3
      useEditorStore.getState().redo();
      state = useEditorStore.getState();
      expect(state.plan.version).toBe(3);
      expect(state.plan.cursor).toBe(2);
      expect(state.plan.current?.layers.some((l) => l.layer === 'audio')).toBe(true);
    });

    it('truncates forward history on branch edit after undo', () => {
      useEditorStore.getState().setPlan(v2Plan);
      useEditorStore.getState().setPlan(v3Plan);

      // Undo back to v2
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().plan.version).toBe(2);
      expect(useEditorStore.getState().plan.cursor).toBe(1);

      // Create new branch v4
      const v4Plan: EditPlan = {
        ...v2Plan,
        version: 4,
        parentVersion: 2,
        meta: { prompt: 'Branched alternative', model: 'gemini', createdAt: '2026-11-04T10:15:00Z' },
      };

      useEditorStore.getState().setPlan(v4Plan);
      const state = useEditorStore.getState();
      expect(state.plan.version).toBe(4);
      // v3 forward history was truncated; history is now [1, 2, 4]
      expect(state.plan.history).toEqual([1, 2, 4]);
      expect(state.plan.cursor).toBe(2);
    });
  });

  describe('Audio & Music Parameter Selectors and Derivations', () => {
    it('derives music layer and exposes ducking, volume, and fade parameters', () => {
      const state = useEditorStore.getState();
      const music = selectMusicLayer(state) as MusicLayer;

      expect(music).toBeDefined();
      expect(music.params.volume).toBe(0.35);
      expect(music.params.duckUnderSpeech).toBe(true);
      expect(music.params.fadeIn).toBe(1.5);
      expect(music.params.fadeOut).toBe(3.0);
    });

    it('modifies draft music volume and speech ducking reactively without corrupting current plan', () => {
      // Modify draft
      useEditorStore.getState().updateDraft((draft) => {
        const mus = draft.layers.find((l) => l.layer === 'music') as any;
        if (mus) {
          mus.params.volume = 0.65;
          mus.params.duckUnderSpeech = false;
          mus.params.beatSync = true;
        }
      });

      const draftState = useEditorStore.getState();
      const effectivePlan = selectEffectivePlan(draftState);
      const effectiveMusic = effectivePlan?.layers.find((l) => l.layer === 'music') as any;

      expect(effectiveMusic.params.volume).toBe(0.65);
      expect(effectiveMusic.params.duckUnderSpeech).toBe(false);
      expect(effectiveMusic.params.beatSync).toBe(true);

      // The server plan (current) remains untouched at 0.35
      const currentMusic = draftState.plan.current?.layers.find((l) => l.layer === 'music') as any;
      expect(currentMusic.params.volume).toBe(0.35);
      expect(currentMusic.params.duckUnderSpeech).toBe(true);

      // Discarding draft restores back to current
      useEditorStore.getState().discardDraft();
      const restoredState = useEditorStore.getState();
      expect(restoredState.plan.draft).toBeNull();
      const restoredEffective = selectEffectivePlan(restoredState);
      const restoredMusic = restoredEffective?.layers.find((l) => l.layer === 'music') as any;
      expect(restoredMusic.params.volume).toBe(0.35);
    });
  });
});

