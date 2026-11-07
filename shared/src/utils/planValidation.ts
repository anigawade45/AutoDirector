import {
  EditPlan,
  EditLayer,
  CutLayer,
  SpeedLayer,
  ColorLayer,
  SubtitleLayer,
  TransitionLayer,
  IntroLayer,
  OutroLayer,
  AudioLayer,
  MusicLayer,
} from '../types/editPlan.js';
import { buildKeepSegments, snapToFrame, secToFrameMs } from './timeMapping.js';

export interface PlanValidationContext {
  assetDurationSec: number;
  fps?: number;
  maxDurationSec?: number;
}

export interface ValidationIssue {
  layerId?: string;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: ValidationIssue[];
  computedDurationSec?: number;
}

/**
 * Validates an EditPlan against source ranges, frame-grid alignment, duration budgets,
 * max layer count, and allowed parameter ranges (Specification §3.7 & Phase 5 Task 5).
 */
export function validateEditPlan(
  plan: EditPlan,
  context: PlanValidationContext
): PlanValidationResult {
  const issues: ValidationIssue[] = [];
  const assetDur = Math.max(0.1, context.assetDurationSec);
  const fps = plan.global?.fps || context.fps || 30;
  const frameToleranceSec = 1 / fps + 0.001;

  // 1. Envelope & Basic Invariants
  if (plan.schemaVersion !== '1.0') {
    issues.push({
      field: 'schemaVersion',
      message: `Invalid schemaVersion "${plan.schemaVersion}". Expected "1.0".`,
      severity: 'error',
    });
  }

  if (!plan.projectId || typeof plan.projectId !== 'string') {
    issues.push({
      field: 'projectId',
      message: 'projectId is required and must be a non-empty string.',
      severity: 'error',
    });
  }

  if (!plan.baseAssetId || typeof plan.baseAssetId !== 'string') {
    issues.push({
      field: 'baseAssetId',
      message: 'baseAssetId is required and must be a non-empty string.',
      severity: 'error',
    });
  }

  if (typeof plan.version !== 'number' || plan.version < 0) {
    issues.push({
      field: 'version',
      message: 'version must be a non-negative integer.',
      severity: 'error',
    });
  }

  // 2. Layer Budget & Singleton Constraints (Spec §3.7 #5)
  if (!Array.isArray(plan.layers)) {
    issues.push({
      field: 'layers',
      message: 'layers must be an array.',
      severity: 'error',
    });
    return finalizeResult(issues);
  }

  if (plan.layers.length > 200) {
    issues.push({
      field: 'layers',
      message: `Layer count ${plan.layers.length} exceeds maximum allowed budget of 200.`,
      severity: 'error',
    });
  }

  const layerCounts: Record<string, number> = {};
  for (const layer of plan.layers) {
    if (!layer || typeof layer !== 'object') continue;
    layerCounts[layer.layer] = (layerCounts[layer.layer] || 0) + 1;
  }

  const singletonLayers = ['intro', 'outro', 'color', 'subtitle', 'audio', 'music'];
  for (const single of singletonLayers) {
    if ((layerCounts[single] || 0) > 1) {
      issues.push({
        field: 'layers',
        message: `Plan cannot contain more than 1 ${single} layer (found ${layerCounts[single]}).`,
        severity: 'error',
      });
    }
  }

  // 3. Per-Layer Parameter & Range Validation
  for (const layer of plan.layers) {
    if (!layer || typeof layer !== 'object') {
      issues.push({
        message: 'Invalid layer element in layers array.',
        severity: 'error',
      });
      continue;
    }

    const lid = layer.id || 'unknown';

    // Source Range Validation (for source timebase layers)
    if (layer.timebase === 'source' && 'range' in layer && layer.range) {
      const { start, end } = layer.range;
      if (typeof start !== 'number' || start < 0) {
        issues.push({
          layerId: lid,
          field: 'range.start',
          message: `Layer ${lid} range.start must be >= 0 (got ${start}).`,
          severity: 'error',
        });
      }

      if (typeof end !== 'number' || end <= start) {
        issues.push({
          layerId: lid,
          field: 'range.end',
          message: `Layer ${lid} range.end must be greater than range.start (got start=${start}, end=${end}).`,
          severity: 'error',
        });
      }

      if (typeof end === 'number' && end > assetDur + 0.05) {
        issues.push({
          layerId: lid,
          field: 'range.end',
          message: `Layer ${lid} range.end (${end}s) exceeds asset duration (${assetDur}s).`,
          severity: 'error',
        });
      }

      // Frame-grid alignment check
      if (typeof start === 'number') {
        const frameStart = Number(snapToFrame(start, fps).toFixed(3));
        if (Math.abs(start - frameStart) > 0.005) {
          issues.push({
            layerId: lid,
            field: 'range.start',
            message: `Layer ${lid} range.start (${start}s) is not frame-aligned at ${fps} fps (nearest: ${frameStart}s).`,
            severity: 'warning',
          });
        }
      }

      if (typeof end === 'number') {
        const frameEnd = Number(snapToFrame(end, fps).toFixed(3));
        if (Math.abs(end - frameEnd) > 0.005) {
          issues.push({
            layerId: lid,
            field: 'range.end',
            message: `Layer ${lid} range.end (${end}s) is not frame-aligned at ${fps} fps (nearest: ${frameEnd}s).`,
            severity: 'warning',
          });
        }
      }
    }

    // Specific Layer Validations
    switch (layer.layer) {
      case 'cut': {
        const cut = layer as CutLayer;
        const validReasons = ['silence', 'filler', 'user', 'lowlight'];
        if (!validReasons.includes(cut.params?.reason)) {
          issues.push({
            layerId: lid,
            field: 'params.reason',
            message: `Cut reason must be one of: ${validReasons.join(', ')}.`,
            severity: 'error',
          });
        }
        if (
          typeof cut.params?.padding === 'number' &&
          (cut.params.padding < 0 || cut.params.padding > 0.3)
        ) {
          issues.push({
            layerId: lid,
            field: 'params.padding',
            message: `Cut padding must be between 0 and 0.3s (got ${cut.params.padding}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'speed': {
        const spd = layer as SpeedLayer;
        const factor = spd.params?.factor;
        if (typeof factor !== 'number' || factor < 0.25 || factor > 4.0) {
          issues.push({
            layerId: lid,
            field: 'params.factor',
            message: `Speed factor must be between 0.25 and 4.0 (got ${factor}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'color': {
        const col = layer as ColorLayer;
        const p = col.params || {};
        const validPresets = ['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded'];
        if (p.preset && !validPresets.includes(p.preset)) {
          issues.push({
            layerId: lid,
            field: 'params.preset',
            message: `Color preset must be one of: ${validPresets.join(', ')}.`,
            severity: 'error',
          });
        }
        if (typeof p.contrast === 'number' && (p.contrast < 0.7 || p.contrast > 1.5)) {
          issues.push({
            layerId: lid,
            field: 'params.contrast',
            message: `Contrast must be between 0.7 and 1.5 (got ${p.contrast}).`,
            severity: 'error',
          });
        }
        if (typeof p.brightness === 'number' && (p.brightness < -0.3 || p.brightness > 0.3)) {
          issues.push({
            layerId: lid,
            field: 'params.brightness',
            message: `Brightness must be between -0.3 and 0.3 (got ${p.brightness}).`,
            severity: 'error',
          });
        }
        if (typeof p.saturation === 'number' && (p.saturation < 0 || p.saturation > 2.0)) {
          issues.push({
            layerId: lid,
            field: 'params.saturation',
            message: `Saturation must be between 0 and 2.0 (got ${p.saturation}).`,
            severity: 'error',
          });
        }
        if (typeof p.vignette === 'number' && (p.vignette < 0 || p.vignette > 1.0)) {
          issues.push({
            layerId: lid,
            field: 'params.vignette',
            message: `Vignette must be between 0 and 1.0 (got ${p.vignette}).`,
            severity: 'error',
          });
        }
        if (typeof p.grain === 'number' && (p.grain < 0 || p.grain > 0.5)) {
          issues.push({
            layerId: lid,
            field: 'params.grain',
            message: `Grain must be between 0 and 0.5 (got ${p.grain}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'subtitle': {
        const sub = layer as SubtitleLayer;
        const p = sub.params || {};
        const validStyles = ['classic', 'word_pop', 'karaoke', 'minimal'];
        if (p.style && !validStyles.includes(p.style)) {
          issues.push({
            layerId: lid,
            field: 'params.style',
            message: `Subtitle style must be one of: ${validStyles.join(', ')}.`,
            severity: 'error',
          });
        }
        const validPositions = ['bottom', 'center', 'top'];
        if (p.position && !validPositions.includes(p.position)) {
          issues.push({
            layerId: lid,
            field: 'params.position',
            message: `Subtitle position must be one of: ${validPositions.join(', ')}.`,
            severity: 'error',
          });
        }
        if (typeof p.size === 'number' && (p.size < 24 || p.size > 96)) {
          issues.push({
            layerId: lid,
            field: 'params.size',
            message: `Subtitle font size must be between 24 and 96 (got ${p.size}).`,
            severity: 'error',
          });
        }
        if (
          typeof p.maxWordsPerLine === 'number' &&
          (p.maxWordsPerLine < 2 || p.maxWordsPerLine > 8)
        ) {
          issues.push({
            layerId: lid,
            field: 'params.maxWordsPerLine',
            message: `maxWordsPerLine must be between 2 and 8 (got ${p.maxWordsPerLine}).`,
            severity: 'error',
          });
        }
        const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
        if (p.primaryColor && !hexRegex.test(p.primaryColor)) {
          issues.push({
            layerId: lid,
            field: 'params.primaryColor',
            message: `primaryColor must be a valid hex color (got ${p.primaryColor}).`,
            severity: 'error',
          });
        }
        if (p.highlightColor && !hexRegex.test(p.highlightColor)) {
          issues.push({
            layerId: lid,
            field: 'params.highlightColor',
            message: `highlightColor must be a valid hex color (got ${p.highlightColor}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'transition': {
        const tr = layer as TransitionLayer;
        const p = tr.params || {};
        const validTypes = ['fade', 'dissolve', 'wipeleft', 'slideup', 'zoom'];
        if (!validTypes.includes(p.type)) {
          issues.push({
            layerId: lid,
            field: 'params.type',
            message: `Transition type must be one of: ${validTypes.join(', ')}.`,
            severity: 'error',
          });
        }
        if (typeof p.duration !== 'number' || p.duration < 0.2 || p.duration > 1.5) {
          issues.push({
            layerId: lid,
            field: 'params.duration',
            message: `Transition duration must be between 0.2 and 1.5s (got ${p.duration}).`,
            severity: 'error',
          });
        }
        if (typeof p.at !== 'number' || p.at < 0 || p.at > assetDur + 0.05) {
          issues.push({
            layerId: lid,
            field: 'params.at',
            message: `Transition "at" must be between 0 and asset duration ${assetDur}s (got ${p.at}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'intro':
      case 'outro': {
        const tpl = layer as IntroLayer | OutroLayer;
        const p = tpl.params || {};
        if (typeof p.duration !== 'number' || p.duration < 2 || p.duration > 10) {
          issues.push({
            layerId: lid,
            field: 'params.duration',
            message: `${tpl.layer} duration must be between 2 and 10s (got ${p.duration}).`,
            severity: 'error',
          });
        }
        if (p.text && p.text.length > 120) {
          issues.push({
            layerId: lid,
            field: 'params.text',
            message: `${tpl.layer} text cannot exceed 120 characters.`,
            severity: 'error',
          });
        }
        if (p.subtext && p.subtext.length > 120) {
          issues.push({
            layerId: lid,
            field: 'params.subtext',
            message: `${tpl.layer} subtext cannot exceed 120 characters.`,
            severity: 'error',
          });
        }
        break;
      }

      case 'audio': {
        const aud = layer as AudioLayer;
        const p = aud.params || {};
        if (
          typeof p.normalizeLufs === 'number' &&
          (p.normalizeLufs < -23 || p.normalizeLufs > -14)
        ) {
          issues.push({
            layerId: lid,
            field: 'params.normalizeLufs',
            message: `Audio normalizeLufs must be between -23 and -14 LUFS (got ${p.normalizeLufs}).`,
            severity: 'error',
          });
        }
        break;
      }

      case 'music': {
        const mus = layer as MusicLayer;
        const p = mus.params || {};
        if (typeof p.volume === 'number' && (p.volume < 0 || p.volume > 1.0)) {
          issues.push({
            layerId: lid,
            field: 'params.volume',
            message: `Music volume must be between 0 and 1.0 (got ${p.volume}).`,
            severity: 'error',
          });
        }
        break;
      }
    }
  }

  // 4. Output Duration & Invariants Computation
  const cutLayers = plan.layers.filter((l) => l.enabled && l.layer === 'cut') as any[];
  const speedLayers = plan.layers.filter((l) => l.enabled && l.layer === 'speed') as any[];
  const keepSegs = buildKeepSegments(cutLayers, assetDur, speedLayers, fps);

  if (keepSegs.length === 0) {
    issues.push({
      field: 'layers',
      message:
        'Cut layers eliminate 100% of the video duration. At least one keep-segment must remain.',
      severity: 'error',
    });
  }

  const introLayer = plan.layers.find((l) => l.enabled && l.layer === 'intro') as any;
  const outroLayer = plan.layers.find((l) => l.enabled && l.layer === 'outro') as any;
  const transitionLayers = plan.layers.filter(
    (l) => l.enabled && l.layer === 'transition'
  ) as any[];

  const introDur = introLayer ? introLayer.params?.duration || 5 : 0;
  const outroDur = outroLayer ? outroLayer.params?.duration || 5 : 0;

  let totalSegDur = keepSegs.reduce((acc, s) => acc + (s.srcEnd - s.srcStart) / s.speed, 0);
  let totalOverlap = 0;

  for (let i = 0; i < keepSegs.length - 1; i++) {
    const seg = keepSegs[i];
    const trans = transitionLayers.find((t) => Math.abs(t.params?.at - seg.srcEnd) < 0.2);
    if (trans) {
      const dur = trans.params?.duration || 0.5;
      totalOverlap += dur;
    }
  }

  const computedDurationSec = Math.max(0, introDur + totalSegDur - totalOverlap + outroDur);

  if (computedDurationSec <= 0) {
    issues.push({
      field: 'duration',
      message: `Total computed duration is non-positive (${computedDurationSec}s).`,
      severity: 'error',
    });
  }

  if (context.maxDurationSec && computedDurationSec > context.maxDurationSec) {
    issues.push({
      field: 'duration',
      message: `Computed duration (${computedDurationSec}s) exceeds max allowed duration (${context.maxDurationSec}s).`,
      severity: 'error',
    });
  }

  const result = finalizeResult(issues);
  result.computedDurationSec = Number(computedDurationSec.toFixed(3));
  return result;
}

/**
 * Snaps all source ranges, transition positions, and durations in an EditPlan
 * to the exact frame grid (1000/fps ms) per Blueprint §5.4 & Phase 5 Task 5.
 */
export function snapPlanToFrameGrid(
  plan: EditPlan,
  fps: number = 30,
  assetDurationSec?: number
): EditPlan {
  const snapped = JSON.parse(JSON.stringify(plan)) as EditPlan;
  snapped.global = snapped.global || { aspect: '16:9', fps: 30, resolution: '1080p' };
  snapped.global.fps = (fps as any) || 30;

  const maxDur = assetDurationSec ? assetDurationSec : undefined;

  for (const layer of snapped.layers) {
    if (!layer || typeof layer !== 'object') continue;

    // Snap source range
    if (layer.timebase === 'source' && 'range' in layer && layer.range) {
      let start = Number(snapToFrame(layer.range.start, fps).toFixed(3));
      let end = Number(snapToFrame(layer.range.end, fps).toFixed(3));

      if (maxDur) {
        end = Math.min(Number(snapToFrame(maxDur, fps).toFixed(3)), end);
      }
      if (end <= start) {
        end = Number((start + 1 / fps).toFixed(3));
      }

      layer.range.start = start;
      layer.range.end = end;
    }

    // Snap transitions
    if (layer.layer === 'transition') {
      const tr = layer as TransitionLayer;
      const at = Number(snapToFrame(tr.params.at, fps).toFixed(3));
      const dur = Number(snapToFrame(tr.params.duration, fps).toFixed(3));
      tr.params.at = at;
      tr.params.duration = dur;
      if (tr.range) {
        tr.range.start = at;
        tr.range.end = Number((at + dur).toFixed(3));
      }
    }
  }

  return snapped;
}

function finalizeResult(issues: ValidationIssue[]): PlanValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
