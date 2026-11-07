import { AllowedCatalog } from './plannerProvider.interface.js';
import { snapCutsToBeatGrid, snapToBeat } from '@ai-video/shared';

export interface NormalizerOptions {
  assetDurationSec: number;
  catalog: AllowedCatalog;
  prompt?: string;
  beats?: any;
}

export class PlanNormalizer {
  /**
   * Clamps numeric parameters, resolves catalog references, merges overlapping cuts,
   * enforces time sanity and budget limits per Technical Specification §3.3 & §3.7.
   */
  static normalize(rawPlan: any, options: NormalizerOptions): any {
    if (!rawPlan || typeof rawPlan !== 'object') {
      throw new Error('Plan must be a non-null object');
    }

    const maxDuration = Math.max(0.1, options.assetDurationSec || 60);
    const plan = JSON.parse(JSON.stringify(rawPlan));

    // Envelope basics - preserve raw values so structural schema validation can validate
    plan.schemaVersion = rawPlan.schemaVersion;
    plan.projectId = String(rawPlan.projectId || 'prj_default');
    plan.baseAssetId = String(rawPlan.baseAssetId || 'ast_default');
    plan.version = Number.isInteger(rawPlan.version) && rawPlan.version >= 0 ? rawPlan.version : 1;
    plan.parentVersion =
      Number.isInteger(rawPlan.parentVersion) && rawPlan.parentVersion >= 0
        ? rawPlan.parentVersion
        : null;

    // If layers is not an array, leave as is so schema validation detects structural invalidity
    if (!Array.isArray(rawPlan.layers)) {
      plan.layers = rawPlan.layers;
      return plan;
    }

    // Global settings
    plan.global = plan.global || {};
    const validAspects = ['16:9', '9:16', '1:1', '4:5'];
    plan.global.aspect = validAspects.includes(plan.global.aspect) ? plan.global.aspect : '16:9';
    const validFps = [24, 25, 30, 60];
    plan.global.fps = validFps.includes(plan.global.fps) ? plan.global.fps : 30;
    const validResolutions = ['480p', '720p', '1080p', '4k'];
    plan.global.resolution = validResolutions.includes(plan.global.resolution)
      ? plan.global.resolution
      : '1080p';

    // Meta
    plan.meta = plan.meta || {};
    plan.meta.prompt = String(plan.meta.prompt || options.prompt || 'Edit video');
    plan.meta.model = String(plan.meta.model || 'ai-planner');
    plan.meta.createdAt = plan.meta.createdAt || new Date().toISOString();
    plan.meta.assumptions = plan.meta.assumptions || {};

    // Raw layers
    let layers: any[] = Array.isArray(plan.layers) ? plan.layers : [];

    // Filter out unknown layer types & clamp layers budget to max 200 (Spec §3.7 #5)
    const allowedLayerTypes = [
      'cut',
      'speed',
      'color',
      'subtitle',
      'text',
      'transition',
      'intro',
      'outro',
      'overlay',
      'music',
      'audio',
    ];
    layers = layers.filter((l) => l && typeof l === 'object' && allowedLayerTypes.includes(l.layer));
    if (layers.length > 200) {
      layers = layers.slice(0, 200);
    }

    let layerIdx = 1;
    const normalizedLayers: any[] = [];
    let cutLayers: any[] = [];

    for (const rawLayer of layers) {
      const layerType = rawLayer.layer;
      const id = String(rawLayer.id || `lyr_${layerType}_${layerIdx++}`);
      const enabled = rawLayer.enabled !== false;
      const params = rawLayer.params && typeof rawLayer.params === 'object' ? { ...rawLayer.params } : {};

      switch (layerType) {
        case 'cut': {
          let start = PlanNormalizer.clamp(Number(rawLayer.range?.start) || 0, 0, maxDuration);
          let end = PlanNormalizer.clamp(Number(rawLayer.range?.end) || maxDuration, 0, maxDuration);

          if (end <= start) {
            end = Math.min(maxDuration, start + 0.1);
          }
          if (start >= end) continue;

          const reason = ['silence', 'filler', 'user', 'lowlight'].includes(params.reason)
            ? params.reason
            : 'user';
          const padding = PlanNormalizer.clamp(
            typeof params.padding === 'number' ? params.padding : 0.05,
            0,
            0.3
          );

          cutLayers.push({
            id,
            layer: 'cut',
            enabled,
            timebase: 'source',
            range: {
              start: Number(start.toFixed(3)),
              end: Number(end.toFixed(3)),
            },
            params: { reason, padding },
          });
          break;
        }

        case 'speed': {
          const start = PlanNormalizer.clamp(Number(rawLayer.range?.start) || 0, 0, maxDuration);
          const end = PlanNormalizer.clamp(Number(rawLayer.range?.end) || maxDuration, 0, maxDuration);
          const factor = PlanNormalizer.clamp(
            typeof params.factor === 'number' ? params.factor : 1.0,
            0.25,
            4.0
          );
          const keepPitch = params.keepPitch !== false;

          normalizedLayers.push({
            id,
            layer: 'speed',
            enabled,
            timebase: 'source',
            range: {
              start: Number(start.toFixed(3)),
              end: Number(end.toFixed(3)),
            },
            params: {
              factor: Number(factor.toFixed(2)),
              keepPitch,
            },
          });
          break;
        }

        case 'color': {
          const validPresets = ['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded'];
          const preset = validPresets.includes(params.preset) ? params.preset : undefined;
          const brightness = PlanNormalizer.clamp(
            typeof params.brightness === 'number' ? params.brightness : 0,
            -0.3,
            0.3
          );
          const contrast = PlanNormalizer.clamp(
            typeof params.contrast === 'number' ? params.contrast : 1.0,
            0.7,
            1.5
          );
          const saturation = PlanNormalizer.clamp(
            typeof params.saturation === 'number' ? params.saturation : 1.0,
            0,
            2.0
          );
          const vignette = PlanNormalizer.clamp(
            typeof params.vignette === 'number' ? params.vignette : 0,
            0,
            1.0
          );
          const grain = PlanNormalizer.clamp(
            typeof params.grain === 'number' ? params.grain : 0,
            0,
            0.5
          );

          // Reference resolution: LUT
          let lut: string | undefined = undefined;
          if (params.lut) {
            const lutMatch = options.catalog.luts.find(
              (l) => l.id.toLowerCase() === String(params.lut).toLowerCase()
            );
            lut = lutMatch ? lutMatch.id : options.catalog.luts[0]?.id;
          }

          normalizedLayers.push({
            id,
            layer: 'color',
            enabled,
            timebase: 'global',
            params: {
              preset,
              brightness: Number(brightness.toFixed(3)),
              contrast: Number(contrast.toFixed(3)),
              saturation: Number(saturation.toFixed(3)),
              lut,
              vignette: Number(vignette.toFixed(3)),
              grain: Number(grain.toFixed(3)),
            },
          });
          break;
        }

        case 'subtitle': {
          const validStyles = ['classic', 'word_pop', 'karaoke', 'minimal'];
          const style = validStyles.includes(params.style) ? params.style : 'word_pop';
          const validPositions = ['bottom', 'center', 'top'];
          const position = validPositions.includes(params.position) ? params.position : 'bottom';
          const size = Math.round(
            PlanNormalizer.clamp(typeof params.size === 'number' ? params.size : 56, 24, 96)
          );
          const maxWordsPerLine = Math.round(
            PlanNormalizer.clamp(
              typeof params.maxWordsPerLine === 'number' ? params.maxWordsPerLine : 4,
              2,
              8
            )
          );

          // Reference resolution: font
          let font = 'Montserrat';
          if (params.font && options.catalog.fonts.some((f) => f.toLowerCase() === params.font.toLowerCase())) {
            font = options.catalog.fonts.find((f) => f.toLowerCase() === params.font.toLowerCase())!;
          } else if (options.catalog.fonts.length > 0) {
            font = options.catalog.fonts[0];
          }

          const primaryColor = PlanNormalizer.normalizeHex(params.primaryColor, '#FFFFFF');
          const highlightColor = PlanNormalizer.normalizeHex(params.highlightColor, '#FFD84D');

          normalizedLayers.push({
            id,
            layer: 'subtitle',
            enabled,
            timebase: 'source',
            params: {
              style,
              font,
              size,
              position,
              primaryColor,
              highlightColor,
              maxWordsPerLine,
            },
          });
          break;
        }

        case 'text': {
          const content = String(params.content || 'Text').slice(0, 120);
          const validAnimations = ['fade', 'slide_up', 'typewriter', 'scale'];
          const animation = validAnimations.includes(params.animation) ? params.animation : 'fade';
          const x = PlanNormalizer.clamp(
            typeof params.position?.x === 'number' ? params.position.x : 0.5,
            0,
            1
          );
          const y = PlanNormalizer.clamp(
            typeof params.position?.y === 'number' ? params.position.y : 0.5,
            0,
            1
          );
          const color = PlanNormalizer.normalizeHex(params.color, '#FFFFFF');

          normalizedLayers.push({
            id,
            layer: 'text',
            enabled,
            timebase: rawLayer.timebase === 'source' ? 'source' : 'output',
            range: rawLayer.range
              ? {
                  start: PlanNormalizer.clamp(Number(rawLayer.range.start) || 0, 0, maxDuration),
                  end: PlanNormalizer.clamp(Number(rawLayer.range.end) || maxDuration, 0, maxDuration),
                }
              : undefined,
            params: {
              content,
              animation,
              position: { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) },
              color,
              font: params.font || 'Montserrat',
              size: typeof params.size === 'number' && params.size > 0 ? params.size : 48,
            },
          });
          break;
        }

        case 'transition': {
          const validTypes = ['fade', 'dissolve', 'wipeleft', 'slideup', 'zoom'];
          const type = validTypes.includes(params.type) ? params.type : 'dissolve';
          const duration = PlanNormalizer.clamp(
            typeof params.duration === 'number' ? params.duration : 0.5,
            0.2,
            1.5
          );
          const at = PlanNormalizer.clamp(
            typeof params.at === 'number'
              ? params.at
              : typeof rawLayer.range?.start === 'number'
              ? rawLayer.range.start
              : 0,
            0,
            maxDuration
          );

          normalizedLayers.push({
            id,
            layer: 'transition',
            enabled,
            timebase: 'source',
            range: {
              start: Number(at.toFixed(3)),
              end: Number(Math.min(maxDuration, at + duration).toFixed(3)),
            },
            params: {
              type,
              duration: Number(duration.toFixed(2)),
              at: Number(at.toFixed(3)),
            },
          });
          break;
        }

        case 'intro':
        case 'outro': {
          const duration = PlanNormalizer.clamp(
            typeof params.duration === 'number' ? params.duration : 5,
            2,
            10
          );

          // Reference resolution: template
          let template = 'cinematic';
          if (
            params.template &&
            options.catalog.templates.some((t) => t.id.toLowerCase() === params.template.toLowerCase())
          ) {
            template = options.catalog.templates.find(
              (t) => t.id.toLowerCase() === params.template.toLowerCase()
            )!.id;
          } else if (options.catalog.templates.length > 0) {
            template = options.catalog.templates[0].id;
          }

          const text = params.text ? String(params.text).slice(0, 120) : undefined;
          const subtext = params.subtext ? String(params.subtext).slice(0, 120) : undefined;

          normalizedLayers.push({
            id,
            layer: layerType,
            enabled,
            timebase: 'output',
            range: {
              start: 0,
              end: Number(duration.toFixed(2)),
            },
            params: {
              template,
              duration: Number(duration.toFixed(2)),
              text,
              subtext,
              theme: params.theme,
            },
          });
          break;
        }

        case 'overlay': {
          const scale = PlanNormalizer.clamp(
            typeof params.scale === 'number' ? params.scale : 1.0,
            0.1,
            5.0
          );
          const opacity = PlanNormalizer.clamp(
            typeof params.opacity === 'number' ? params.opacity : 1.0,
            0,
            1.0
          );

          normalizedLayers.push({
            id,
            layer: 'overlay',
            enabled,
            timebase: rawLayer.timebase === 'source' ? 'source' : 'output',
            range: rawLayer.range
              ? {
                  start: PlanNormalizer.clamp(Number(rawLayer.range.start) || 0, 0, maxDuration),
                  end: PlanNormalizer.clamp(Number(rawLayer.range.end) || maxDuration, 0, maxDuration),
                }
              : undefined,
            params: {
              asset: String(params.asset || 'overlay_default'),
              scale: Number(scale.toFixed(2)),
              opacity: Number(opacity.toFixed(2)),
              position: params.position
                ? {
                    x: PlanNormalizer.clamp(Number(params.position.x) || 0.5, 0, 1),
                    y: PlanNormalizer.clamp(Number(params.position.y) || 0.5, 0, 1),
                  }
                : undefined,
            },
          });
          break;
        }

        case 'music': {
          const volume = PlanNormalizer.clamp(
            typeof params.volume === 'number' ? params.volume : 0.35,
            0,
            1.0
          );
          const fadeIn = PlanNormalizer.clamp(
            typeof params.fadeIn === 'number' ? params.fadeIn : 1.5,
            0,
            10.0
          );
          const fadeOut = PlanNormalizer.clamp(
            typeof params.fadeOut === 'number' ? params.fadeOut : 3.0,
            0,
            10.0
          );
          const duckUnderSpeech = params.duckUnderSpeech !== false;
          const beatSync = params.beatSync === true;

          // Reference resolution: trackId or mood
          let trackId: string | undefined = undefined;
          let mood: string | undefined = params.mood;

          if (params.trackId) {
            const trackMatch = options.catalog.music.find(
              (m) => m.id.toLowerCase() === String(params.trackId).toLowerCase()
            );
            trackId = trackMatch ? trackMatch.id : options.catalog.music[0]?.id;
          } else if (params.mood) {
            const moodMatch = options.catalog.music.find(
              (m) => m.mood.toLowerCase() === String(params.mood).toLowerCase()
            );
            trackId = moodMatch ? moodMatch.id : options.catalog.music[0]?.id;
          } else if (options.catalog.music.length > 0) {
            trackId = options.catalog.music[0].id;
          }

          normalizedLayers.push({
            id,
            layer: 'music',
            enabled,
            timebase: 'output',
            params: {
              trackId,
              mood,
              volume: Number(volume.toFixed(2)),
              duckUnderSpeech,
              fadeIn: Number(fadeIn.toFixed(2)),
              fadeOut: Number(fadeOut.toFixed(2)),
              beatSync,
            },
          });
          break;
        }

        case 'audio': {
          const normalizeLufs = PlanNormalizer.clamp(
            typeof params.normalizeLufs === 'number' ? params.normalizeLufs : -16,
            -23,
            -14
          );
          const denoise = params.denoise === true;

          normalizedLayers.push({
            id,
            layer: 'audio',
            enabled,
            timebase: 'global',
            params: {
              normalizeLufs: Number(normalizeLufs.toFixed(1)),
              denoise,
            },
          });
          break;
        }
      }
    }

    // Beat Synchronization (Spec §3.3 / Phase 7):
    // When music layer has beatSync: true and beat grid is provided, snap cut points within 60ms to beats
    const musicLayer = normalizedLayers.find((l) => l.layer === 'music');
    if (musicLayer?.params?.beatSync && options.beats) {
      const beatGrid = Array.isArray(options.beats)
        ? options.beats
        : options.beats.grid || [];
      if (beatGrid.length > 0) {
        cutLayers = snapCutsToBeatGrid(cutLayers, beatGrid, 0.06);
      }
    }

    // Time Sanity & Cut Merging (Spec §3.7 #4):
    // "ranges inside asset duration, no overlapping cuts (merged)"
    const mergedCuts = PlanNormalizer.mergeOverlappingCuts(cutLayers);

    // Footage Preservation Rule (Spec §3.7 #5 & §3.8):
    // "Never remove more than 40 percent of footage without explicit user wording"
    const allowedToCutAggressively = PlanNormalizer.checkAggressiveCutAllowed(options.prompt || '');
    const boundedCuts = PlanNormalizer.enforceCutDurationBudget(
      mergedCuts,
      maxDuration,
      allowedToCutAggressively
    );

    // Combine cut layers with other normalized layers
    plan.layers = [...boundedCuts, ...normalizedLayers];

    return plan;
  }

  /**
   * Sorts and merges overlapping or adjacent cut intervals into contiguous intervals.
   */
  static mergeOverlappingCuts(cuts: any[]): any[] {
    if (cuts.length <= 1) return cuts;

    // Sort cuts by start time ascending
    const sorted = [...cuts].sort((a, b) => a.range.start - b.range.start);
    const merged: any[] = [];
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      // Check if overlapping or touching
      if (next.range.start <= current.range.end) {
        // Merge ranges
        current.range.end = Math.max(current.range.end, next.range.end);
        current.params.padding = Math.max(current.params.padding, next.params.padding);
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);

    // Re-index merged cut IDs cleanly
    return merged.map((c, i) => ({
      ...c,
      id: `lyr_cut_${i + 1}`,
      range: {
        start: Number(c.range.start.toFixed(3)),
        end: Number(c.range.end.toFixed(3)),
      },
    }));
  }

  /**
   * Enforces that cuts do not remove more than 40% of footage unless explicitly instructed.
   */
  static enforceCutDurationBudget(
    cuts: any[],
    maxDuration: number,
    allowAggressive: boolean
  ): any[] {
    if (allowAggressive || cuts.length === 0) return cuts;

    const maxCutAllowedSec = maxDuration * 0.4;
    let accumulatedCutSec = 0;
    const result: any[] = [];

    for (const cut of cuts) {
      const cutDur = cut.range.end - cut.range.start;
      if (accumulatedCutSec + cutDur <= maxCutAllowedSec) {
        result.push(cut);
        accumulatedCutSec += cutDur;
      } else {
        const remainingCutBudget = maxCutAllowedSec - accumulatedCutSec;
        if (remainingCutBudget > 0.3) {
          // Trim this last cut to fit the 40% budget
          result.push({
            ...cut,
            range: {
              start: cut.range.start,
              end: Number((cut.range.start + remainingCutBudget).toFixed(3)),
            },
          });
        }
        break;
      }
    }

    return result;
  }

  private static checkAggressiveCutAllowed(prompt: string): boolean {
    const p = prompt.toLowerCase();
    const keywords = [
      'summary',
      'summarize',
      'trailer',
      'highlight',
      'highlights',
      'short',
      'teaser',
      'cut aggressively',
      'remove most',
      'condense',
      'supercut',
      'only keep',
    ];
    return keywords.some((k) => p.includes(k));
  }

  static snapToNearestBeat(timeSec: number, beatGridMsOrSec: number[], maxDeltaSec = 0.06): number {
    return snapToBeat(timeSec, beatGridMsOrSec, maxDeltaSec);
  }

  private static clamp(value: number, min: number, max: number): number {
    if (isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  private static normalizeHex(colorStr: unknown, fallback: string): string {
    if (typeof colorStr === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorStr.trim())) {
      return colorStr.trim().toUpperCase();
    }
    return fallback;
  }
}
