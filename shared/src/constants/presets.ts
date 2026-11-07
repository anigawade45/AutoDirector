export const RESOLUTION_DIMENSIONS = {
  '16:9': {
    '480p': { width: 854, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '4k': { width: 3840, height: 2160 },
  },
  '9:16': {
    '480p': { width: 480, height: 854 },
    '720p': { width: 720, height: 1280 },
    '1080p': { width: 1080, height: 1920 },
    '4k': { width: 2160, height: 3840 },
  },
  '1:1': {
    '480p': { width: 480, height: 480 },
    '720p': { width: 720, height: 720 },
    '1080p': { width: 1080, height: 1080 },
    '4k': { width: 2160, height: 2160 },
  },
  '4:5': {
    '480p': { width: 480, height: 600 },
    '720p': { width: 720, height: 900 },
    '1080p': { width: 1080, height: 1350 },
    '4k': { width: 2160, height: 2700 },
  },
} as const;

export const COLOR_PRESETS = {
  cinematic: {
    contrast: 1.15,
    saturation: 0.9,
    brightness: 0.0,
    lut: 'teal_orange',
    vignette: 0.3,
    grain: 0.1,
  },
  warm: {
    contrast: 1.05,
    saturation: 1.15,
    brightness: 0.05,
    lut: 'golden_hour',
    vignette: 0.1,
    grain: 0.0,
  },
  cool: {
    contrast: 1.1,
    saturation: 0.85,
    brightness: -0.02,
    lut: 'arctic_blue',
    vignette: 0.15,
    grain: 0.0,
  },
  bw: {
    contrast: 1.3,
    saturation: 0.0,
    brightness: 0.02,
    vignette: 0.25,
    grain: 0.2,
  },
  vivid: {
    contrast: 1.2,
    saturation: 1.4,
    brightness: 0.05,
    vignette: 0.0,
    grain: 0.0,
  },
  faded: {
    contrast: 0.85,
    saturation: 0.75,
    brightness: 0.1,
    vignette: 0.2,
    grain: 0.15,
  },
} as const;

export const AUDIO_DEFAULTS = {
  integratedLufs: -16,
  truePeakDb: -1.5,
  lra: 11,
  speechDuckingDb: -12,
  musicFadeInSec: 1.5,
  musicFadeOutSec: 3.0,
} as const;
