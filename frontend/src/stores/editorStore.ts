import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  EditPlan,
  EditLayer,
  MediaIndexSummary,
  buildMediaIndex,
  cleanEmptyCues,
  renameSpeakerInCues,
  getSpeakerColor,
  TimelineOperationItem,
} from '@ai-video/shared';
import { computeNaturalWordTimings } from '../utils/subtitleTiming';
import { api } from '../api/client';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  planVersion?: number;
  timestamp: string;
  operations?: TimelineOperationItem[];
}

export interface TrackState {
  muted?: boolean;
  locked?: boolean;
  hidden?: boolean;
  solo?: boolean;
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
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
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
  highlights?: Array<{
    id?: string;
    startMs: number;
    endMs: number;
    score: number;
    reason: string;
  }>;
  chapters?: Array<{
    id: string;
    startMs: number;
    endMs: number;
    title: string;
    summary?: string;
  }>;
  hook?: {
    startMs: number;
    endMs: number;
    score: number;
    reason: string;
  } | null;
}

export interface EditorStoreState {
  activeVideoElement: HTMLVideoElement | null;
  project: {
    id: string;
    title: string;
    status: string;
    assetId: string;
    durationSec: number;
    headVersion?: number;
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
    toolMode: 'select' | 'razor';
    trackStates: Record<string, TrackState>;
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
    baseProxyUrl?: string | null;
    versionUrlMap?: Record<number, string>;
    planVersion: number | null;
    stale: boolean;
    isRendered?: boolean;
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

  selectedAiModel: string;
  activeShortId: string | null;

  // Actions
  setSelectedAiModel: (model: string) => void;
  setActiveShortId: (id: string | null) => void;
  setActiveTab: (tab: 'project' | 'inspector') => void;
  setProject: (project: any, analysisSummary?: AnalysisSummaryData | null) => void;
  setPlan: (plan: EditPlan) => void;
  updateDraft: (modifier: (draft: EditPlan) => void) => void;
  commitDraft: (newVersionPlan?: EditPlan) => void;
  discardDraft: () => void;
  undo: () => void;
  redo: () => void;
  setCurrentTime: (timeSec: number) => void;
  setDuration: (durationSec: number) => void;
  setPlaybackStatus: (status: EditorStoreState['playback']['status']) => void;
  registerVideoElement: (el: HTMLVideoElement | null) => void;
  togglePlayback: () => void;
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
  updateLayerRange: (layerId: string, startSec: number, endSec: number) => void;
  splitLayerAtTime: (timeSec: number, layerId?: string) => boolean;
  splitSubtitleCueAtTime: (timeSec: number) => boolean;
  moveClip: (
    clipId: string,
    newStartSec: number,
    newEndSec: number,
    isCue?: boolean,
    cueIndex?: number
  ) => void;
  duplicateLayer: (layerId: string) => void;
  duplicateCue: (cueIndex: number) => void;
  addTimelineLayer: (
    type: 'text' | 'music' | 'color' | 'cut' | 'overlay' | 'subtitle' | 'audio'
  ) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackHidden: (trackId: string) => void;
  addChatMessage: (msg: Omit<ChatMessageItem, 'id' | 'timestamp'>) => void;
  setChatMessages: (messages: ChatMessageItem[]) => void;
  clearChat: () => void;
  setChatPending: (pending: boolean) => void;
  updateJob: (jobId: string, update: Partial<EditorStoreState['jobs'][string]>) => void;
  updateCues: (cues: TranscriptCue[]) => void;
  updateCueText: (index: number, newText: string) => void;
  updateCueTiming: (index: number, startSec: number, endSec: number) => void;
  updateCueSpeaker: (index: number, speaker: string) => void;
  deleteCue: (index: number) => void;
  cleanEmptySubtitleCues: () => number;
  renameSpeaker: (oldName: string, newName: string) => void;
  setToolMode: (mode: 'select' | 'razor') => void;
  setPreviewUrl: (
    url: string,
    planVersion: number,
    isRendered?: boolean,
    baseProxyUrl?: string
  ) => void;
}

export const useEditorStore = create<EditorStoreState>()(
  immer((set, get) => ({
    activeVideoElement: null,
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
      toolMode: 'select',
      trackStates: {},
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
      baseProxyUrl: null,
      versionUrlMap: {},
      planVersion: null,
      stale: false,
    },

    jobs: {},

    chat: {
      messages: [],
      pending: false,
    },

    selectedAiModel: 'gemini-3.5-flash-lite',
    activeShortId: null,

    setSelectedAiModel: (model) =>
      set((state) => {
        state.selectedAiModel = model;
      }),

    setActiveShortId: (id) =>
      set((state) => {
        state.activeShortId = id;
      }),

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
          headVersion: proj.headVersion && proj.headVersion > 0 ? proj.headVersion : 1,
          aspect: proj.settings?.aspect || '16:9',
          fps: proj.settings?.fps || media.fps || 30,
          resolution: proj.settings?.resolution || `${media.height || 1080}p`,
          media,
          analysisSummary: analysisSummary || proj.analysisSummary || null,
        };
        state.playback.duration = state.project.durationSec;
        if (Array.isArray(proj.chatMessages)) {
          state.chat.messages = proj.chatMessages.map((m: any) => ({
            ...m,
            timestamp: m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : m.timestamp ||
                new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
        } else {
          state.chat.messages = [];
        }
      }),

    setPlan: (plan) =>
      set((state) => {
        state.plan.current = plan;
        state.plan.draft = null;
        state.plan.version = plan.version;
        if (state.project) {
          state.project.headVersion = plan.version;
        }
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
          state.preview.stale = true;
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

          // Seamlessly restore preview URL for undone version
          if (state.preview.versionUrlMap?.[targetVersion]) {
            state.preview.url = state.preview.versionUrlMap[targetVersion];
            state.preview.planVersion = targetVersion;
            state.preview.isRendered = true;
            state.preview.stale = false;
          } else {
            // Revert back to clean source video so baked pixels from the undone edit disappear immediately
            if (state.preview.baseProxyUrl) {
              state.preview.url = state.preview.baseProxyUrl;
            }
            state.preview.planVersion = targetVersion;
            state.preview.isRendered = false;
            state.preview.stale = true;
          }
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

          // Seamlessly restore preview URL for redone version
          if (state.preview.versionUrlMap?.[targetVersion]) {
            state.preview.url = state.preview.versionUrlMap[targetVersion];
            state.preview.planVersion = targetVersion;
            state.preview.isRendered = true;
            state.preview.stale = false;
          } else {
            if (state.preview.baseProxyUrl) {
              state.preview.url = state.preview.baseProxyUrl;
            }
            state.preview.planVersion = targetVersion;
            state.preview.isRendered = false;
            state.preview.stale = true;
          }
        }
      }),

    setCurrentTime: (timeSec) =>
      set((state) => {
        state.playback.currentTime = Math.max(0, Math.min(timeSec, state.playback.duration));
      }),

    setDuration: (durationSec) =>
      set((state) => {
        if (Number.isFinite(durationSec) && durationSec > 0) {
          state.playback.duration = durationSec;
          if (state.project) {
            state.project.durationSec = Math.max(state.project.durationSec || 0, durationSec);
          }
        }
      }),

    setPlaybackStatus: (status) =>
      set((state) => {
        state.playback.status = status;
      }),

    registerVideoElement: (el) =>
      set((state) => {
        state.activeVideoElement = el as any;
      }),

    togglePlayback: () => {
      const el = get().activeVideoElement;
      if (el) {
        if (el.paused) {
          el.play().catch(() => {});
          set((state) => {
            state.playback.status = 'playing';
          });
        } else {
          el.pause();
          set((state) => {
            state.playback.status = 'paused';
          });
        }
      } else {
        set((state) => {
          state.playback.status = state.playback.status === 'playing' ? 'paused' : 'playing';
        });
      }
    },

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

        // If any selected ID belongs to a cue, filter it out from project.analysisSummary.cues
        if (state.project?.analysisSummary?.cues) {
          const cues = state.project.analysisSummary.cues;
          const remainingCues = cues.filter((c, idx) => {
            const cueUniqueId = c.id || `cue_${idx + 1}`;
            if (toDelete.has(cueUniqueId)) return false;
            if (!c.id && toDelete.has(`cue_${idx}`)) return false;
            return true;
          });
          if (remainingCues.length !== cues.length) {
            state.project.analysisSummary.cues = remainingCues;
            state.project.analysisSummary.cuesCount = remainingCues.length;
            if (state.project.id) {
              api.updateCaptions(state.project.id, remainingCues).catch(() => {});
            }
          }
        }

        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }

        if (state.plan.draft) {
          state.plan.draft.layers = state.plan.draft.layers.filter((l) => !toDelete.has(l.id));
        }
        state.timeline.selectedLayerIds = [];
      }),

    updateLayerRange: (layerId, startSec, endSec) =>
      set((state) => {
        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (state.plan.draft) {
          const layer = state.plan.draft.layers.find((l) => l.id === layerId);
          if (layer) {
            const cleanStart = Math.max(0, Number(startSec.toFixed(3)));
            const cleanEnd = Math.max(cleanStart + 0.05, Number(endSec.toFixed(3)));
            if (!layer.range) {
              layer.range = { start: cleanStart, end: cleanEnd };
            } else {
              layer.range.start = cleanStart;
              layer.range.end = cleanEnd;
            }
            state.preview.stale = true;
          }
        }
      }),

    splitLayerAtTime: (timeSec, layerId) => {
      let splitSuccess = false;
      const state = get();
      const totalDur = state.playback.duration || 60;
      const splitPoint = Number(timeSec.toFixed(3));

      if (splitPoint <= 0.05 || splitPoint >= totalDur - 0.05) return false;

      // 1. If target is a subtitle cue or starts with cue_, split subtitle cue
      const selectedId = layerId || state.timeline.selectedLayerIds[0];
      if (selectedId && (selectedId.startsWith('cue_') || selectedId.startsWith('cue'))) {
        return get().splitSubtitleCueAtTime(timeSec);
      }

      // Check if playhead is directly over a subtitle cue
      const currentCues = state.project?.analysisSummary?.cues;
      const curMs = Math.round(timeSec * 1000);
      const cueUnderPlayhead = currentCues?.find(
        (c) => curMs >= c.startMs + 80 && curMs <= c.endMs - 80
      );

      // If user specifically clicked a subtitle track or clip
      if (selectedId?.includes('subtitle') && cueUnderPlayhead) {
        return get().splitSubtitleCueAtTime(timeSec);
      }

      set((draftState) => {
        if (!draftState.plan.draft && draftState.plan.current) {
          draftState.plan.draft = JSON.parse(JSON.stringify(draftState.plan.current));
        }
        const draft = draftState.plan.draft;
        if (!draft) return;

        let targetLayerIndex = -1;

        if (selectedId && selectedId !== 'base_video' && !selectedId.startsWith('seg_')) {
          targetLayerIndex = draft.layers.findIndex((l) => {
            if (l.id !== selectedId || !l.enabled) return false;
            const start = l.range?.start ?? 0;
            const end = l.range?.end ?? totalDur;
            return splitPoint > start + 0.05 && splitPoint < end - 0.05;
          });
        }

        // If a specific splittable layer (e.g. Text, Speed, Overlay) was selected and found, split it
        if (targetLayerIndex !== -1) {
          const originalLayer = draft.layers[targetLayerIndex];
          const singletonTypes = ['color', 'subtitle', 'audio', 'music', 'intro', 'outro'];
          if (!singletonTypes.includes(originalLayer.layer)) {
            const origStart = originalLayer.range?.start ?? 0;
            const originalEnd = originalLayer.range?.end ?? totalDur;

            originalLayer.range = {
              start: origStart,
              end: splitPoint,
            };

            const newLayer = JSON.parse(JSON.stringify(originalLayer));
            newLayer.id = `l_${Date.now()}_split`;
            newLayer.range = {
              start: splitPoint,
              end: originalEnd,
            };

            draft.layers.splice(targetLayerIndex + 1, 0, newLayer);
            draftState.timeline.selectedLayerIds = [newLayer.id];
            draftState.preview.stale = true;
            splitSuccess = true;
            return;
          }
        }

        // If playhead spans a subtitle cue and no other specific layer is selected, delegate to cue split
        if (!selectedId && cueUnderPlayhead) {
          return;
        }

        // Split the video sequence by creating a razor cut marker at splitPoint
        const newCutEnd = Math.min(totalDur, splitPoint + 0.5);
        const newCutLayer = {
          id: `l_${Date.now()}_cut`,
          layer: 'cut' as const,
          enabled: true,
          timebase: 'source' as const,
          range: {
            start: splitPoint,
            end: Number(newCutEnd.toFixed(3)),
          },
          params: {
            reason: 'user' as const,
          },
        };
        draft.layers.push(newCutLayer);
        draftState.timeline.selectedLayerIds = [newCutLayer.id];
        draftState.preview.stale = true;
        splitSuccess = true;
      });

      if (!splitSuccess && cueUnderPlayhead && (!selectedId || selectedId === 'base_video')) {
        return get().splitSubtitleCueAtTime(timeSec);
      }

      return splitSuccess;
    },

    splitSubtitleCueAtTime: (timeSec) => {
      let splitSuccess = false;
      const curMs = Math.round(timeSec * 1000);
      const state = get();
      const currentCues = state.project?.analysisSummary?.cues;
      if (!currentCues || currentCues.length === 0) return false;

      const cueIdx = currentCues.findIndex(
        (c) => curMs >= c.startMs + 100 && curMs <= c.endMs - 100
      );
      if (cueIdx === -1) return false;

      const cue = currentCues[cueIdx];
      const cueTokens = (cue.text || '').trim().split(/\s+/).filter(Boolean);
      if (cueTokens.length <= 1) return false;

      // Split words into two halves based on timestamp
      const allWords =
        cue.words && cue.words.length > 0
          ? cue.words
          : computeNaturalWordTimings(cueTokens, cue.startMs, cue.endMs);

      const firstWords = allWords.filter((w: any) => (w.endMs ?? w.e ?? 0) <= curMs);
      const secondWords = allWords.filter((w: any) => (w.startMs ?? w.s ?? 0) > curMs);

      // Fallback if boundary wasn't clean between words: split tokens by index proportion
      let text1 = firstWords
        .map((w: any) => w.word || w.w || '')
        .join(' ')
        .trim();
      let text2 = secondWords
        .map((w: any) => w.word || w.w || '')
        .join(' ')
        .trim();

      if (!text1 || !text2) {
        const midIdx = Math.max(1, Math.floor(cueTokens.length / 2));
        text1 = cueTokens.slice(0, midIdx).join(' ');
        text2 = cueTokens.slice(midIdx).join(' ');
      }

      const cue1 = {
        ...cue,
        id: cue.id || `cue_${cueIdx + 1}`,
        endMs: curMs,
        text: text1,
        words: computeNaturalWordTimings(
          text1.split(/\s+/).filter(Boolean),
          cue.startMs,
          curMs
        ) as any,
      };

      const cue2 = {
        id: `cue_${Date.now()}_split`,
        startMs: curMs + 30,
        endMs: cue.endMs,
        text: text2,
        words: computeNaturalWordTimings(
          text2.split(/\s+/).filter(Boolean),
          curMs + 30,
          cue.endMs
        ) as any,
      };

      const newCues = [...currentCues];
      newCues.splice(cueIdx, 1, cue1, cue2);

      get().updateCues(newCues);
      return true;
    },

    moveClip: (clipId, newStartSec, newEndSec, isCue = false, cueIndex) =>
      set((state) => {
        const cleanStart = Math.max(0, Number(newStartSec.toFixed(3)));
        const cleanEnd = Math.max(cleanStart + 0.1, Number(newEndSec.toFixed(3)));

        if (isCue && cueIndex !== undefined) {
          if (!state.project?.analysisSummary?.cues) return;
          const target = state.project.analysisSummary.cues[cueIndex];
          if (!target) return;
          const startMs = Math.round(cleanStart * 1000);
          const endMs = Math.round(cleanEnd * 1000);
          const tokens = (target.text || '').trim().split(/\s+/).filter(Boolean);
          target.startMs = startMs;
          target.endMs = endMs;
          target.words = computeNaturalWordTimings(
            tokens,
            startMs,
            endMs,
            target.words as any
          ) as any;
          return;
        }

        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (state.plan.draft) {
          const layer = state.plan.draft.layers.find((l) => l.id === clipId);
          if (layer) {
            layer.range = {
              start: cleanStart,
              end: cleanEnd,
            };
            state.preview.stale = true;
          }
        }
      }),

    duplicateLayer: (layerId) =>
      set((state) => {
        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (!state.plan.draft) return;
        const target = state.plan.draft.layers.find((l) => l.id === layerId);
        if (!target) return;

        const singletonTypes = ['color', 'subtitle', 'audio', 'music', 'intro', 'outro'];
        if (singletonTypes.includes(target.layer)) {
          return;
        }

        const clone = JSON.parse(JSON.stringify(target));
        clone.id = `lyr_${clone.layer}_${Date.now()}`;
        if (clone.range) {
          const dur = clone.range.end - clone.range.start;
          clone.range.start = Number((clone.range.end + 0.5).toFixed(3));
          clone.range.end = Number((clone.range.start + dur).toFixed(3));
        }
        state.plan.draft.layers.push(clone);
        state.timeline.selectedLayerIds = [clone.id];
        state.preview.stale = true;
      }),

    duplicateCue: (cueIndex) =>
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        const cues = state.project.analysisSummary.cues;
        const target = cues[cueIndex];
        if (!target) return;

        const durMs = target.endMs - target.startMs;
        const clone = {
          ...JSON.parse(JSON.stringify(target)),
          id: `cue_user_${Date.now()}`,
          startMs: target.endMs + 300,
          endMs: target.endMs + 300 + durMs,
        };
        cues.splice(cueIndex + 1, 0, clone);
        state.project.analysisSummary.cuesCount = cues.length;
        state.timeline.selectedLayerIds = [clone.id];
      }),

    addTimelineLayer: (type) =>
      set((state) => {
        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (!state.plan.draft) return;
        const playhead = state.playback.currentTime;
        const totalDur = state.playback.duration || 60;
        const startSec = Math.max(0, Math.min(playhead, totalDur - 1));
        const endSec = Math.min(totalDur, startSec + 4.0);
        const newId = `lyr_${type}_${Date.now()}`;

        let newLayer: EditLayer;
        switch (type) {
          case 'text':
            newLayer = {
              id: newId,
              layer: 'text',
              enabled: true,
              timebase: 'source',
              range: { start: Number(startSec.toFixed(2)), end: Number(endSec.toFixed(2)) },
              params: {
                content: 'Graphic Title Overlay',
                animation: 'fade',
                position: { x: 0.5, y: 0.8 },
                font: 'Montserrat',
                size: 48,
                color: '#FFF5F5',
              },
            };
            break;
          case 'music': {
            const existingMusic = state.plan.draft.layers.find((l) => l.layer === 'music');
            if (existingMusic) {
              existingMusic.enabled = true;
              state.timeline.selectedLayerIds = [existingMusic.id];
              state.preview.stale = true;
              return;
            }
            newLayer = {
              id: newId,
              layer: 'music',
              enabled: true,
              timebase: 'output',
              params: {
                trackId: 'ambient_soundtrack',
                volume: 0.7,
                duckUnderSpeech: true,
              },
            };
            break;
          }
          case 'color': {
            const existingColor = state.plan.draft.layers.find((l) => l.layer === 'color');
            if (existingColor) {
              existingColor.enabled = true;
              state.timeline.selectedLayerIds = [existingColor.id];
              state.preview.stale = true;
              return;
            }
            newLayer = {
              id: newId,
              layer: 'color',
              enabled: true,
              timebase: 'global',
              params: {
                preset: 'cinematic',
                contrast: 1.05,
                saturation: 1.1,
                brightness: 0,
              },
            };
            break;
          }
          case 'overlay':
            newLayer = {
              id: newId,
              layer: 'overlay',
              enabled: true,
              timebase: 'source',
              range: {
                start: Number(startSec.toFixed(2)),
                end: Number(Math.min(totalDur, startSec + 3.0).toFixed(2)),
              },
              params: {
                asset: 'broll_tech',
                mediaType: 'broll',
                mode: 'cutaway',
                scale: 1.0,
                opacity: 1.0,
                fit: 'cover',
                position: { x: 0.5, y: 0.5 },
              },
            };
            break;
          case 'cut':
            newLayer = {
              id: newId,
              layer: 'cut',
              enabled: true,
              timebase: 'source',
              range: {
                start: Number(startSec.toFixed(2)),
                end: Number(Math.min(totalDur, startSec + 1.0).toFixed(2)),
              },
              params: {
                reason: 'user',
              },
            };
            break;
          case 'subtitle': {
            const existingSub = state.plan.draft.layers.find((l) => l.layer === 'subtitle');
            if (existingSub) {
              existingSub.enabled = true;
              state.timeline.selectedLayerIds = [existingSub.id];
              state.preview.stale = true;
              return;
            }
            newLayer = {
              id: newId,
              layer: 'subtitle',
              enabled: true,
              timebase: 'source',
              params: {
                style: 'word_pop',
                font: 'Montserrat',
                size: 48,
                position: 'bottom',
                primaryColor: '#FFF5F5',
                highlightColor: '#F7D7D1',
                maxWordsPerLine: 6,
              },
            };
            break;
          }
          case 'audio': {
            const existingAudio = state.plan.draft.layers.find((l) => l.layer === 'audio');
            if (existingAudio) {
              existingAudio.enabled = true;
              state.timeline.selectedLayerIds = [existingAudio.id];
              state.preview.stale = true;
              return;
            }
            newLayer = {
              id: newId,
              layer: 'audio',
              enabled: true,
              timebase: 'global',
              params: {
                normalizeLufs: -16,
                denoise: true,
              },
            };
            break;
          }
          default:
            return;
        }

        state.plan.draft.layers.push(newLayer);
        state.timeline.selectedLayerIds = [newId];
        state.preview.stale = true;
      }),

    toggleTrackMute: (trackId) =>
      set((state) => {
        if (!state.timeline.trackStates) state.timeline.trackStates = {};
        const curr = state.timeline.trackStates[trackId] || {};
        const nextMuted = !curr.muted;
        state.timeline.trackStates[trackId] = { ...curr, muted: nextMuted };

        if (trackId === 'trk_audio' || trackId === 'trk_music') {
          if (!state.plan.draft && state.plan.current) {
            state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
          }
          if (state.plan.draft) {
            const targetType = trackId === 'trk_music' ? 'music' : 'audio';
            state.plan.draft.layers.forEach((l) => {
              if (l.layer === targetType) {
                l.enabled = !nextMuted;
              }
            });
            state.preview.stale = true;
          }
        }
      }),

    toggleTrackLock: (trackId) =>
      set((state) => {
        if (!state.timeline.trackStates) state.timeline.trackStates = {};
        const curr = state.timeline.trackStates[trackId] || {};
        state.timeline.trackStates[trackId] = { ...curr, locked: !curr.locked };
      }),

    toggleTrackHidden: (trackId) =>
      set((state) => {
        if (!state.timeline.trackStates) state.timeline.trackStates = {};
        const curr = state.timeline.trackStates[trackId] || {};
        const nextHidden = !curr.hidden;
        state.timeline.trackStates[trackId] = { ...curr, hidden: nextHidden };

        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        if (state.plan.draft) {
          const kindMap: Record<string, string[]> = {
            trk_video: ['video', 'cut', 'speed', 'intro', 'outro'],
            trk_broll: ['overlay'],
            trk_subtitle: ['subtitle'],
            trk_text: ['text'],
            trk_music: ['music'],
            trk_audio: ['audio'],
            trk_fx: ['color', 'transition'],
          };
          const layerTypes = kindMap[trackId] || [];
          state.plan.draft.layers.forEach((l) => {
            if (layerTypes.includes(l.layer)) {
              l.enabled = !nextHidden;
            }
          });
          state.preview.stale = true;
        }
      }),

    addChatMessage: (msg) =>
      set((state) => {
        state.chat.messages.push({
          ...msg,
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }),

    setChatMessages: (messages) =>
      set((state) => {
        state.chat.messages = messages;
      }),

    clearChat: () =>
      set((state) => {
        state.chat.messages = [];
        state.chat.pending = false;
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

    updateCues: (cues) =>
      set((state) => {
        if (state.project) {
          if (!state.project.analysisSummary) {
            state.project.analysisSummary = {
              durationMs: (state.project.durationSec || 60) * 1000,
              silencesCount: 0,
              sceneCutsCount: 0,
              bpm: 120,
              integratedLufs: -16,
              cues: [],
            };
          }
          state.project.analysisSummary.cues = cues;
          state.project.analysisSummary.cuesCount = cues.length;
          state.project.analysisSummary.wordCount = cues.reduce(
            (sum, c) => sum + (c.words?.length || c.text?.split(/\s+/).filter(Boolean).length || 0),
            0
          );
          state.project.analysisSummary.transcriptSnippet = cues
            .slice(0, 3)
            .map((c) => c.text)
            .join(' ');
        }
      }),

    updateCueText: (index, newText) =>
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        const cues = state.project.analysisSummary.cues;
        const target = cues[index];
        if (!target) return;

        const tokens = newText.trim().split(/\s+/).filter(Boolean);
        const newWords = computeNaturalWordTimings(
          tokens,
          target.startMs,
          target.endMs,
          target.words as any
        );

        target.text = newText;
        target.words = newWords as any;
        state.project.analysisSummary.wordCount = cues.reduce(
          (sum, c) => sum + (c.words?.length || c.text?.split(/\s+/).filter(Boolean).length || 0),
          0
        );
      }),

    updateCueTiming: (index, startSec, endSec) =>
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        const cues = state.project.analysisSummary.cues;
        const target = cues[index];
        if (!target) return;

        const newStartMs = Math.max(0, Math.round(startSec * 1000));
        const newEndMs = Math.max(newStartMs + 100, Math.round(endSec * 1000));

        const tokens = (target.text || '').trim().split(/\s+/).filter(Boolean);
        const newWords = computeNaturalWordTimings(
          tokens,
          newStartMs,
          newEndMs,
          target.words as any
        );

        target.startMs = newStartMs;
        target.endMs = newEndMs;
        target.words = newWords as any;
      }),

    updateCueSpeaker: (index, speaker) => {
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        const target = state.project.analysisSummary.cues[index];
        if (target) {
          target.speaker = speaker.trim() || 'Speaker 1';
        }
      });
      const latestCues = get().project?.analysisSummary?.cues || [];
      const pid = get().project?.id;
      if (pid) {
        api.updateCaptions(pid, latestCues).catch(() => {});
      }
    },

    deleteCue: (index) => {
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        state.project.analysisSummary.cues.splice(index, 1);
        state.project.analysisSummary.cuesCount = state.project.analysisSummary.cues.length;
        state.project.analysisSummary.wordCount = state.project.analysisSummary.cues.reduce(
          (sum, c) => sum + (c.words?.length || c.text?.split(/\s+/).filter(Boolean).length || 0),
          0
        );
      });
      const latestCues = get().project?.analysisSummary?.cues || [];
      const pid = get().project?.id;
      if (pid) {
        api.updateCaptions(pid, latestCues).catch(() => {});
      }
    },

    cleanEmptySubtitleCues: () => {
      const state = get();
      if (!state.project?.analysisSummary?.cues) return 0;
      const cues = state.project.analysisSummary.cues as any[];
      const cleaned = cleanEmptyCues(cues);
      const removedCount = cues.length - cleaned.length;
      if (removedCount > 0) {
        state.updateCues(cleaned as any);
        if (state.project.id) {
          api.updateCaptions(state.project.id, cleaned).catch(() => {});
        }
      }
      return removedCount;
    },

    renameSpeaker: (oldName: string, newName: string) => {
      const state = get();
      if (!state.project?.analysisSummary?.cues) return;
      const cues = state.project.analysisSummary.cues as any[];
      const updated = renameSpeakerInCues(cues, oldName, newName);
      state.updateCues(updated as any);
      if (state.project.id) {
        api.updateCaptions(state.project.id, updated).catch(() => {});
      }
    },

    setToolMode: (mode) =>
      set((state) => {
        state.timeline.toolMode = mode;
      }),

    setPreviewUrl: (url, planVersion, isRendered = false, baseProxyUrl) =>
      set((state) => {
        state.preview.url = url;
        state.preview.planVersion = planVersion;
        state.preview.stale = false;
        state.preview.mode = 'proxy';
        state.preview.isRendered = isRendered;
        if (baseProxyUrl) {
          state.preview.baseProxyUrl = baseProxyUrl;
        } else if (!state.preview.baseProxyUrl && !isRendered) {
          state.preview.baseProxyUrl = url;
        }
        if (!state.preview.versionUrlMap) {
          state.preview.versionUrlMap = {};
        }
        if (isRendered) {
          state.preview.versionUrlMap[planVersion] = url;
        }
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
  cueIndex?: number;
  cueId?: string;
  color?: string;
  speaker?: string;
  speakerColor?: string;
  isEmpty?: boolean;
}

export interface DerivedTrackVM {
  id: string;
  kind: 'video' | 'subtitle' | 'text' | 'music' | 'fx';
  name: string;
  clips: TrackClipVM[];
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
}

// High-performance cache for selectDerivedTracks to guarantee 60fps scrubbing with 500+ operations
let lastDerivedPlanRef: any = null;
let lastDerivedDuration: number = -1;
let lastDerivedCuesRef: any = null;
let lastDerivedTrackStatesRef: any = null;
let cachedDerivedTracks: DerivedTrackVM[] = [];

export const clearDerivedTracksCache = () => {
  lastDerivedPlanRef = null;
  lastDerivedDuration = -1;
  lastDerivedCuesRef = null;
  lastDerivedTrackStatesRef = null;
  cachedDerivedTracks = [];
};

export const selectDerivedTracks = (state: EditorStoreState): DerivedTrackVM[] => {
  const plan = selectEffectivePlan(state);
  const totalDuration = state.playback.duration || state.project?.durationSec || 60;
  const cues = state.project?.analysisSummary?.cues;
  const trackStates = state.timeline.trackStates || {};

  if (!plan) return [];

  // Instant O(1) cache hit when scrub/playback head advances without plan mutations
  if (
    plan === lastDerivedPlanRef &&
    totalDuration === lastDerivedDuration &&
    cues === lastDerivedCuesRef &&
    trackStates === lastDerivedTrackStatesRef
  ) {
    return cachedDerivedTracks;
  }

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

  // Base video source & cuts segmentation
  const introOffset = introLayer ? introLayer.params.duration || 3 : 0;
  const outroDur = outroLayer ? outroLayer.params.duration || 3 : 0;
  const mainVideoStart = introOffset;
  const mainVideoEnd = Math.max(introOffset, totalDuration - outroDur);

  if (cutLayers.length === 0) {
    videoClips.push({
      id: 'base_video',
      label: 'Main Video Source',
      startSec: mainVideoStart,
      durSec: Math.max(0.1, mainVideoEnd - mainVideoStart),
      type: 'video',
      layerId: 'base_video',
    });
  } else {
    // Sort cuts chronologically
    const sortedCuts = [...cutLayers].sort((a, b) => (a.range?.start || 0) - (b.range?.start || 0));

    let cursor = mainVideoStart;
    let clipNum = 1;

    for (const cut of sortedCuts) {
      const cutStart = Math.max(mainVideoStart, cut.range?.start || 0);
      const cutEnd = Math.min(mainVideoEnd, cut.range?.end || cutStart + 1.0);

      if (cutStart > cursor + 0.05) {
        const segId = `seg_${clipNum++}`;
        videoClips.push({
          id: segId,
          label: `Footage (${cursor.toFixed(1)}s - ${cutStart.toFixed(1)}s)`,
          startSec: cursor,
          durSec: cutStart - cursor,
          type: 'video',
          layerId: segId,
        });
      }

      const r = cut.params?.reason;
      let cutLabel = `Cut: ${r || 'user'} (${(cutEnd - cutStart).toFixed(2)}s)`;
      if (r === 'repeated_take') {
        cutLabel = `🚫 Cut: Repeated Take (${(cutEnd - cutStart).toFixed(2)}s)`;
      } else if (r === 'tighten_pacing') {
        cutLabel = `⚡ Cut: Tightened Opening (${(cutEnd - cutStart).toFixed(2)}s)`;
      } else if (r === 'silence') {
        cutLabel = `Cut: Silence (${(cutEnd - cutStart).toFixed(2)}s)`;
      } else if (r === 'short_extraction_trim') {
        cutLabel = `Cut: Short Trim (${(cutEnd - cutStart).toFixed(2)}s)`;
      }

      videoClips.push({
        id: cut.id,
        label: cutLabel,
        startSec: cutStart,
        durSec: Math.max(0.1, cutEnd - cutStart),
        type: 'cut',
        layerId: cut.id,
        layerRef: cut,
      });

      cursor = Math.max(cursor, cutEnd);
    }

    if (cursor < mainVideoEnd - 0.05) {
      const segId = `seg_${clipNum}`;
      videoClips.push({
        id: segId,
        label: `Footage (${cursor.toFixed(1)}s - ${mainVideoEnd.toFixed(1)}s)`,
        startSec: cursor,
        durSec: mainVideoEnd - cursor,
        type: 'video',
        layerId: segId,
      });
    }
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

  // Track 2: B-Roll & Visual Media Track
  const overlayLayers = plan.layers.filter((l) => l.enabled && l.layer === 'overlay') as any[];
  if (overlayLayers.length > 0) {
    tracks.push({
      id: 'trk_broll',
      kind: 'video',
      name: 'V2: B-Roll & Visual Media',
      clips: overlayLayers.map((ov) => {
        const s = ov.range?.start || 0;
        const e = ov.range?.end || Math.min(totalDuration, s + 3.0);
        const mediaType =
          ov.params?.mediaType ||
          (ov.params?.asset?.startsWith('http') || ov.params?.asset?.startsWith('data:')
            ? 'image'
            : ov.params?.prompt
              ? 'generative'
              : 'broll');
        const mode = ov.params?.mode || 'cutaway';
        const label = ov.params?.prompt
          ? `AI Gen: "${ov.params.prompt.slice(0, 20)}..."`
          : mediaType === 'image'
            ? `Image: ${ov.params?.asset?.replace(/^.*[\\/]/, '') || 'graphic'}`
            : `B-Roll: ${ov.params?.asset || 'cutaway'}`;

        return {
          id: ov.id,
          label: `${label} (${(e - s).toFixed(1)}s)`,
          startSec: s,
          durSec: Math.max(0.2, e - s),
          type: 'overlay',
          layerId: ov.id,
          layerRef: ov,
          mediaType,
          mode,
          asset: ov.params?.asset,
        };
      }),
    });
  }

  // Track 2: Subtitle Track
  const subtitleLayer = plan.layers.find((l) => l.enabled && l.layer === 'subtitle') as any;
  if (subtitleLayer) {
    const cues = state.project?.analysisSummary?.cues;
    if (cues && cues.length > 0) {
      tracks.push({
        id: 'trk_subtitle',
        kind: 'subtitle',
        name: 'T1: Subtitles',
        clips: cues.map((c, idx) => {
          const cueUniqueId = c.id || `cue_${idx + 1}`;
          const cleanText = (c.text || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
          const isEmpty = cleanText.length === 0;
          const speaker = (c.speaker || 'Speaker 1').trim();
          const speakerColor = getSpeakerColor(speaker);
          return {
            id: cueUniqueId,
            label: isEmpty ? '[Empty Caption]' : `"${cleanText}"`,
            startSec: Number((c.startMs / 1000).toFixed(2)),
            durSec: Math.max(0.15, Number(((c.endMs - c.startMs) / 1000).toFixed(2))),
            type: 'subtitle',
            layerId: cueUniqueId,
            layerRef: subtitleLayer,
            cueIndex: idx,
            cueId: cueUniqueId,
            speaker,
            speakerColor,
            isEmpty,
          };
        }),
      });
    } else {
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

  // Track 4: Background Music Track (A1)
  const musicLayers = plan.layers.filter((l) => l.enabled && l.layer === 'music') as any[];
  if (musicLayers.length > 0) {
    tracks.push({
      id: 'trk_music',
      kind: 'music',
      name: 'A1: Background Music',
      clips: musicLayers.map((ml) => {
        const s = ml.range?.start ?? 0;
        const e = ml.range?.end ?? totalDuration;
        const duck = ml.params?.duckUnderSpeech !== false;
        const volPct = Math.round((ml.params?.volume ?? 0.35) * 100);
        return {
          id: ml.id,
          label: `Music: ${ml.params?.trackId || 'Soundtrack'} (${volPct}% vol${duck ? ', Auto-Duck' : ''})`,
          startSec: s,
          durSec: Math.max(0.5, e - s),
          type: 'music',
          layerId: ml.id,
          layerRef: ml,
        };
      }),
    });
  }

  // Track 5: Dialogue & Audio FX Track (A2)
  const audioLayers = plan.layers.filter((l) => l.enabled && l.layer === 'audio') as any[];
  if (audioLayers.length > 0) {
    tracks.push({
      id: 'trk_audio',
      kind: 'music',
      name: 'A2: Dialogue & Audio FX',
      clips: audioLayers.map((al) => {
        const s = al.range?.start ?? 0;
        const e = al.range?.end ?? totalDuration;
        const lufs = al.params?.normalizeLufs ?? -16;
        const denoise = al.params?.denoise;
        return {
          id: al.id,
          label: `Audio Cleanup: ${lufs} LUFS${denoise ? ' (AI Denoise)' : ''}`,
          startSec: s,
          durSec: Math.max(0.5, e - s),
          type: 'music',
          layerId: al.id,
          layerRef: al,
        };
      }),
    });
  }

  // Track 5: FX Track (Color LUT & Transitions)
  const colorLayers = plan.layers.filter((l) => l.enabled && l.layer === 'color') as any[];
  const transitionLayers = plan.layers.filter(
    (l) => l.enabled && l.layer === 'transition'
  ) as any[];
  if (colorLayers.length > 0 || transitionLayers.length > 0) {
    const fxClips: TrackClipVM[] = [];
    for (const cl of colorLayers) {
      const s = cl.range?.start ?? 0;
      const e = cl.range?.end ?? totalDuration;
      fxClips.push({
        id: cl.id,
        label: `Color Grade: ${cl.params?.preset || 'cinematic'} (contrast: ${cl.params?.contrast ?? 1}, sat: ${cl.params?.saturation ?? 1})`,
        startSec: s,
        durSec: Math.max(0.2, e - s),
        type: 'color',
        layerId: cl.id,
        layerRef: cl,
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

  const resultTracks = tracks.map((t) => ({
    ...t,
    locked: trackStates[t.id]?.locked ?? false,
    muted: trackStates[t.id]?.muted ?? false,
    hidden: trackStates[t.id]?.hidden ?? false,
  }));

  cachedDerivedTracks = resultTracks;
  lastDerivedPlanRef = plan;
  lastDerivedDuration = totalDuration;
  lastDerivedCuesRef = cues;
  lastDerivedTrackStatesRef = trackStates;

  return resultTracks;
};

// High-performance cache for selectMediaIndex
let lastMediaCuesRef: any = null;
let lastMediaSceneCutsRef: any = null;
let lastMediaDurationSec: number = -1;
let cachedMediaIndex: MediaIndexSummary | null = null;

export const selectMediaIndex = (state: EditorStoreState): MediaIndexSummary => {
  const cues = state.project?.analysisSummary?.cues || [];
  const rawSceneCuts = state.project?.analysisSummary?.sceneCuts || [];
  const durationSec = state.playback.duration || state.project?.durationSec || 60;

  if (
    cachedMediaIndex &&
    cues === lastMediaCuesRef &&
    rawSceneCuts === lastMediaSceneCutsRef &&
    durationSec === lastMediaDurationSec
  ) {
    return cachedMediaIndex;
  }

  const sceneCutSecs = rawSceneCuts.map((c: any) =>
    typeof c === 'number' ? c : c?.timeMs ? c.timeMs / 1000 : 0
  );
  const result = buildMediaIndex(cues as any, sceneCutSecs, durationSec);

  cachedMediaIndex = result;
  lastMediaCuesRef = cues;
  lastMediaSceneCutsRef = rawSceneCuts;
  lastMediaDurationSec = durationSec;

  return result;
};
