import { EditPlan, EditLayer } from '../types/editPlan.js';

export interface TimelineOperationItem {
  id: string;
  layer: string;
  trackKind: 'video' | 'subtitle' | 'text' | 'music' | 'fx';
  trackName: string;
  title: string;
  summary: string;
  startSec?: number;
  endSec?: number;
  durSec?: number;
  parameters: Record<string, any>;
}

export interface PlanTimelineOperationsSummary {
  version: number;
  prompt: string;
  model: string;
  totalOperations: number;
  tracksInvolved: string[];
  operations: TimelineOperationItem[];
}

/**
 * Translates an EditPlan into a structured sequence of timeline operations.
 * Demonstrates that the AI Planner emits tangible, editable multi-track timeline
 * operations rather than a black-box render.
 */
export function extractTimelineOperations(plan: EditPlan): PlanTimelineOperationsSummary {
  if (!plan) {
    return {
      version: 1,
      prompt: '',
      model: 'ai-planner',
      totalOperations: 0,
      tracksInvolved: [],
      operations: [],
    };
  }

  const operations: TimelineOperationItem[] = [];
  const tracksSet = new Set<string>();

  for (const layer of plan.layers || []) {
    if (!layer || !layer.enabled) continue;

    const op = mapLayerToTimelineOperation(layer);
    if (op) {
      operations.push(op);
      tracksSet.add(op.trackName);
    }
  }

  return {
    version: plan.version,
    prompt: plan.meta?.prompt || 'User Edit',
    model: plan.meta?.model || 'ai-planner',
    totalOperations: operations.length,
    tracksInvolved: Array.from(tracksSet),
    operations,
  };
}

function mapLayerToTimelineOperation(layer: EditLayer): TimelineOperationItem | null {
  const startSec = layer.range?.start;
  const endSec = layer.range?.end;
  const durSec =
    startSec !== undefined && endSec !== undefined ? Number((endSec - startSec).toFixed(3)) : undefined;

  switch (layer.layer) {
    case 'cut': {
      const reason = layer.params?.reason || 'user';
      return {
        id: layer.id,
        layer: 'cut',
        trackKind: 'video',
        trackName: 'V1: Video / Edits',
        title: 'Cut Dead Air / Silence',
        summary: `Splits & removes interval ${startSec?.toFixed(2)}s - ${endSec?.toFixed(2)}s (${durSec?.toFixed(2)}s, reason: ${reason})`,
        startSec,
        endSec,
        durSec,
        parameters: layer.params as any,
      };
    }

    case 'speed': {
      const factor = (layer.params as any)?.factor ?? 1.0;
      const keepPitch = (layer.params as any)?.keepPitch !== false;
      return {
        id: layer.id,
        layer: 'speed',
        trackKind: 'video',
        trackName: 'V1: Video / Edits',
        title: 'Speed Ramp',
        summary: `Ramps playback to ${factor}x at ${startSec?.toFixed(2)}s - ${endSec?.toFixed(2)}s (${keepPitch ? 'pitch preserved' : 'natural'})`,
        startSec,
        endSec,
        durSec,
        parameters: layer.params as any,
      };
    }

    case 'color': {
      const p = (layer.params as any) || {};
      const preset = p.preset || 'cinematic';
      const contrast = p.contrast ?? 1.0;
      const saturation = p.saturation ?? 1.0;
      const brightness = p.brightness ?? 0;
      return {
        id: layer.id,
        layer: 'color',
        trackKind: 'fx',
        trackName: 'FX: Color & Transitions',
        title: 'Color Grading & Look',
        summary: `${preset.toUpperCase()} LUT (contrast: ${contrast.toFixed(2)}x, sat: ${saturation.toFixed(2)}x${brightness !== 0 ? `, brightness: ${brightness > 0 ? '+' : ''}${brightness.toFixed(2)}` : ''})`,
        parameters: p,
      };
    }

    case 'subtitle': {
      const p = (layer.params as any) || {};
      const style = p.style || 'word_pop';
      const font = p.font || 'Montserrat';
      const size = p.size || 56;
      const position = p.position || 'bottom';
      return {
        id: layer.id,
        layer: 'subtitle',
        trackKind: 'subtitle',
        trackName: 'T1: Subtitles',
        title: 'Captions & Typography',
        summary: `${style} animation (${font}, ${size}px, ${position})`,
        parameters: p,
      };
    }

    case 'music': {
      const p = (layer.params as any) || {};
      const trackId = p.trackId || p.mood || 'ambient_soundtrack';
      const volume = Math.round((p.volume ?? 0.35) * 100);
      const duck = p.duckUnderSpeech !== false;
      return {
        id: layer.id,
        layer: 'music',
        trackKind: 'music',
        trackName: 'A1: Audio Mix',
        title: 'Soundtrack & Ducking',
        summary: `${trackId} at ${volume}% volume${duck ? ' (speech auto-ducking)' : ''}`,
        parameters: p,
      };
    }

    case 'text': {
      const p = (layer.params as any) || {};
      const content = p.content || 'Headline';
      const anim = p.animation || 'fade';
      return {
        id: layer.id,
        layer: 'text',
        trackKind: 'text',
        trackName: 'T2: Graphic Text',
        title: 'Title Overlay',
        summary: `"${content}" (${anim}) at ${startSec?.toFixed(2)}s - ${endSec?.toFixed(2)}s`,
        startSec,
        endSec,
        durSec,
        parameters: p,
      };
    }

    case 'transition': {
      const p = (layer.params as any) || {};
      const type = p.type || 'dissolve';
      const duration = p.duration ?? 0.5;
      const at = p.at ?? startSec ?? 0;
      return {
        id: layer.id,
        layer: 'transition',
        trackKind: 'video',
        trackName: 'V1: Video / Edits',
        title: 'Scene Transition',
        summary: `${type} dissolve at ${at.toFixed(2)}s (${duration.toFixed(2)}s duration)`,
        startSec: at,
        endSec: at + duration,
        durSec: duration,
        parameters: p,
      };
    }

    case 'intro': {
      const p = (layer.params as any) || {};
      const template = p.template || 'cinematic';
      const duration = p.duration ?? 5;
      return {
        id: layer.id,
        layer: 'intro',
        trackKind: 'video',
        trackName: 'V1: Video / Edits',
        title: 'Intro Title Sequence',
        summary: `${template} title card (0.0s - ${duration.toFixed(1)}s)`,
        startSec: 0,
        endSec: duration,
        durSec: duration,
        parameters: p,
      };
    }

    case 'outro': {
      const p = (layer.params as any) || {};
      const template = p.template || 'cinematic';
      const duration = p.duration ?? 5;
      return {
        id: layer.id,
        layer: 'outro',
        trackKind: 'video',
        trackName: 'V1: Video / Edits',
        title: 'Outro End Card',
        summary: `${template} end card (${duration.toFixed(1)}s duration)`,
        parameters: p,
      };
    }

    case 'overlay': {
      const p = (layer.params as any) || {};
      const asset = p.asset || 'overlay';
      const opacity = Math.round((p.opacity ?? 1.0) * 100);
      return {
        id: layer.id,
        layer: 'overlay',
        trackKind: 'fx',
        trackName: 'FX: Overlays',
        title: 'Visual Asset Overlay',
        summary: `${asset} graphic (${opacity}% opacity) at ${startSec?.toFixed(2)}s - ${endSec?.toFixed(2)}s`,
        startSec,
        endSec,
        durSec,
        parameters: p,
      };
    }

    default:
      return null;
  }
}
