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

export interface BrollPresetItem {
  id: string;
  name: string;
  category: 'tech' | 'city' | 'nature' | 'workspace' | 'cyberpunk' | 'abstract' | 'finance';
  description: string;
  previewUrl: string;
  dominantColor: string;
}

export const STOCK_BROLL_PRESETS: BrollPresetItem[] = [
  {
    id: 'broll_tech',
    name: 'Technology & Code',
    category: 'tech',
    description: 'Modern developer workstation with code editor & dual monitors',
    previewUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#0f172a',
  },
  {
    id: 'broll_city',
    name: 'Cinematic Skyline',
    category: 'city',
    description: 'High-rise skyscraper city at blue hour with street light trails',
    previewUrl: 'https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#1e1b4b',
  },
  {
    id: 'broll_nature',
    name: 'Mountain Drone Vista',
    category: 'nature',
    description: 'Dramatic aerial flight over misty alpine pine ridges',
    previewUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#064e3b',
  },
  {
    id: 'broll_workspace',
    name: 'Creative Studio',
    category: 'workspace',
    description: 'Minimalist creative workspace with laptop, tablet, and morning sunlight',
    previewUrl: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#334155',
  },
  {
    id: 'broll_cyberpunk',
    name: 'Neon Cyber Grid',
    category: 'cyberpunk',
    description: 'Holographic neon digital matrix with magenta and cyan reflections',
    previewUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#581c87',
  },
  {
    id: 'broll_abstract',
    name: 'Fluid Waves',
    category: 'abstract',
    description: 'Dynamic flowing gradient mesh with cinematic slow motion',
    previewUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#831843',
  },
  {
    id: 'broll_finance',
    name: 'Market Analytics',
    category: 'finance',
    description: 'Financial candlestick charts and global market telemetry',
    previewUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1280&q=80',
    dominantColor: '#065f46',
  },
];

export interface MusicPresetItem {
  id: string;
  name: string;
  genre: 'ambient' | 'upbeat' | 'lofi' | 'cinematic' | 'acoustic';
  bpm: number;
  durationSec: number;
  description: string;
  previewUrl: string;
}

export const STOCK_MUSIC_PRESETS: MusicPresetItem[] = [
  {
    id: 'mus_calm_ambient',
    name: 'Calm Atmospheric Ambient',
    genre: 'ambient',
    bpm: 96,
    durationSec: 180,
    description: 'Smooth ethereal pads, light piano accents, and deep sub-bass warmth',
    previewUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=ambient-piano-amp-strings-10711.mp3',
  },
  {
    id: 'mus_upbeat_energy',
    name: 'Upbeat Tech Energy',
    genre: 'upbeat',
    bpm: 124,
    durationSec: 154,
    description: 'Energetic modern beat with driving drums and catchy melodic synth hooks',
    previewUrl: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=electronic-future-beats-117997.mp3',
  },
  {
    id: 'mus_lofi_chill',
    name: 'Lo-Fi Chill Study Beat',
    genre: 'lofi',
    bpm: 82,
    durationSec: 210,
    description: 'Vinyl crackle, dusty jazz Rhodes keys, and relaxing boom-bap groove',
    previewUrl: 'https://cdn.pixabay.com/download/audio/2022/05/16/audio_c1c1f73b64.mp3?filename=lofi-study-112191.mp3',
  },
  {
    id: 'mus_cinematic_pulse',
    name: 'Cinematic Horizon',
    genre: 'cinematic',
    bpm: 105,
    durationSec: 195,
    description: 'Dramatic crescendo with sweeping strings, brass swells, and taiko percussion',
    previewUrl: 'https://cdn.pixabay.com/download/audio/2021/11/25/audio_946b5a935e.mp3?filename=cinematic-dramatic-11124.mp3',
  },
  {
    id: 'mus_acoustic_warmth',
    name: 'Acoustic Morning Sunshine',
    genre: 'acoustic',
    bpm: 112,
    durationSec: 160,
    description: 'Warm fingerpicked acoustic guitars, light shaker, and uplifting melody',
    previewUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=acoustic-guitar-loop-10904.mp3',
  },
];
