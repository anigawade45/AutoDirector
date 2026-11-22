import { AllowedCatalog } from './plannerProvider.interface.js';
import { snapCutsToBeatGrid, snapToBeat } from '@ai-video/shared';

export interface NormalizerOptions {
  assetDurationSec: number;
  catalog?: AllowedCatalog;
  prompt?: string;
  beats?: any;
  silences?: Array<{ startMs: number; endMs: number; avgDb?: number }>;
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

    if (!options.catalog) {
      options.catalog = {
        templates: [],
        luts: [],
        music: [],
        fonts: ['Montserrat', 'Inter', 'Roboto'],
      };
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

    // Filter out unknown layer types & clamp layers budget to max 2000
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

    // 1. Normalize layer types and synonyms BEFORE filtering
    layers = layers.map((rawL: any) => {
      if (!rawL || typeof rawL !== 'object') return rawL;
      const l = { ...rawL };
      let typeStr = String(l.layer || '')
        .toLowerCase()
        .trim();

      if (['subtitles', 'subtitle', 'captions', 'caption', 'subs'].includes(typeStr)) {
        l.layer = 'subtitle';
      } else if (
        ['color', 'color_grade', 'colorgrade', 'colorgrading', 'colour', 'lut', 'filter'].includes(
          typeStr
        )
      ) {
        l.layer = 'color';
      } else if (['cut', 'cuts', 'trim', 'trims', 'source', 'clip', 'snip'].includes(typeStr)) {
        l.layer = 'cut';
      } else if (['music', 'bgm', 'soundtrack', 'song', 'audio_track'].includes(typeStr)) {
        l.layer = 'music';
      } else if (['speed', 'speed_ramp', 'ramp', 'slowmo', 'timelapse'].includes(typeStr)) {
        l.layer = 'speed';
      } else if (['text', 'title', 'titles', 'heading', 'lowerthird'].includes(typeStr)) {
        l.layer = 'text';
      } else if (['transition', 'transitions'].includes(typeStr)) {
        l.layer = 'transition';
      } else if (['intro', 'intros'].includes(typeStr)) {
        l.layer = 'intro';
      } else if (['outro', 'outros'].includes(typeStr)) {
        l.layer = 'outro';
      } else if (
        [
          'overlay',
          'overlays',
          'broll',
          'b-roll',
          'cutaway',
          'cutaways',
          'image',
          'images',
          'generative',
          'stock',
          'media',
        ].includes(typeStr)
      ) {
        l.layer = 'overlay';
      } else if (
        [
          'audio',
          'audio_cleanup',
          'audiocleanup',
          'cleanup',
          'denoise',
          'noise_reduction',
          'noisereduction',
          'loudness',
          'voice_processing',
          'voice',
          'audio_fx',
        ].includes(typeStr)
      ) {
        l.layer = 'audio';
      } else if (typeStr === 'global') {
        if (
          l.params?.color ||
          l.params?.lut ||
          l.params?.contrast ||
          l.params?.preset ||
          l.id?.includes('col')
        ) {
          l.layer = 'color';
        }
      }

      // Infer from ID if layer type still ambiguous
      if (!allowedLayerTypes.includes(l.layer) && typeof l.id === 'string') {
        const idLower = l.id.toLowerCase();
        if (idLower.includes('sub') || idLower.includes('cap')) l.layer = 'subtitle';
        else if (idLower.includes('col') || idLower.includes('lut') || idLower.includes('grade'))
          l.layer = 'color';
        else if (idLower.includes('cut') || idLower.includes('trim')) l.layer = 'cut';
        else if (idLower.includes('mus') || idLower.includes('bgm')) l.layer = 'music';
        else if (idLower.includes('aud') || idLower.includes('denoise') || idLower.includes('clean') || idLower.includes('lufs'))
          l.layer = 'audio';
      }

      return l;
    });

    layers = layers.filter(
      (l) => l && typeof l === 'object' && allowedLayerTypes.includes(l.layer)
    );
    const maxLayers = options.maxLayers || 2000;
    if (layers.length > maxLayers) {
      layers = layers.slice(0, maxLayers);
    }

    let layerIdx = 1;
    const normalizedLayers: any[] = [];
    let cutLayers: any[] = [];

    for (const rawLayer of layers) {
      const layerType = rawLayer.layer;
      const id = String(rawLayer.id || `lyr_${layerType}_${layerIdx++}`);
      const enabled = rawLayer.enabled !== false;
      const params =
        rawLayer.params && typeof rawLayer.params === 'object' ? { ...rawLayer.params } : {};

      switch (layerType) {
        case 'cut': {
          let rawStart =
            rawLayer.range?.start ?? params.sourceIn ?? params.start ?? rawLayer.start ?? 0;
          let rawEnd =
            rawLayer.range?.end ?? params.sourceOut ?? params.end ?? rawLayer.end ?? maxDuration;
          let start = PlanNormalizer.clamp(Number(rawStart) || 0, 0, maxDuration);
          let end = PlanNormalizer.clamp(Number(rawEnd) || maxDuration, 0, maxDuration);

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
          const end = PlanNormalizer.clamp(
            Number(rawLayer.range?.end) || maxDuration,
            0,
            maxDuration
          );
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
          let cParams = { ...params };
          if (cParams.color && typeof cParams.color === 'object') {
            cParams = { ...cParams, ...cParams.color };
          }

          const validPresets = ['cinematic', 'warm', 'cool', 'bw', 'vivid', 'faded'];
          let preset = validPresets.includes(cParams.preset) ? cParams.preset : undefined;
          const pLower = (options.prompt || '').toLowerCase();
          if (!preset) {
            if (
              cParams.lut === 'teal_orange' ||
              pLower.includes('cinematic') ||
              pLower.includes('teal')
            )
              preset = 'cinematic';
            else if (pLower.includes('warm')) preset = 'warm';
            else if (pLower.includes('cool')) preset = 'cool';
            else if (pLower.includes('bw') || pLower.includes('black and white')) preset = 'bw';
            else if (pLower.includes('vivid')) preset = 'vivid';
            else if (pLower.includes('faded')) preset = 'faded';
            else if (cParams.contrast !== undefined || cParams.saturation !== undefined)
              preset = 'cinematic';
          }

          const brightness = PlanNormalizer.clamp(
            typeof cParams.brightness === 'number' ? cParams.brightness : 0,
            -0.3,
            0.3
          );
          const contrast = PlanNormalizer.clamp(
            typeof cParams.contrast === 'number' ? cParams.contrast : 1.15,
            0.7,
            1.5
          );
          const saturation = PlanNormalizer.clamp(
            typeof cParams.saturation === 'number' ? cParams.saturation : 1.1,
            0,
            2.0
          );
          const vignette = PlanNormalizer.clamp(
            typeof cParams.vignette === 'number' ? cParams.vignette : 0,
            0,
            1.0
          );
          const grain = PlanNormalizer.clamp(
            typeof cParams.grain === 'number' ? cParams.grain : 0,
            0,
            0.5
          );

          // Reference resolution: LUT
          let lut: string | undefined = undefined;
          if (cParams.lut) {
            const lutMatch = options.catalog.luts.find(
              (l) => l.id.toLowerCase() === String(cParams.lut).toLowerCase()
            );
            lut = lutMatch ? lutMatch.id : options.catalog.luts[0]?.id;
          } else if (preset === 'cinematic' || pLower.includes('teal')) {
            lut =
              options.catalog.luts.find((l) => l.id.includes('teal'))?.id ||
              options.catalog.luts[0]?.id ||
              'teal_orange';
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
          let sStyle = params.style || 'word_pop';
          if (sStyle === 'word-pop') sStyle = 'word_pop';
          const validStyles = ['classic', 'word_pop', 'karaoke', 'minimal'];
          const style = validStyles.includes(sStyle) ? sStyle : 'word_pop';
          const validPositions = ['bottom', 'center', 'top'];
          const position = validPositions.includes(params.position) ? params.position : 'bottom';
          const rawSize = params.size ?? params.fontSize ?? 56;
          const size = Math.round(PlanNormalizer.clamp(Number(rawSize) || 56, 24, 96));
          const maxWordsPerLine = Math.round(
            PlanNormalizer.clamp(
              typeof params.maxWordsPerLine === 'number' ? params.maxWordsPerLine : 4,
              2,
              8
            )
          );

          // Reference resolution: font
          let font = 'Montserrat';
          if (
            params.font &&
            options.catalog.fonts.some((f) => f.toLowerCase() === params.font.toLowerCase())
          ) {
            font = options.catalog.fonts.find(
              (f) => f.toLowerCase() === params.font.toLowerCase()
            )!;
          } else if (options.catalog.fonts.length > 0) {
            font = options.catalog.fonts[0];
          }

          const primaryColor = PlanNormalizer.normalizeHex(
            params.primaryColor || params.color,
            '#FFFFFF'
          );
          const highlightColor = PlanNormalizer.normalizeHex(
            params.highlightColor ||
              params.highlight ||
              ((options.prompt || '').toLowerCase().includes('yellow') ? '#FFD700' : '#FFD84D'),
            '#FFD84D'
          );

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
                  end: PlanNormalizer.clamp(
                    Number(rawLayer.range.end) || maxDuration,
                    0,
                    maxDuration
                  ),
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
            options.catalog.templates.some(
              (t) => t.id.toLowerCase() === params.template.toLowerCase()
            )
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

          const mediaType = ['broll', 'image', 'generative'].includes(params.mediaType)
            ? params.mediaType
            : String(params.asset || '').startsWith('http') || String(params.asset || '').startsWith('data:')
            ? 'image'
            : params.prompt
            ? 'generative'
            : 'broll';

          const mode = ['cutaway', 'pip', 'sticker'].includes(params.mode) ? params.mode : 'cutaway';
          const fit = ['cover', 'contain'].includes(params.fit) ? params.fit : 'cover';

          normalizedLayers.push({
            id,
            layer: 'overlay',
            enabled,
            timebase: rawLayer.timebase === 'source' ? 'source' : 'output',
            range: rawLayer.range
              ? {
                  start: PlanNormalizer.clamp(Number(rawLayer.range.start) || 0, 0, maxDuration),
                  end: PlanNormalizer.clamp(
                    Number(rawLayer.range.end) || maxDuration,
                    0,
                    maxDuration
                  ),
                }
              : undefined,
            params: {
              asset: String(params.asset || 'broll_tech'),
              mediaType,
              prompt: params.prompt ? String(params.prompt).slice(0, 300) : undefined,
              mode,
              fit,
              scale: Number(scale.toFixed(2)),
              opacity: Number(opacity.toFixed(2)),
              position: params.position
                ? {
                    x: PlanNormalizer.clamp(Number(params.position.x) || 0.5, 0, 1),
                    y: PlanNormalizer.clamp(Number(params.position.y) || 0.5, 0, 1),
                  }
                : { x: 0.5, y: 0.5 },
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
      const beatGrid = Array.isArray(options.beats) ? options.beats : options.beats.grid || [];
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

    // Synthesize missing layers if user prompt explicitly requested them but LLM produced none
    const promptLower = (options.prompt || '').toLowerCase();

    // 1. Silence cutting fallback:
    if (
      boundedCuts.length === 0 &&
      (promptLower.includes('silence') ||
        promptLower.includes('silent') ||
        promptLower.includes('pause')) &&
      options.silences &&
      options.silences.length > 0
    ) {
      let thresholdSec = 0.6;
      const matchThreshold = promptLower.match(/(?:longer than|over|>)\s*(\d+(?:\.\d+)?)\s*s/i);
      if (matchThreshold && Number(matchThreshold[1])) {
        thresholdSec = Number(matchThreshold[1]);
      }

      for (const s of options.silences) {
        const sStart = Number((s.startMs / 1000).toFixed(3));
        const sEnd = Number((s.endMs / 1000).toFixed(3));
        if (sEnd - sStart >= thresholdSec && sStart < maxDuration) {
          boundedCuts.push({
            id: `lyr_cut_silence_${boundedCuts.length + 1}`,
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: {
              start: Math.max(0, sStart),
              end: Math.min(maxDuration, sEnd),
            },
            params: { reason: 'silence', padding: 0.05 },
          });
        }
      }
    }

    // 2. Color grading fallback:
    if (
      !normalizedLayers.some((l) => l.layer === 'color') &&
      (promptLower.includes('cinematic') ||
        promptLower.includes('teal') ||
        promptLower.includes('orange') ||
        promptLower.includes('color grade') ||
        promptLower.includes('warm') ||
        promptLower.includes('cool') ||
        promptLower.includes('lut') ||
        (plan.global as any)?.colorGrading ||
        (plan.global as any)?.preset)
    ) {
      let preset = 'cinematic';
      let lut = options.catalog?.luts?.[0]?.id || 'teal_orange';
      if (promptLower.includes('warm')) {
        preset = 'warm';
        lut = undefined as any;
      } else if (promptLower.includes('cool')) {
        preset = 'cool';
        lut = undefined as any;
      } else if (promptLower.includes('bw') || promptLower.includes('black and white')) {
        preset = 'bw';
        lut = undefined as any;
      } else if (promptLower.includes('vivid')) {
        preset = 'vivid';
        lut = undefined as any;
      } else if (promptLower.includes('faded')) {
        preset = 'faded';
        lut = undefined as any;
      }

      normalizedLayers.push({
        id: 'lyr_color_1',
        layer: 'color',
        enabled: true,
        timebase: 'global',
        params: {
          preset,
          lut,
          contrast: 1.15,
          saturation: 1.2,
          brightness: 0,
          vignette: 0,
          grain: 0,
        },
      });
    }

    // 3. Subtitles fallback:
    if (
      !normalizedLayers.some((l) => l.layer === 'subtitle') &&
      (promptLower.includes('subtitle') ||
        promptLower.includes('subtitles') ||
        promptLower.includes('caption') ||
        promptLower.includes('word-pop'))
    ) {
      normalizedLayers.push({
        id: 'lyr_sub_1',
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style: 'word_pop',
          font: 'Montserrat',
          size: 56,
          position: 'bottom',
          primaryColor: '#FFFFFF',
          highlightColor: promptLower.includes('yellow') ? '#FFD700' : '#FFD84D',
          maxWordsPerLine: 4,
        },
      });
    }

    // 4. Music fallback:
    if (
      !normalizedLayers.some((l) => l.layer === 'music') &&
      (promptLower.includes('music') ||
        promptLower.includes('soundtrack') ||
        promptLower.includes('bgm'))
    ) {
      normalizedLayers.push({
        id: 'lyr_mus_1',
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          trackId: options.catalog?.music?.[0]?.id || 'tpl_lofi_beat',
          volume: 0.35,
          duckUnderSpeech: true,
          fadeIn: 1.5,
          fadeOut: 2.5,
          beatSync: promptLower.includes('beat'),
        },
      });
    }

    // 5. Audio cleanup fallback:
    if (
      !normalizedLayers.some((l) => l.layer === 'audio') &&
      (promptLower.includes('audio') ||
        promptLower.includes('denoise') ||
        promptLower.includes('noise') ||
        promptLower.includes('clean') ||
        promptLower.includes('loudness') ||
        promptLower.includes('lufs') ||
        promptLower.includes('normalize'))
    ) {
      normalizedLayers.push({
        id: 'lyr_aud_1',
        layer: 'audio',
        enabled: true,
        timebase: 'global',
        params: {
          normalizeLufs: promptLower.includes('-14') ? -14 : promptLower.includes('-23') ? -23 : -16,
          denoise: promptLower.includes('denoise') || promptLower.includes('noise') || promptLower.includes('clean'),
        },
      });
    }

    // Enforce singleton layer invariants (Spec §3.7 #5: intro, outro, color, subtitle, audio, music)
    const singletonTypes = ['intro', 'outro', 'color', 'subtitle', 'audio', 'music'];
    const seenSingletons = new Set<string>();
    const deduplicatedLayers: any[] = [];
    for (const l of normalizedLayers) {
      if (singletonTypes.includes(l.layer)) {
        if (seenSingletons.has(l.layer)) {
          continue; // Deduplicate: keep first primary singleton layer
        }
        seenSingletons.add(l.layer);
      }
      deduplicatedLayers.push(l);
    }

    // Combine cut layers with other normalized layers
    plan.layers = [...boundedCuts, ...deduplicatedLayers];

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
    if (
      typeof colorStr === 'string' &&
      /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorStr.trim())
    ) {
      return colorStr.trim().toUpperCase();
    }
    return fallback;
  }
}
