import { ReferenceStyleProfile, EditLayer } from '@ai-video/shared';

export interface StyleAnalysisInput {
  stylePrompt: string;
  totalDurationSec: number;
  silences?: Array<{ start: number; end: number }>;
  sceneCuts?: number[];
  availableLuts?: string[];
  availableMusic?: string[];
  availableFonts?: string[];
}

export class ReferenceStyleService {
  /**
   * Predefined creator & aesthetic style archetypes.
   * Extracts purely stylistic parameters: pacing, typography, color grade, and audio profile.
   * Completely asset-free: no copyrighted pixels or audio files are cloned.
   */
  private static readonly PRESET_ARCHETYPES: Record<string, ReferenceStyleProfile> = {
    hormozi: {
      styleName: 'Alex Hormozi Retention Style',
      description:
        'Ultra-fast pacing, snappy silence cuts, punchy bold yellow word-pop subtitles, high-contrast grade, and ducked high-energy music.',
      pacing: {
        targetCutDurationSec: 1.5,
        silencePaddingSec: 0.05,
        cutSilences: true,
      },
      color: {
        preset: 'cinematic',
        lut: 'teal_orange',
        contrast: 1.25,
        saturation: 1.15,
        vignette: 0.15,
        grain: 0,
      },
      typography: {
        style: 'word_pop',
        font: 'Montserrat',
        size: 58,
        position: 'bottom',
        primaryColor: '#FFFFFF',
        highlightColor: '#FFD700', // Iconic bold yellow
        maxWordsPerLine: 3,
      },
      audio: {
        trackGenre: 'upbeat_electronic',
        duckUnderSpeech: true,
        duckToDb: -14,
        musicVolume: 0.28,
      },
    },
    abdaal: {
      styleName: 'Ali Abdaal Thoughtful Aesthetic',
      description:
        'Calm narrative pacing, warm filmic color grade, minimalist Inter captions, gentle lo-fi background beats.',
      pacing: {
        targetCutDurationSec: 3.5,
        silencePaddingSec: 0.15,
        cutSilences: true,
      },
      color: {
        preset: 'warm',
        lut: 'warm_film',
        contrast: 1.08,
        saturation: 0.95,
        vignette: 0.1,
        grain: 0.05,
      },
      typography: {
        style: 'minimal',
        font: 'Inter',
        size: 46,
        position: 'bottom',
        primaryColor: '#FFFFFF',
        highlightColor: '#38BDF8', // Soft modern sky blue
        maxWordsPerLine: 5,
      },
      audio: {
        trackGenre: 'lofi_ambient',
        duckUnderSpeech: true,
        duckToDb: -12,
        musicVolume: 0.22,
      },
    },
    vox: {
      styleName: 'Vox Documentary Explainer',
      description:
        'Documentary pacing, rich cinematic color palette, elegant typography, ambient atmospheric soundtrack with clean narrative focus.',
      pacing: {
        targetCutDurationSec: 4.0,
        silencePaddingSec: 0.2,
        cutSilences: false,
      },
      color: {
        preset: 'cinematic',
        lut: 'teal_orange',
        contrast: 1.2,
        saturation: 0.9,
        vignette: 0.2,
        grain: 0.08,
      },
      typography: {
        style: 'classic',
        font: 'Roboto',
        size: 48,
        position: 'bottom',
        primaryColor: '#F8FAFC',
        highlightColor: '#F59E0B',
        maxWordsPerLine: 5,
      },
      audio: {
        trackGenre: 'cinematic_ambient',
        duckUnderSpeech: true,
        duckToDb: -15,
        musicVolume: 0.25,
      },
    },
    viral_tiktok: {
      styleName: 'TikTok / Shorts Viral Hook Style',
      description:
        'Dynamic 9:16 vertical framing, rapid-fire word animations, vibrant high-energy color grade, and trending beat-synced audio.',
      pacing: {
        targetCutDurationSec: 1.2,
        silencePaddingSec: 0.03,
        cutSilences: true,
      },
      color: {
        preset: 'vivid',
        lut: 'vivid_pop',
        contrast: 1.3,
        saturation: 1.25,
        vignette: 0,
        grain: 0,
      },
      typography: {
        style: 'word_pop',
        font: 'Montserrat',
        size: 62,
        position: 'bottom',
        primaryColor: '#FFFFFF',
        highlightColor: '#39FF14', // Electric neon green
        maxWordsPerLine: 2,
      },
      audio: {
        trackGenre: 'upbeat_electronic',
        duckUnderSpeech: true,
        duckToDb: -12,
        musicVolume: 0.35,
      },
    },
    cinematic_film: {
      styleName: 'Cinematic 35mm Film Noir',
      description:
        'Moody contrast, film grain texture, widescreen cinematic pacing, classical typographic titles, and orchestral score.',
      pacing: {
        targetCutDurationSec: 5.0,
        silencePaddingSec: 0.25,
        cutSilences: false,
      },
      color: {
        preset: 'cinematic',
        lut: 'teal_orange',
        contrast: 1.3,
        saturation: 0.85,
        vignette: 0.35,
        grain: 0.25,
      },
      typography: {
        style: 'classic',
        font: 'Playfair',
        size: 44,
        position: 'bottom',
        primaryColor: '#E2E8F0',
        highlightColor: '#CBD5E1',
        maxWordsPerLine: 4,
      },
      audio: {
        trackGenre: 'cinematic_ambient',
        duckUnderSpeech: true,
        duckToDb: -16,
        musicVolume: 0.2,
      },
    },
  };

  /**
   * Analyzes reference style description or matches known archetype.
   * Extracts purely abstract style attributes without copying any copyrighted media.
   */
  static analyzeStyle(prompt: string): ReferenceStyleProfile {
    const lower = prompt.toLowerCase();

    // Check known archetypes
    if (lower.includes('hormozi') || lower.includes('alex hormozi')) {
      return this.PRESET_ARCHETYPES.hormozi;
    }
    if (lower.includes('abdaal') || lower.includes('ali abdaal')) {
      return this.PRESET_ARCHETYPES.abdaal;
    }
    if (lower.includes('vox') || lower.includes('documentary')) {
      return this.PRESET_ARCHETYPES.vox;
    }
    if (lower.includes('tiktok') || lower.includes('reel') || lower.includes('viral short')) {
      return this.PRESET_ARCHETYPES.viral_tiktok;
    }
    if (lower.includes('cinematic') || lower.includes('film noir') || lower.includes('35mm')) {
      return this.PRESET_ARCHETYPES.cinematic_film;
    }

    // Dynamic extraction from reference description
    let targetCutDurationSec = 2.5;
    if (lower.includes('fast') || lower.includes('snappy') || lower.includes('quick')) {
      targetCutDurationSec = 1.5;
    } else if (lower.includes('slow') || lower.includes('relaxed') || lower.includes('calm')) {
      targetCutDurationSec = 4.5;
    }

    const cutMatch = lower.match(/(?:cut|cuts|pacing)\s*(?:every)?\s*(\d+(?:\.\d+)?)\s*s/i);
    if (cutMatch && Number(cutMatch[1])) {
      targetCutDurationSec = Number(cutMatch[1]);
    }

    let preset: 'cinematic' | 'warm' | 'cool' | 'bw' | 'vivid' | 'faded' = 'cinematic';
    if (lower.includes('warm') || lower.includes('golden')) preset = 'warm';
    else if (lower.includes('cool') || lower.includes('blue')) preset = 'cool';
    else if (
      lower.includes('bw') ||
      lower.includes('black and white') ||
      lower.includes('monochrome')
    )
      preset = 'bw';
    else if (lower.includes('vivid') || lower.includes('saturated')) preset = 'vivid';
    else if (lower.includes('faded') || lower.includes('vintage')) preset = 'faded';

    const grain =
      lower.includes('grain') || lower.includes('film') || lower.includes('retro') ? 0.2 : 0;
    const vignette = lower.includes('vignette') || lower.includes('dramatic') ? 0.3 : 0.15;

    let font = 'Montserrat';
    if (lower.includes('inter')) font = 'Inter';
    else if (lower.includes('roboto')) font = 'Roboto';
    else if (lower.includes('playfair') || lower.includes('serif')) font = 'Playfair';

    let highlightColor = '#FFD700'; // Default gold/yellow
    if (lower.includes('green') || lower.includes('neon')) highlightColor = '#39FF14';
    else if (lower.includes('blue') || lower.includes('cyan')) highlightColor = '#00E5FF';
    else if (lower.includes('red')) highlightColor = '#FF3B30';
    else if (lower.includes('orange')) highlightColor = '#FF9500';

    const style = lower.includes('karaoke')
      ? 'karaoke'
      : lower.includes('minimal')
        ? 'minimal'
        : 'word_pop';

    return {
      styleName: 'Custom Analyzed Reference Style',
      description: `Extracted stylistic vectors: ${targetCutDurationSec}s cuts, ${preset} color palette, ${font} ${style} typography.`,
      pacing: {
        targetCutDurationSec,
        silencePaddingSec: targetCutDurationSec < 2 ? 0.05 : 0.15,
        cutSilences: !lower.includes('keep silence'),
      },
      color: {
        preset,
        lut: preset === 'warm' ? 'warm_film' : 'teal_orange',
        contrast: preset === 'cinematic' ? 1.2 : 1.1,
        saturation: preset === 'bw' ? 0 : preset === 'vivid' ? 1.3 : 1.0,
        vignette,
        grain,
      },
      typography: {
        style,
        font,
        size: targetCutDurationSec < 2 ? 58 : 50,
        position: 'bottom',
        primaryColor: '#FFFFFF',
        highlightColor,
        maxWordsPerLine: targetCutDurationSec < 2 ? 3 : 5,
      },
      audio: {
        trackGenre: lower.includes('lofi') ? 'lofi_beat' : 'cinematic_ambient',
        duckUnderSpeech: true,
        duckToDb: -14,
        musicVolume: 0.28,
      },
    };
  }

  /**
   * Generates pure EditPlan layers applying the analyzed style profile to user footage.
   */
  static generateStyleLayers(
    profile: ReferenceStyleProfile,
    input: StyleAnalysisInput
  ): EditLayer[] {
    const layers: EditLayer[] = [];
    let layerCounter = 1;

    // 1. Pacing & Silence Removal
    if (profile.pacing.cutSilences && input.silences && input.silences.length > 0) {
      const threshold = profile.pacing.targetCutDurationSec < 2 ? 0.5 : 0.8;
      for (const s of input.silences) {
        if (s.end - s.start >= threshold && s.start < input.totalDurationSec) {
          layers.push({
            id: `lyr_cut_style_${layerCounter++}`,
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: {
              start: Number(s.start.toFixed(2)),
              end: Number(Math.min(input.totalDurationSec, s.end).toFixed(2)),
            },
            params: {
              reason: 'style_pacing_silence',
              padding: profile.pacing.silencePaddingSec,
            },
          } as any);
        }
      }
    }

    // 2. Color Grade Layer
    layers.push({
      id: `lyr_col_style_${layerCounter++}`,
      layer: 'color',
      enabled: true,
      timebase: 'global',
      params: {
        preset: profile.color.preset,
        lut: profile.color.lut,
        contrast: profile.color.contrast,
        saturation: profile.color.saturation,
        vignette: profile.color.vignette,
        grain: profile.color.grain,
      },
    } as any);

    // 3. Subtitle Kinetic Typography Layer
    layers.push({
      id: `lyr_sub_style_${layerCounter++}`,
      layer: 'subtitle',
      enabled: true,
      timebase: 'source',
      params: {
        style: profile.typography.style,
        font: profile.typography.font,
        size: profile.typography.size,
        position: profile.typography.position,
        primaryColor: profile.typography.primaryColor,
        highlightColor: profile.typography.highlightColor,
        maxWordsPerLine: profile.typography.maxWordsPerLine,
      },
    } as any);

    // 4. Background Music Layer with Ducking
    layers.push({
      id: `lyr_mus_style_${layerCounter++}`,
      layer: 'music',
      enabled: true,
      timebase: 'output',
      params: {
        trackId: input.availableMusic?.[0] || 'tpl_lofi_beat',
        volume: profile.audio.musicVolume,
        duckUnderSpeech: profile.audio.duckUnderSpeech,
        fadeIn: 1.5,
        fadeOut: 2.5,
      },
    } as any);

    // 5. Audio Normalization Layer
    layers.push({
      id: `lyr_aud_style_${layerCounter++}`,
      layer: 'audio',
      enabled: true,
      timebase: 'global',
      params: {
        normalizeLufs: -16,
        denoise: true,
      },
    } as any);

    return layers;
  }
}
