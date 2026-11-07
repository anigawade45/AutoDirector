import { ColorParams, ColorPreset } from '../types/editPlan.js';
import { COLOR_PRESETS } from '../constants/presets.js';

export interface ResolvedColorGrading {
  preset?: ColorPreset;
  brightness: number;  // -0.3 to 0.3
  contrast: number;    // 0.7 to 1.5
  saturation: number;  // 0.0 to 2.0
  lut?: string;        // catalog id
  vignette: number;    // 0.0 to 1.0
  grain: number;       // 0.0 to 0.5
}

export interface ColorCssPreview {
  cssFilter: string;
  vignetteGradient: string;
  vignetteOpacity: number;
}

/**
 * Resolves color presets and applies explicit numeric controls with clamping
 * to valid ranges according to Technical Specification §3.3.
 */
export function resolveColorParams(params: ColorParams = {}): ResolvedColorGrading {
  const presetKey = params.preset;
  const presetDefaults = presetKey && COLOR_PRESETS[presetKey] ? COLOR_PRESETS[presetKey] : null;

  // Baseline defaults
  let contrast: number = presetDefaults?.contrast ?? 1.0;
  let saturation: number = presetDefaults?.saturation ?? 1.0;
  let brightness: number = presetDefaults?.brightness ?? 0.0;
  let lut: string | undefined = params.lut ?? (presetDefaults as any)?.lut;
  let vignette: number = presetDefaults?.vignette ?? 0.0;
  let grain: number = presetDefaults?.grain ?? 0.0;

  // Apply explicit numeric overrides if defined
  if (typeof params.contrast === 'number' && !isNaN(params.contrast)) {
    contrast = params.contrast;
  }
  if (typeof params.saturation === 'number' && !isNaN(params.saturation)) {
    saturation = params.saturation;
  }
  if (typeof params.brightness === 'number' && !isNaN(params.brightness)) {
    brightness = params.brightness;
  }
  if (typeof params.vignette === 'number' && !isNaN(params.vignette)) {
    vignette = params.vignette;
  }
  if (typeof params.grain === 'number' && !isNaN(params.grain)) {
    grain = params.grain;
  }

  // Strict parameter clamping per Specification §3.3
  contrast = Math.max(0.7, Math.min(1.5, contrast));
  saturation = Math.max(0.0, Math.min(2.0, saturation));
  brightness = Math.max(-0.3, Math.min(0.3, brightness));
  vignette = Math.max(0.0, Math.min(1.0, vignette));
  grain = Math.max(0.0, Math.min(0.5, grain));

  return {
    preset: presetKey,
    contrast: Number(contrast.toFixed(3)),
    saturation: Number(saturation.toFixed(3)),
    brightness: Number(brightness.toFixed(3)),
    lut,
    vignette: Number(vignette.toFixed(3)),
    grain: Number(grain.toFixed(3)),
  };
}

/**
 * Builds deterministic FFmpeg video filter chain string for color grading
 * (Spec §4.4: eq=contrast:brightness:saturation, lut3d, vignette, noise).
 */
export function buildFfmpegColorFilter(
  params: ColorParams = {},
  options: { lutPath?: string } = {}
): string {
  const resolved = resolveColorParams(params);
  const filters: string[] = [];

  // Primary color adjustments (eq filter)
  const c = Number(resolved.contrast.toFixed(3));
  const s = Number(resolved.saturation.toFixed(3));
  const b = Number(resolved.brightness.toFixed(3));
  filters.push(`eq=contrast=${c}:saturation=${s}:brightness=${b}`);

  // 3D LUT filter if file path provided or lut catalog key exists
  if (options.lutPath) {
    const escapedLut = options.lutPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    filters.push(`lut3d='${escapedLut}'`);
  }

  // Vignette filter
  if (resolved.vignette > 0) {
    const angle = (resolved.vignette * 0.25).toFixed(3);
    filters.push(`vignette=PI*${angle}`);
  }

  // Film grain (noise filter)
  if (resolved.grain > 0) {
    const noiseAmount = Math.max(1, Math.round(resolved.grain * 40));
    filters.push(`noise=alls=${noiseAmount}:allf=t`);
  }

  return filters.join(',');
}

/**
 * Computes CSS filter string and radial vignette gradient for real-time
 * 60fps canvas overlay preview in React client (Spec §5.5).
 */
export function computeColorCssFilter(params: ColorParams = {}): ColorCssPreview {
  const resolved = resolveColorParams(params);
  const filterParts: string[] = [];

  // Contrast: 1.0 = 100%
  filterParts.push(`contrast(${Math.round(resolved.contrast * 100)}%)`);

  // Saturation: 1.0 = 100%, 0 = 0%
  if (resolved.saturation === 0 || resolved.preset === 'bw') {
    filterParts.push('grayscale(100%)');
  } else {
    filterParts.push(`saturate(${Math.round(resolved.saturation * 100)}%)`);
  }

  // Brightness: 0.0 offset -> (1 + brightness) * 100%
  const cssBrightness = Math.round((1 + resolved.brightness) * 100);
  filterParts.push(`brightness(${cssBrightness}%)`);

  // CSS vignette overlay gradient
  const vignetteGradient = `radial-gradient(circle, transparent 50%, rgba(0,0,0,${resolved.vignette.toFixed(
    2
  )}) 100%)`;

  return {
    cssFilter: filterParts.join(' '),
    vignetteGradient,
    vignetteOpacity: resolved.vignette,
  };
}

/**
 * Checks whether color grading differs visibly from identity/neutral video.
 * Acceptance criterion (Spec §9 & Phase 5): "color preset visibly changes frames".
 */
export function hasVisibleColorChange(params: ColorParams = {}): boolean {
  const resolved = resolveColorParams(params);
  return (
    Math.abs(resolved.contrast - 1.0) > 0.02 ||
    Math.abs(resolved.saturation - 1.0) > 0.02 ||
    Math.abs(resolved.brightness - 0.0) > 0.01 ||
    resolved.vignette > 0.05 ||
    resolved.grain > 0.02 ||
    Boolean(resolved.lut)
  );
}
