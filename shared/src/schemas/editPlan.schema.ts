import { z } from 'zod';

export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);
export const VideoFPSSchema = z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]);
export const VideoResolutionSchema = z.enum(['480p', '720p', '1080p', '4k']);

export const GlobalVideoSettingsSchema = z.object({
  aspect: AspectRatioSchema.default('16:9'),
  fps: VideoFPSSchema.default(30),
  resolution: VideoResolutionSchema.default('1080p'),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  language: z.string().default('en'),
});

// Layer: Cut
export const CutLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('cut'),
  enabled: z.boolean().default(true),
  timebase: z.literal('source'),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }).refine((r) => r.end > r.start, { message: 'Cut end must be greater than start' }),
  params: z.object({
    reason: z.enum(['silence', 'filler', 'user', 'lowlight']),
    padding: z.number().min(0).max(0.3).default(0.05),
  }),
});

// Layer: Speed
export const SpeedLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('speed'),
  enabled: z.boolean().default(true),
  timebase: z.literal('source'),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }),
  params: z.object({
    factor: z.number().min(0.25).max(4.0),
    keepPitch: z.boolean().default(true),
  }),
});

// Layer: Color
export const ColorLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('color'),
  enabled: z.boolean().default(true),
  timebase: z.literal('global'),
  params: z.object({
    preset: z.enum(['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded']).optional(),
    brightness: z.number().min(-0.3).max(0.3).default(0),
    contrast: z.number().min(0.7).max(1.5).default(1),
    saturation: z.number().min(0).max(2).default(1),
    lut: z.string().optional(),
    vignette: z.number().min(0).max(1).default(0),
    grain: z.number().min(0).max(0.5).default(0),
  }),
});

// Layer: Subtitle
export const SubtitleLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('subtitle'),
  enabled: z.boolean().default(true),
  timebase: z.literal('source'),
  params: z.object({
    style: z.enum(['classic', 'word_pop', 'karaoke', 'minimal']).default('word_pop'),
    font: z.string().default('Montserrat'),
    size: z.number().min(24).max(96).default(56),
    position: z.enum(['bottom', 'center', 'top']).default('bottom'),
    primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default('#FFFFFF'),
    highlightColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default('#FFD84D'),
    maxWordsPerLine: z.number().min(2).max(8).default(4),
  }),
});

// Layer: Text
export const TextLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('text'),
  enabled: z.boolean().default(true),
  timebase: z.enum(['source', 'output']),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }).optional(),
  params: z.object({
    content: z.string().max(120),
    animation: z.enum(['fade', 'slide_up', 'typewriter', 'scale']).default('fade'),
    position: z.object({
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0).max(1).default(0.5),
    }),
    font: z.string().optional(),
    size: z.number().positive().optional(),
    color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default('#FFFFFF'),
  }),
});

// Layer: Transition
export const TransitionLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('transition'),
  enabled: z.boolean().default(true),
  timebase: z.literal('source'),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }),
  params: z.object({
    type: z.enum(['fade', 'dissolve', 'wipeleft', 'slideup', 'zoom']).default('dissolve'),
    duration: z.number().min(0.2).max(1.5).default(0.5),
    at: z.number().min(0),
  }),
});

// Layer: Intro
export const IntroLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('intro'),
  enabled: z.boolean().default(true),
  timebase: z.literal('output'),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }),
  params: z.object({
    template: z.string(),
    duration: z.number().min(2).max(10).default(5),
    text: z.string().max(120).optional(),
    subtext: z.string().max(120).optional(),
    theme: z.string().optional(),
  }),
});

// Layer: Outro
export const OutroLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('outro'),
  enabled: z.boolean().default(true),
  timebase: z.literal('output'),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }),
  params: z.object({
    template: z.string(),
    duration: z.number().min(2).max(10).default(5),
    text: z.string().max(120).optional(),
    subtext: z.string().max(120).optional(),
    theme: z.string().optional(),
  }),
});

// Layer: Overlay
export const OverlayLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('overlay'),
  enabled: z.boolean().default(true),
  timebase: z.enum(['source', 'output']),
  range: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
  }).optional(),
  params: z.object({
    asset: z.string(),
    position: z.object({
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0).max(1).default(0.5),
    }).optional(),
    scale: z.number().min(0.1).max(5).default(1),
    opacity: z.number().min(0).max(1).default(1),
  }),
});

// Layer: Music
export const MusicLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('music'),
  enabled: z.boolean().default(true),
  timebase: z.literal('output'),
  params: z.object({
    trackId: z.string().optional(),
    mood: z.string().optional(),
    volume: z.number().min(0).max(1).default(0.35),
    duckUnderSpeech: z.boolean().default(true),
    fadeIn: z.number().min(0).max(10).default(1.5),
    fadeOut: z.number().min(0).max(10).default(3.0),
    beatSync: z.boolean().default(false),
  }),
});

// Layer: Audio
export const AudioLayerSchema = z.object({
  id: z.string(),
  layer: z.literal('audio'),
  enabled: z.boolean().default(true),
  timebase: z.literal('global'),
  params: z.object({
    normalizeLufs: z.number().min(-23).max(-14).default(-16),
    denoise: z.boolean().default(false),
  }),
});

// Discriminated union of all layers
export const EditLayerSchema = z.discriminatedUnion('layer', [
  CutLayerSchema,
  SpeedLayerSchema,
  ColorLayerSchema,
  SubtitleLayerSchema,
  TextLayerSchema,
  TransitionLayerSchema,
  IntroLayerSchema,
  OutroLayerSchema,
  OverlayLayerSchema,
  MusicLayerSchema,
  AudioLayerSchema,
]);

export const EditPlanMetaSchema = z.object({
  prompt: z.string(),
  model: z.string(),
  createdAt: z.string(),
  assumptions: z.record(z.unknown()).optional(),
});

// Complete EditPlan envelope
export const EditPlanSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectId: z.string(),
  baseAssetId: z.string(),
  version: z.number().int().nonnegative(),
  parentVersion: z.number().int().nonnegative().nullable().optional(),
  global: GlobalVideoSettingsSchema,
  layers: z.array(EditLayerSchema).max(200),
  meta: EditPlanMetaSchema,
});

// RFC 6902 Patch Operation Schema
export const JsonPatchOperationSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  value: z.unknown().optional(),
});

export const JsonPatchArraySchema = z.array(JsonPatchOperationSchema);

