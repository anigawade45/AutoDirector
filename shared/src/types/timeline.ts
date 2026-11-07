export type TrackKind = 'video' | 'audio' | 'music' | 'subtitle' | 'text' | 'overlay';
export type ClipType =
  'video' | 'audio' | 'music' | 'subtitle' | 'text' | 'overlay' | 'intro' | 'outro';
export type EffectType =
  'color' | 'blur' | 'vignette' | 'grain' | 'speed_ramp' | 'denoise' | 'normalize' | 'stabilize';
export type MarkerKind = 'user' | 'scene' | 'beat';

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface KeyframePoint {
  tMs: number; // relative to clip start
  value: unknown;
  ease?: string;
}

export interface TransitionOut {
  type: string;
  durMs: number;
  easing?: string;
}

export interface ClipOrigin {
  layerId: string;
  source: 'ai' | 'manual' | 'import';
}

export interface ClipTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export interface Clip {
  id: string; // "clp_xxxx"
  type: ClipType;
  startMs: number;
  durMs: number;
  enabled: boolean;

  // Type-specific references and parameters
  assetId?: string;
  catalogId?: string;
  captionSetId?: string;
  templateId?: string;

  srcInMs?: number;
  srcOutMs?: number;
  speed?: number;
  audioGainDb?: number;
  reverse?: boolean;

  transform?: ClipTransform;
  style?: Record<string, unknown>;
  params?: Record<string, unknown>;

  effects?: Effect[];
  keyframes?: Record<string, KeyframePoint[]>;
  transitionOut?: TransitionOut | null;
  origin?: ClipOrigin;
}

export interface Track {
  id: string; // "trk_xxxx"
  kind: TrackKind;
  order: number;
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  volumeDb?: number;
  clips: Clip[];
}

export interface Marker {
  id: string;
  tMs: number;
  label: string;
  kind: MarkerKind;
}

export interface Timeline {
  projectId: string;
  userId: string;
  rev: number;
  version: number;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  tracks: Track[];
  markers: Marker[];
  globalEffects: Effect[];
  sourcePlanId?: string | null;
}
