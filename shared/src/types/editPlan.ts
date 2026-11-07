export type Timebase = 'source' | 'output' | 'global';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type VideoFPS = 24 | 25 | 30 | 60;
export type VideoResolution = '480p' | '720p' | '1080p' | '4k';

export interface GlobalVideoSettings {
  aspect: AspectRatio;
  fps: VideoFPS;
  resolution: VideoResolution;
  width?: number;
  height?: number;
  language?: string;
}

export interface BaseLayer {
  id: string; // e.g. "lyr_c1"
  layer: string;
  enabled: boolean;
  timebase: Timebase;
  range?: {
    start: number; // in seconds
    end: number; // in seconds
  };
}

export interface CutParams {
  reason: 'silence' | 'filler' | 'user' | 'lowlight';
  padding?: number; // 0 to 0.3s
}

export interface CutLayer extends BaseLayer {
  layer: 'cut';
  timebase: 'source';
  range: {
    start: number;
    end: number;
  };
  params: CutParams;
}

export interface SpeedParams {
  factor: number; // 0.25 to 4
  keepPitch: boolean;
}

export interface SpeedLayer extends BaseLayer {
  layer: 'speed';
  timebase: 'source';
  range: {
    start: number;
    end: number;
  };
  params: SpeedParams;
}

export type ColorPreset = 'cinematic' | 'warm' | 'cool' | 'bw' | 'vivid' | 'faded';

export interface ColorParams {
  preset?: ColorPreset;
  brightness?: number; // -0.3 to 0.3
  contrast?: number; // 0.7 to 1.5
  saturation?: number; // 0 to 2
  lut?: string; // catalog ID
  vignette?: number; // 0 to 1
  grain?: number; // 0 to 0.5
}

export interface ColorLayer extends BaseLayer {
  layer: 'color';
  timebase: 'global';
  params: ColorParams;
}

export type SubtitleStyle = 'classic' | 'word_pop' | 'karaoke' | 'minimal';
export type SubtitlePosition = 'bottom' | 'center' | 'top';

export interface SubtitleParams {
  style: SubtitleStyle;
  font?: string;
  size?: number; // 24 to 96
  position: SubtitlePosition;
  primaryColor?: string; // hex string
  highlightColor?: string; // hex string
  maxWordsPerLine?: number; // 2 to 8
}

export interface SubtitleLayer extends BaseLayer {
  layer: 'subtitle';
  timebase: 'source';
  params: SubtitleParams;
}

export type TextAnimation = 'fade' | 'slide_up' | 'typewriter' | 'scale';

export interface TextParams {
  content: string; // max 120 chars
  animation: TextAnimation;
  position: { x: number; y: number }; // normalized 0 to 1
  font?: string;
  size?: number;
  color?: string; // hex string
}

export interface TextLayer extends BaseLayer {
  layer: 'text';
  timebase: 'source' | 'output';
  params: TextParams;
}

export type TransitionType = 'fade' | 'dissolve' | 'wipeleft' | 'slideup' | 'zoom';

export interface TransitionParams {
  type: TransitionType;
  duration: number; // 0.2 to 1.5s
  at: number; // source time in seconds
}

export interface TransitionLayer extends BaseLayer {
  layer: 'transition';
  timebase: 'source';
  range: {
    start: number;
    end: number;
  };
  params: TransitionParams;
}

export interface TemplateParams {
  template: string; // catalog ID
  duration: number; // 2 to 10s
  text?: string;
  subtext?: string;
  theme?: string; // hex palette or name
}

export interface IntroLayer extends BaseLayer {
  layer: 'intro';
  timebase: 'output';
  range: {
    start: number;
    end: number;
  };
  params: TemplateParams;
}

export interface OutroLayer extends BaseLayer {
  layer: 'outro';
  timebase: 'output';
  range: {
    start: number;
    end: number;
  };
  params: TemplateParams;
}

export interface OverlayParams {
  asset: string; // catalog or asset ID
  position?: { x: number; y: number }; // 0 to 1
  scale?: number;
  opacity?: number;
}

export interface OverlayLayer extends BaseLayer {
  layer: 'overlay';
  timebase: 'source' | 'output';
  params: OverlayParams;
}

export interface MusicParams {
  trackId?: string;
  mood?: string;
  volume: number; // 0 to 1
  duckUnderSpeech: boolean;
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
  beatSync?: boolean;
}

export interface MusicLayer extends BaseLayer {
  layer: 'music';
  timebase: 'output';
  params: MusicParams;
}

export interface AudioParams {
  normalizeLufs: number; // -23 to -14
  denoise: boolean;
}

export interface AudioLayer extends BaseLayer {
  layer: 'audio';
  timebase: 'global';
  params: AudioParams;
}

export type EditLayer =
  | CutLayer
  | SpeedLayer
  | ColorLayer
  | SubtitleLayer
  | TextLayer
  | TransitionLayer
  | IntroLayer
  | OutroLayer
  | OverlayLayer
  | MusicLayer
  | AudioLayer;

export interface EditPlanMeta {
  prompt: string;
  model: string;
  createdAt: string;
  assumptions?: Record<string, unknown>;
}

export interface EditPlan {
  schemaVersion: '1.0';
  projectId: string; // publicId: "prj_..."
  baseAssetId: string; // publicId: "ast_..."
  version: number;
  parentVersion?: number | null;
  global: GlobalVideoSettings;
  layers: EditLayer[];
  meta: EditPlanMeta;
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
}
