import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { EditPlan, EditLayer } from '@ai-video/shared';
import { computeNaturalWordTimings } from '../utils/subtitleTiming';
import { api } from '../api/client';

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

  // Actions
  setSelectedAiModel: (model: string) => void;
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
  addChatMessage: (msg: Omit<ChatMessageItem, 'id' | 'timestamp'>) => void;
  setChatMessages: (messages: ChatMessageItem[]) => void;
  clearChat: () => void;
  setChatPending: (pending: boolean) => void;
  updateJob: (jobId: string, update: Partial<EditorStoreState['jobs'][string]>) => void;
  updateCues: (cues: TranscriptCue[]) => void;
  updateCueText: (index: number, newText: string) => void;
  updateCueTiming: (index: number, startSec: number, endSec: number) => void;
  deleteCue: (index: number) => void;
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

    setSelectedAiModel: (model) =>
      set((state) => {
        state.selectedAiModel = model;
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
            return !toDelete.has(cueUniqueId) && !toDelete.has(`cue_${idx}`);
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
      set((state) => {
        if (!state.plan.draft && state.plan.current) {
          state.plan.draft = JSON.parse(JSON.stringify(state.plan.current));
        }
        const draft = state.plan.draft;
        if (!draft) return;

        const totalDur = state.playback.duration || 60;
        const targetId =
          layerId ||
          (state.timeline.selectedLayerIds.length > 0
            ? state.timeline.selectedLayerIds[0]
            : undefined);
        let targetLayerIndex = -1;

        if (targetId) {
          targetLayerIndex = draft.layers.findIndex((l) => {
            if (l.id !== targetId || !l.enabled) return false;
            const start = l.range?.start ?? 0;
            const end = l.range?.end ?? totalDur;
            return timeSec > start + 0.05 && timeSec < end - 0.05;
          });
        }

        if (targetLayerIndex === -1) {
          // Find any cut, speed, text, color, or overlay layer that spans timeSec
          targetLayerIndex = draft.layers.findIndex((l) => {
            if (!l.enabled) return false;
            const start = l.range?.start ?? 0;
            const end = l.range?.end ?? totalDur;
            return timeSec > start + 0.05 && timeSec < end - 0.05;
          });
        }

        if (targetLayerIndex !== -1) {
          const originalLayer = draft.layers[targetLayerIndex];
          const origStart = originalLayer.range?.start ?? 0;
          const originalEnd = originalLayer.range?.end ?? totalDur;
          const splitPoint = Number(timeSec.toFixed(3));

          // 1. Truncate original layer end
          originalLayer.range = {
            start: origStart,
            end: splitPoint,
          };

          // 2. Clone new split layer starting at splitPoint
          const newLayer = JSON.parse(JSON.stringify(originalLayer));
          newLayer.id = `l_${Date.now()}_split`;
          newLayer.range = {
            start: splitPoint,
            end: originalEnd,
          };

          // Insert right after original
          draft.layers.splice(targetLayerIndex + 1, 0, newLayer);
          state.timeline.selectedLayerIds = [newLayer.id];
          state.preview.stale = true;
          splitSuccess = true;
        } else {
          // If no existing layer spans timeSec, create a razor cut marker at timeSec
          const splitPoint = Number(timeSec.toFixed(3));
          const totalDur = state.playback.duration || 60;
          const newCutEnd = Math.min(totalDur, splitPoint + 1.0);
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
          state.timeline.selectedLayerIds = [newCutLayer.id];
          state.preview.stale = true;
          splitSuccess = true;
        }
      });
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
      let text1 = firstWords.map((w: any) => w.word || w.w || '').join(' ').trim();
      let text2 = secondWords.map((w: any) => w.word || w.w || '').join(' ').trim();

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
        words: computeNaturalWordTimings(text1.split(/\s+/).filter(Boolean), cue.startMs, curMs) as any,
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

    deleteCue: (index) =>
      set((state) => {
        if (!state.project?.analysisSummary?.cues) return;
        state.project.analysisSummary.cues.splice(index, 1);
        state.project.analysisSummary.cuesCount = state.project.analysisSummary.cues.length;
        state.project.analysisSummary.wordCount = state.project.analysisSummary.cues.reduce(
          (sum, c) => sum + (c.words?.length || c.text?.split(/\s+/).filter(Boolean).length || 0),
          0
        );
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
    });
  } else {
    // Sort cuts chronologically
    const sortedCuts = [...cutLayers].sort(
      (a, b) => (a.range?.start || 0) - (b.range?.start || 0)
    );

    let cursor = mainVideoStart;
    let clipNum = 1;

    for (const cut of sortedCuts) {
      const cutStart = Math.max(mainVideoStart, cut.range?.start || 0);
      const cutEnd = Math.min(mainVideoEnd, cut.range?.end || cutStart + 1.0);

      if (cutStart > cursor + 0.05) {
        videoClips.push({
          id: `seg_${clipNum++}`,
          label: `Footage (${cursor.toFixed(1)}s - ${cutStart.toFixed(1)}s)`,
          startSec: cursor,
          durSec: cutStart - cursor,
          type: 'video',
        });
      }

      videoClips.push({
        id: cut.id,
        label: `Cut: ${cut.params?.reason || 'user'} (${(cutEnd - cutStart).toFixed(2)}s)`,
        startSec: cutStart,
        durSec: Math.max(0.1, cutEnd - cutStart),
        type: 'cut',
        layerId: cut.id,
        layerRef: cut,
      });

      cursor = Math.max(cursor, cutEnd);
    }

    if (cursor < mainVideoEnd - 0.05) {
      videoClips.push({
        id: `seg_${clipNum}`,
        label: `Footage (${cursor.toFixed(1)}s - ${mainVideoEnd.toFixed(1)}s)`,
        startSec: cursor,
        durSec: mainVideoEnd - cursor,
        type: 'video',
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
          const cleanText = (c.text || '').trim();
          return {
            id: cueUniqueId,
            label: cleanText ? `"${cleanText}"` : `Cue ${idx + 1}`,
            startSec: Number((c.startMs / 1000).toFixed(2)),
            durSec: Math.max(0.15, Number(((c.endMs - c.startMs) / 1000).toFixed(2))),
            type: 'subtitle',
            layerId: cueUniqueId,
            layerRef: subtitleLayer,
            cueIndex: idx,
            cueId: cueUniqueId,
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

  // Track 4: Audio Mix Track (Music & Speech Audio)
  const musicLayers = plan.layers.filter((l) => l.enabled && l.layer === 'music') as any[];
  const audioLayers = plan.layers.filter((l) => l.enabled && l.layer === 'audio') as any[];
  if (musicLayers.length > 0 || audioLayers.length > 0) {
    const audioClips: TrackClipVM[] = [];
    for (const ml of musicLayers) {
      const s = ml.range?.start ?? 0;
      const e = ml.range?.end ?? totalDuration;
      audioClips.push({
        id: ml.id,
        label: `Music: ${ml.params?.trackId || 'Background Soundtrack'} (${ml.params?.duckUnderSpeech ? 'Speech Ducking' : 'Full Vol'}, ${Math.round((ml.params?.volume ?? 0.8) * 100)}%)`,
        startSec: s,
        durSec: Math.max(0.5, e - s),
        type: 'music',
        layerId: ml.id,
        layerRef: ml,
      });
    }
    for (const al of audioLayers) {
      const s = al.range?.start ?? 0;
      const e = al.range?.end ?? totalDuration;
      audioClips.push({
        id: al.id,
        label: `Audio: ${al.params?.name || 'Voice/FX Track'}`,
        startSec: s,
        durSec: Math.max(0.5, e - s),
        type: 'music',
        layerId: al.id,
        layerRef: al,
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
  const colorLayers = plan.layers.filter((l) => l.enabled && l.layer === 'color') as any[];
  const overlayLayers = plan.layers.filter((l) => l.enabled && l.layer === 'overlay') as any[];
  const transitionLayers = plan.layers.filter(
    (l) => l.enabled && l.layer === 'transition'
  ) as any[];
  if (colorLayers.length > 0 || overlayLayers.length > 0 || transitionLayers.length > 0) {
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
