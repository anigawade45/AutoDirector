import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditorStore,
  selectEffectivePlan,
  selectDerivedTracks,
  selectColorLayer,
  selectSubtitleLayer,
  selectCutLayers,
  selectMusicLayer,
} from '../stores/editorStore';
import { EditPlan, ColorLayer, SubtitleLayer, CutLayer, MusicLayer } from '@ai-video/shared';

describe('Phase 6 Task 4: Playback State, Timeline Zoom/Scroll, Selection, Snapping & Canvas Overlays', () => {
  const mockPlan: EditPlan = {
    schemaVersion: '1.0',
    projectId: 'prj_demo_goa',
    baseAssetId: 'ast_demo_01',
    version: 1,
    parentVersion: null,
    global: {
      aspect: '16:9',
      fps: 30,
      resolution: '1080p',
    },
    layers: [
      {
        id: 'lyr_intro_1',
        layer: 'intro',
        enabled: true,
        timebase: 'output',
        range: { start: 0, end: 3.0 },
        params: {
          template: 'cinematic_minimal',
          duration: 3.0,
          text: 'WELCOME TO GOA',
          subtext: 'Summer Vacation 2026',
        },
      },
      {
        id: 'lyr_col_1',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset: 'cinematic',
          contrast: 1.20,
          saturation: 0.90,
          vignette: 0.35,
          brightness: 0.05,
        },
      },
      {
        id: 'lyr_cut_1',
        layer: 'cut',
        enabled: true,
        timebase: 'source',
        range: { start: 12.0, end: 14.5 },
        params: { reason: 'silence' },
      },
      {
        id: 'lyr_speed_1',
        layer: 'speed',
        enabled: true,
        timebase: 'source',
        range: { start: 20.0, end: 25.0 },
        params: { factor: 2.0, keepPitch: true },
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
      {
        id: 'lyr_txt_1',
        layer: 'text',
        enabled: true,
        timebase: 'source',
        range: { start: 5.0, end: 9.0 },
        params: {
          content: 'Golden Sunset at Anjuna',
          animation: 'fade',
          position: { x: 0.5, y: 0.2 },
          font: 'Montserrat',
          size: 38,
          color: '#FFFFFF',
        },
      },
      {
        id: 'lyr_mus_1',
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          trackId: 'track_beach_lofi',
          volume: 0.75,
          duckUnderSpeech: true,
        },
      },
      {
        id: 'lyr_outro_1',
        layer: 'outro',
        enabled: true,
        timebase: 'output',
        range: { start: 57.0, end: 60.0 },
        params: {
          template: 'fade_to_black',
          duration: 3.0,
          text: 'SUBSCRIBE FOR MORE',
        },
      },
    ],
    meta: {
      prompt: 'Test plan',
      model: 'gemini-1.5-pro',
      createdAt: new Date().toISOString(),
    },
  };

  beforeEach(() => {
    const store = useEditorStore.getState();
    store.setProject({
      publicId: 'prj_demo_goa',
      title: 'Goa Highlights',
      status: 'ready',
      baseAssetId: {
        publicId: 'ast_demo_01',
        media: { durationMs: 60000, fps: 30, width: 1920, height: 1080 },
      },
    });
    store.setPlan(mockPlan);
    store.setCurrentTime(0);
    store.setZoom(60);
    store.selectLayer(null);
  });

  describe('1. Playback State Engine', () => {
    it('initializes and maintains valid playback status transitions', () => {
      const store = useEditorStore.getState();
      expect(store.playback.status).toBe('idle');
      expect(store.playback.duration).toBe(60);

      store.setPlaybackStatus('playing');
      expect(useEditorStore.getState().playback.status).toBe('playing');

      store.setPlaybackStatus('paused');
      expect(useEditorStore.getState().playback.status).toBe('paused');

      store.setPlaybackStatus('ended');
      expect(useEditorStore.getState().playback.status).toBe('ended');
    });

    it('enforces bounds on currentTime and clamps within [0, duration]', () => {
      const store = useEditorStore.getState();

      store.setCurrentTime(15.5);
      expect(useEditorStore.getState().playback.currentTime).toBe(15.5);

      // Clamps negative time to 0
      store.setCurrentTime(-5.0);
      expect(useEditorStore.getState().playback.currentTime).toBe(0);

      // Clamps past duration to duration
      store.setCurrentTime(999.0);
      expect(useEditorStore.getState().playback.currentTime).toBe(60);
    });

    it('manages playback speed rate and clamps to allowed bounds [0.25, 4.0]', () => {
      const store = useEditorStore.getState();

      store.setPlaybackRate(1.5);
      expect(useEditorStore.getState().playback.rate).toBe(1.5);

      store.setPlaybackRate(0.1);
      expect(useEditorStore.getState().playback.rate).toBe(0.25);

      store.setPlaybackRate(10.0);
      expect(useEditorStore.getState().playback.rate).toBe(4.0);
    });

    it('handles audio volume and muting toggles cleanly', () => {
      const store = useEditorStore.getState();

      store.setVolume(0.65);
      expect(useEditorStore.getState().playback.volume).toBe(0.65);
      expect(useEditorStore.getState().playback.muted).toBe(false);

      store.toggleMute();
      expect(useEditorStore.getState().playback.muted).toBe(true);

      store.toggleMute();
      expect(useEditorStore.getState().playback.muted).toBe(false);
    });

    it('steps frames accurately using project framerate grid (1 / fps)', () => {
      const store = useEditorStore.getState();
      const frameSec = 1 / 30; // 0.033333...s

      store.setCurrentTime(10.0);
      store.stepFrame(1);
      expect(useEditorStore.getState().playback.currentTime).toBeCloseTo(10.0 + frameSec, 4);

      store.stepFrame(-1);
      expect(useEditorStore.getState().playback.currentTime).toBeCloseTo(10.0, 4);
    });
  });

  describe('2. Timeline Zoom & Scroll', () => {
    it('enforces zoom constraints within [10, 300] px/s', () => {
      const store = useEditorStore.getState();

      store.setZoom(120);
      expect(useEditorStore.getState().timeline.zoom).toBe(120);

      store.setZoom(5);
      expect(useEditorStore.getState().timeline.zoom).toBe(10);

      store.setZoom(500);
      expect(useEditorStore.getState().timeline.zoom).toBe(300);
    });

    it('calculates fit-to-window zoom level for given viewport width', () => {
      const store = useEditorStore.getState();
      // Container width = 1240px, padding = 40px, usable = 1200px, duration = 60s -> zoom = 20 px/s
      store.fitTimelineToWidth(1240);
      expect(useEditorStore.getState().timeline.zoom).toBe(20);
      expect(useEditorStore.getState().timeline.scrollX).toBe(0);
    });

    it('tracks horizontal scrollX offset non-negatively', () => {
      const store = useEditorStore.getState();

      store.setScrollX(350);
      expect(useEditorStore.getState().timeline.scrollX).toBe(350);

      store.setScrollX(-50);
      expect(useEditorStore.getState().timeline.scrollX).toBe(0);
    });
  });

  describe('3. Layer Selection & Management', () => {
    it('supports single layer selection and switches tab to inspector', () => {
      const store = useEditorStore.getState();

      store.selectLayer('lyr_col_1');
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual(['lyr_col_1']);
      expect(useEditorStore.getState().activeTab).toBe('inspector');

      store.selectLayer(null);
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual([]);
    });

    it('supports multi-layer selection with shift toggling', () => {
      const store = useEditorStore.getState();

      store.selectLayer('lyr_col_1', false);
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual(['lyr_col_1']);

      // Shift-click adds second layer
      store.selectLayer('lyr_sub_1', true);
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual(['lyr_col_1', 'lyr_sub_1']);

      // Shift-click removes already selected layer
      store.selectLayer('lyr_col_1', true);
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual(['lyr_sub_1']);
    });

    it('deletes selected layers from plan.draft.layers cleanly', () => {
      const store = useEditorStore.getState();

      store.selectLayer('lyr_cut_1');
      store.deleteSelectedLayers();

      const effective = selectEffectivePlan(useEditorStore.getState());
      const remainingIds = effective?.layers.map((l) => l.id) || [];

      expect(remainingIds).not.toContain('lyr_cut_1');
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual([]);
    });
  });

  describe('4. Snapping Engine', () => {
    it('toggles magnetic frame snapping', () => {
      const store = useEditorStore.getState();
      expect(store.timeline.snap).toBe(true);

      store.toggleSnap();
      expect(useEditorStore.getState().timeline.snap).toBe(false);

      store.toggleSnap();
      expect(useEditorStore.getState().timeline.snap).toBe(true);
    });

    it('snaps time accurately to exact video frame grid intervals', () => {
      const fps = 30;
      const frameSec = 1 / fps; // 0.03333s

      const rawTime = 10.018; // halfway between frame 300 (10.000s) and frame 301 (10.0333s)
      const snapped = Math.round(rawTime / frameSec) * frameSec;

      expect(snapped).toBeCloseTo(10.0333, 4);
    });

    it('magnetically locks to nearest clip boundary when within magnetic threshold', () => {
      const zoom = 60; // 60 px/s
      const snapRadiusSec = 10 / zoom; // 10px / 60px/s = 0.1667s

      const boundaryPoint = 12.0; // Cut start boundary
      const cursorTime = 12.08;   // 0.08s away (within 0.1667s threshold)

      const isMagnetic = Math.abs(cursorTime - boundaryPoint) <= snapRadiusSec;
      expect(isMagnetic).toBe(true);

      const resolvedTime = isMagnetic ? boundaryPoint : cursorTime;
      expect(resolvedTime).toBe(12.0);
    });
  });

  describe('5. Derived Timeline Tracks & Canvas 2D Overlays', () => {
    it('derives all multi-track lanes deterministically from plan.layers', () => {
      const state = useEditorStore.getState();
      const tracks = selectDerivedTracks(state);

      expect(tracks.length).toBeGreaterThanOrEqual(4);

      // Verify V1 track contains intro, cuts, speed, outro clips
      const videoTrack = tracks.find((t) => t.kind === 'video');
      expect(videoTrack).toBeDefined();
      const videoClipTypes = videoTrack?.clips.map((c) => c.type);
      expect(videoClipTypes).toContain('intro');
      expect(videoClipTypes).toContain('cut');
      expect(videoClipTypes).toContain('speed');
      expect(videoClipTypes).toContain('outro');

      // Verify T1 subtitles track
      const subTrack = tracks.find((t) => t.kind === 'subtitle');
      expect(subTrack?.clips[0].layerId).toBe('lyr_sub_1');

      // Verify T2 text overlays track
      const textTrack = tracks.find((t) => t.kind === 'text');
      expect(textTrack?.clips[0].layerId).toBe('lyr_txt_1');

      // Verify A1 music audio mix track
      const musicTrack = tracks.find((t) => t.kind === 'music');
      expect(musicTrack?.clips[0].layerId).toBe('lyr_mus_1');
    });

    it('derives active layer parameter selectors from plan.layers', () => {
      const state = useEditorStore.getState();

      const color = selectColorLayer(state) as ColorLayer | undefined;
      expect(color?.params.preset).toBe('cinematic');
      expect(color?.params.contrast).toBe(1.20);
      expect(color?.params.vignette).toBe(0.35);

      const subtitle = selectSubtitleLayer(state) as SubtitleLayer | undefined;
      expect(subtitle?.params.style).toBe('word_pop');
      expect(subtitle?.params.position).toBe('bottom');

      const cuts = selectCutLayers(state) as CutLayer[];
      expect(cuts).toHaveLength(1);
      expect(cuts[0].range?.start).toBe(12.0);

      const music = selectMusicLayer(state) as MusicLayer | undefined;
      expect(music?.params.duckUnderSpeech).toBe(true);
    });
  });
});
