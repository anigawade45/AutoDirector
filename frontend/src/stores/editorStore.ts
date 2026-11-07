import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { EditPlan, EditLayer } from '@ai-video/shared';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  planVersion?: number;
  timestamp: string;
}

export interface TrackVM {
  id: string;
  kind: 'video' | 'subtitle' | 'text' | 'fx' | 'music';
  name: string;
  clips: Array<{
    id: string;
    label: string;
    startSec: number;
    durSec: number;
    layerRef?: EditLayer;
  }>;
}

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
  words?: Array<{
    word: string;
    startMs: number;
    endMs: number;
    score?: number;
  }>;
}

export interface AnalysisSummaryData {
  durationMs: number;
  silencesCount: number;
  sceneCutsCount: number;
  bpm: number;
  integratedLufs: number;
  truePeakDb?: number;
  status?: string;
  cuesCount?: number;
  wordCount?: number;
  transcriptSnippet?: string;
  cues?: TranscriptCue[];
  silences?: Array<{ startMs: number; endMs: number; durationMs: number }>;
  sceneCuts?: Array<{ timeMs: number }>;
}

export interface EditorStoreState {
  project: {
    id: string;
    title: string;
    status: string;
    assetId: string;
    durationSec: number;
    aspect?: string;
    fps?: number;
    resolution?: string;
    media?: {
      durationMs: number;
      width: number;
      height: number;
      fps: number;
      codec?: string;
    };
    analysisSummary?: AnalysisSummaryData | null;
  } | null;

  activeTab: 'project' | 'inspector';

  plan: {
    current: EditPlan | null;
    draft: EditPlan | null;
    version: number;
    history: number[];
    cursor: number;
    versionMap?: Record<number, EditPlan>;
  };

  timeline: {
    zoom: number; // pixels per second
    scrollX: number;
    selectedLayerIds: string[];
    snap: boolean;
  };

  playback: {
    status: 'idle' | 'loading' | 'playing' | 'paused' | 'seeking' | 'ended';
    currentTime: number; // output seconds
    duration: number; // output duration
    rate: number;
    volume: number;
    muted: boolean;
  };

  preview: {
    mode: 'proxy' | 'live';
    url: string | null;
    planVersion: number | null;
    stale: boolean;
  };

  jobs: Record<
    string,
    {
      type: 'preview' | 'render' | 'analysis';
      percent: number;
      state: string;
      error?: string;
    }
  >;

  chat: {
    messages: ChatMessageItem[];
    pending: boolean;
  };

  // Actions
  setActiveTab: (tab: 'project' | 'inspector') => void;
  setProject: (project: any, analysisSummary?: AnalysisSummaryData | null) => void;
  setPlan: (plan: EditPlan) => void;
  updateDraft: (modifier: (draft: EditPlan) => void) => void;
  commitDraft: (newVersionPlan?: EditPlan) => void;
  discardDraft: () => void;
  undo: () => void;
  redo: () => void;
  setCurrentTime: (timeSec: number) => void;
  setPlaybackStatus: (status: EditorStoreState['playback']['status']) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  stepFrame: (direction: 1 | -1) => void;
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;
  fitTimelineToWidth: (containerWidthPx: number) => void;
  toggleSnap: () => void;
  selectLayer: (layerId: string | null, multi?: boolean) => void;
  deleteSelectedLayers: () => void;
  addChatMessage: (msg: Omit<ChatMessageItem, 'id' | 'timestamp'>) => void;
  setChatPending: (pending: boolean) => void;
  updateJob: (jobId: string, update: Partial<EditorStoreState['jobs'][string]>) => void;
  setPreviewUrl: (url: string, planVersion: number) => void;
}

export const useEditorStore = create<EditorStoreState>()(
  immer((set) => ({
    project: null,
    activeTab: 'project',

    plan: {
      current: null,
      draft: null,
      version: 0,
      history: [],
      cursor: -1,
      versionMap: {},
    },

    timeline: {
      zoom: 60, // 60 pixels per second default
      scrollX: 0,
      selectedLayerIds: [],
      snap: true,
    },

    playback: {
      status: 'idle',
      currentTime: 0,
      duration: 60,
      rate: 1,
      volume: 1,
      muted: false,
    },

    preview: {
      mode: 'live',
      url: null,
      planVersion: null,
      stale: false,
    },

    jobs: {},

    chat: {
      messages: [],
      pending: false,
    },

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab;
      }),

    setProject: (proj, analysisSummary) =>
      set((state) => {
        const media = proj.baseAssetId?.media ||
          proj.media || {
            durationMs: proj.stats?.durationMs || 60000,
            width: 1920,
            height: 1080,
            fps: 30,
          };

        state.project = {
          id: proj.publicId || proj.id,
          title: proj.title,
          status: proj.status,
          assetId: proj.baseAssetId?.publicId || proj.baseAssetId || '',
          durationSec: media.durationMs / 1000,
          aspect: proj.settings?.aspect || '16:9',
          fps: proj.settings?.fps || media.fps || 30,
          resolution: proj.settings?.resolution || `${media.height || 1080}p`,
          media,
          analysisSummary: analysisSummary || proj.analysisSummary || null,
        };
        state.playback.duration = state.project.durationSec;
      }),

    setPlan: (plan) =>
      set((state) => {
        state.plan.current = plan;
        state.plan.draft = null;
        state.plan.version = plan.version;
        if (!state.plan.versionMap) {
          state.plan.versionMap = {};
        }
        state.plan.versionMap[plan.version] = JSON.parse(JSON.stringify(plan));

        if (!state.plan.history.includes(plan.version)) {
          // Truncate forward history if branching after undo
          if (state.plan.cursor < state.plan.history.length - 1) {
            state.plan.history = state.plan.history.slice(0, state.plan.cursor + 1);
          }
          state.plan.history.push(plan.version);
          state.plan.cursor = state.plan.history.length - 1;
        } else {
          state.plan.cursor = state.plan.history.indexOf(plan.version);
        }

        state.preview.stale = true;
      }),

    updateDraft: (modifier) =>
      set((state) => {
        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (state.plan.draft) {
          modifier(state.plan.draft);
        }
      }),

    commitDraft: (newVersionPlan) =>
      set((state) => {
        if (newVersionPlan) {
          state.plan.current = newVersionPlan;
          state.plan.version = newVersionPlan.version;
          state.plan.draft = null;
          if (!state.plan.versionMap) {
            state.plan.versionMap = {};
          }
          state.plan.versionMap[newVersionPlan.version] = JSON.parse(
            JSON.stringify(newVersionPlan)
          );

          if (!state.plan.history.includes(newVersionPlan.version)) {
            if (state.plan.cursor < state.plan.history.length - 1) {
              state.plan.history = state.plan.history.slice(0, state.plan.cursor + 1);
            }
            state.plan.history.push(newVersionPlan.version);
            state.plan.cursor = state.plan.history.length - 1;
          } else {
            state.plan.cursor = state.plan.history.indexOf(newVersionPlan.version);
          }
        } else if (state.plan.draft) {
          state.plan.current = state.plan.draft;
          state.plan.draft = null;
        }
        state.preview.stale = true;
      }),

    discardDraft: () =>
      set((state) => {
        state.plan.draft = null;
      }),

    undo: () =>
      set((state) => {
        if (state.plan.cursor > 0) {
          state.plan.cursor -= 1;
          const targetVersion = state.plan.history[state.plan.cursor];
          state.plan.version = targetVersion;
          if (state.plan.versionMap?.[targetVersion]) {
            state.plan.current = JSON.parse(JSON.stringify(state.plan.versionMap[targetVersion]));
          }
          state.plan.draft = null;
          state.preview.stale = true;
        }
      }),

    redo: () =>
      set((state) => {
        if (state.plan.cursor < state.plan.history.length - 1) {
          state.plan.cursor += 1;
          const targetVersion = state.plan.history[state.plan.cursor];
          state.plan.version = targetVersion;
          if (state.plan.versionMap?.[targetVersion]) {
            state.plan.current = JSON.parse(JSON.stringify(state.plan.versionMap[targetVersion]));
          }
          state.plan.draft = null;
          state.preview.stale = true;
        }
      }),

    setCurrentTime: (timeSec) =>
      set((state) => {
        state.playback.currentTime = Math.max(0, Math.min(timeSec, state.playback.duration));
      }),

    setPlaybackStatus: (status) =>
      set((state) => {
        state.playback.status = status;
      }),

    setPlaybackRate: (rate) =>
      set((state) => {
        state.playback.rate = Math.max(0.25, Math.min(rate, 4.0));
      }),

    setVolume: (vol) =>
      set((state) => {
        state.playback.volume = Math.max(0, Math.min(vol, 1));
        if (vol > 0) state.playback.muted = false;
      }),

    toggleMute: () =>
      set((state) => {
        state.playback.muted = !state.playback.muted;
      }),

    stepFrame: (direction) =>
      set((state) => {
        const fps = state.project?.fps || 30;
        const frameSec = 1 / fps;
        const newTime = state.playback.currentTime + direction * frameSec;
        state.playback.currentTime = Math.max(0, Math.min(newTime, state.playback.duration));
      }),

    setZoom: (zoom) =>
      set((state) => {
        state.timeline.zoom = Math.max(10, Math.min(zoom, 300));
      }),

    setScrollX: (scrollX) =>
      set((state) => {
        state.timeline.scrollX = Math.max(0, scrollX);
      }),

    fitTimelineToWidth: (containerWidthPx) =>
      set((state) => {
        const dur = state.playback.duration || 60;
        const desiredZoom = Math.max(10, Math.min((containerWidthPx - 40) / dur, 300));
        state.timeline.zoom = Math.round(desiredZoom);
        state.timeline.scrollX = 0;
      }),

    toggleSnap: () =>
      set((state) => {
        state.timeline.snap = !state.timeline.snap;
      }),

    selectLayer: (layerId, multi = false) =>
      set((state) => {
        if (!layerId) {
          state.timeline.selectedLayerIds = [];
          return;
        }

        if (multi) {
          if (state.timeline.selectedLayerIds.includes(layerId)) {
            state.timeline.selectedLayerIds = state.timeline.selectedLayerIds.filter(
              (id) => id !== layerId
            );
          } else {
            state.timeline.selectedLayerIds.push(layerId);
          }
        } else {
          state.timeline.selectedLayerIds = [layerId];
        }

        if (state.timeline.selectedLayerIds.length > 0) {
          state.activeTab = 'inspector';
        }
      }),

    deleteSelectedLayers: () =>
      set((state) => {
        const toDelete = new Set(state.timeline.selectedLayerIds);
        if (toDelete.size === 0) return;

        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }

        if (state.plan.draft) {
          state.plan.draft.layers = state.plan.draft.layers.filter((l) => !toDelete.has(l.id));
        }
        state.timeline.selectedLayerIds = [];
      }),

    addChatMessage: (msg) =>
      set((state) => {
        state.chat.messages.push({
          ...msg,
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }),

    setChatPending: (pending) =>
      set((state) => {
        state.chat.pending = pending;
      }),

    updateJob: (jobId, update) =>
      set((state) => {
        state.jobs[jobId] = {
          ...(state.jobs[jobId] || { type: 'preview', percent: 0, state: 'queued' }),
          ...update,
        };
      }),

    setPreviewUrl: (url, planVersion) =>
      set((state) => {
        state.preview.url = url;
        state.preview.planVersion = planVersion;
        state.preview.stale = false;
        state.preview.mode = 'proxy';
      }),
  }))
);

// Derived Selectors
export const selectEffectivePlan = (state: EditorStoreState): EditPlan | null =>
  state.plan.draft || state.plan.current;

export const selectColorLayer = (state: EditorStoreState) =>
  selectEffectivePlan(state)?.layers.find((l) => l.enabled && l.layer === 'color');

export const selectSubtitleLayer = (state: EditorStoreState) =>
  selectEffectivePlan(state)?.layers.find((l) => l.enabled && l.layer === 'subtitle');

export const selectCutLayers = (state: EditorStoreState) =>
  selectEffectivePlan(state)?.layers.filter((l) => l.enabled && l.layer === 'cut') || [];

export const selectMusicLayer = (state: EditorStoreState) =>
  selectEffectivePlan(state)?.layers.find((l) => l.enabled && l.layer === 'music');

export const selectSelectedLayer = (state: EditorStoreState) => {
  const plan = selectEffectivePlan(state);
  const id = state.timeline.selectedLayerIds[0];
  return id ? plan?.layers.find((l) => l.id === id) : null;
};

export interface TrackClipVM {
  id: string;
  label: string;
  startSec: number;
  durSec: number;
  type:
    | 'video'
    | 'cut'
    | 'speed'
    | 'intro'
    | 'outro'
    | 'subtitle'
    | 'text'
    | 'music'
    | 'color'
    | 'overlay'
    | 'transition';
  layerId?: string;
  layerRef?: EditLayer;
  color?: string;
}

export interface DerivedTrackVM {
  id: string;
  kind: 'video' | 'subtitle' | 'text' | 'music' | 'fx';
  name: string;
  clips: TrackClipVM[];
}

export const selectDerivedTracks = (state: EditorStoreState): DerivedTrackVM[] => {
  const plan = selectEffectivePlan(state);
  const totalDuration = state.playback.duration || state.project?.durationSec || 60;

  if (!plan) return [];

  const tracks: DerivedTrackVM[] = [];

  // Track 1: Video Track (Base Video, Intro, Outro, Cuts, Speed)
  const videoClips: TrackClipVM[] = [];
  const introLayer = plan.layers.find((l) => l.enabled && l.layer === 'intro') as any;
  const outroLayer = plan.layers.find((l) => l.enabled && l.layer === 'outro') as any;
  const cutLayers = plan.layers.filter((l) => l.enabled && l.layer === 'cut') as any[];
  const speedLayers = plan.layers.filter((l) => l.enabled && l.layer === 'speed') as any[];

  // Intro clip
  if (introLayer) {
    videoClips.push({
      id: introLayer.id,
      label: `Intro: ${introLayer.params.text || introLayer.params.template}`,
      startSec: 0,
      durSec: introLayer.params.duration || 3,
      type: 'intro',
      layerId: introLayer.id,
      layerRef: introLayer,
    });
  }

  // Base video source
  const introOffset = introLayer ? introLayer.params.duration || 3 : 0;
  const outroDur = outroLayer ? outroLayer.params.duration || 3 : 0;
  videoClips.push({
    id: 'base_video',
    label: 'Main Video Source',
    startSec: introOffset,
    durSec: Math.max(1, totalDuration - introOffset - outroDur),
    type: 'video',
  });

  // Cuts overlay
  for (const c of cutLayers) {
    const s = c.range?.start || 0;
    const e = c.range?.end || s + 1;
    videoClips.push({
      id: c.id,
      label: `Cut: ${c.params?.reason || 'silence'}`,
      startSec: s + introOffset,
      durSec: Math.max(0.1, e - s),
      type: 'cut',
      layerId: c.id,
      layerRef: c,
    });
  }

  // Speed changes
  for (const sp of speedLayers) {
    const s = sp.range?.start || 0;
    const e = sp.range?.end || s + 1;
    videoClips.push({
      id: sp.id,
      label: `${sp.params?.factor}x Speed`,
      startSec: s + introOffset,
      durSec: Math.max(0.1, e - s),
      type: 'speed',
      layerId: sp.id,
      layerRef: sp,
    });
  }

  // Outro clip
  if (outroLayer) {
    videoClips.push({
      id: outroLayer.id,
      label: `Outro: ${outroLayer.params.text || outroLayer.params.template}`,
      startSec: Math.max(0, totalDuration - outroDur),
      durSec: outroDur,
      type: 'outro',
      layerId: outroLayer.id,
      layerRef: outroLayer,
    });
  }

  tracks.push({
    id: 'trk_video',
    kind: 'video',
    name: 'V1: Video / Edits',
    clips: videoClips,
  });

  // Track 2: Subtitle Track
  const subtitleLayer = plan.layers.find((l) => l.enabled && l.layer === 'subtitle') as any;
  if (subtitleLayer) {
    tracks.push({
      id: 'trk_subtitle',
      kind: 'subtitle',
      name: 'T1: Subtitles',
      clips: [
        {
          id: subtitleLayer.id,
          label: `Captions: ${subtitleLayer.params.style || 'word_pop'} (${subtitleLayer.params.font || 'Montserrat'}, ${subtitleLayer.params.size || 48}px)`,
          startSec: 0,
          durSec: totalDuration,
          type: 'subtitle',
          layerId: subtitleLayer.id,
          layerRef: subtitleLayer,
        },
      ],
    });
  }

  // Track 3: Text Overlays Track
  const textLayers = plan.layers.filter((l) => l.enabled && l.layer === 'text') as any[];
  if (textLayers.length > 0) {
    tracks.push({
      id: 'trk_text',
      kind: 'text',
      name: 'T2: Graphic Text',
      clips: textLayers.map((tl) => ({
        id: tl.id,
        label: `Text: "${tl.params.content}" (${tl.params.animation || 'fade'})`,
        startSec: tl.range?.start || 0,
        durSec: tl.range ? Math.max(0.5, tl.range.end - tl.range.start) : totalDuration,
        type: 'text',
        layerId: tl.id,
        layerRef: tl,
      })),
    });
  }

  // Track 4: Audio Mix Track (Music & Speech Audio)
  const musicLayer = plan.layers.find((l) => l.enabled && l.layer === 'music') as any;
  const audioLayer = plan.layers.find((l) => l.enabled && l.layer === 'audio') as any;
  if (musicLayer || audioLayer) {
    const audioClips: TrackClipVM[] = [];
    if (musicLayer) {
      audioClips.push({
        id: musicLayer.id,
        label: `Music: ${musicLayer.params.trackId || 'Background Soundtrack'} (${musicLayer.params.duckUnderSpeech ? 'Speech Ducking' : 'Full Vol'}, ${Math.round((musicLayer.params.volume ?? 0.8) * 100)}%)`,
        startSec: 0,
        durSec: totalDuration,
        type: 'music',
        layerId: musicLayer.id,
        layerRef: musicLayer,
      });
    }
    tracks.push({
      id: 'trk_audio',
      kind: 'music',
      name: 'A1: Audio Mix',
      clips: audioClips,
    });
  }

  // Track 5: FX Track (Color LUT, Overlays, Transitions)
  const colorLayer = plan.layers.find((l) => l.enabled && l.layer === 'color') as any;
  const overlayLayers = plan.layers.filter((l) => l.enabled && l.layer === 'overlay') as any[];
  const transitionLayers = plan.layers.filter(
    (l) => l.enabled && l.layer === 'transition'
  ) as any[];
  if (colorLayer || overlayLayers.length > 0 || transitionLayers.length > 0) {
    const fxClips: TrackClipVM[] = [];
    if (colorLayer) {
      fxClips.push({
        id: colorLayer.id,
        label: `Color Grade: ${colorLayer.params.preset || 'cinematic'} (contrast: ${colorLayer.params.contrast ?? 1}, sat: ${colorLayer.params.saturation ?? 1})`,
        startSec: 0,
        durSec: totalDuration,
        type: 'color',
        layerId: colorLayer.id,
        layerRef: colorLayer,
      });
    }
    for (const ov of overlayLayers) {
      fxClips.push({
        id: ov.id,
        label: `Overlay: ${ov.params.asset}`,
        startSec: ov.range?.start || 0,
        durSec: ov.range ? Math.max(0.5, ov.range.end - ov.range.start) : totalDuration,
        type: 'overlay',
        layerId: ov.id,
        layerRef: ov,
      });
    }
    for (const tr of transitionLayers) {
      const at = tr.params.at || 0;
      const dur = tr.params.duration || 0.5;
      fxClips.push({
        id: tr.id,
        label: `Transition: ${tr.params.type} (${dur}s)`,
        startSec: Math.max(0, at - dur / 2),
        durSec: dur,
        type: 'transition',
        layerId: tr.id,
        layerRef: tr,
      });
    }
    tracks.push({
      id: 'trk_fx',
      kind: 'fx',
      name: 'FX: Color & Transitions',
      clips: fxClips,
    });
  }

  return tracks;
};
