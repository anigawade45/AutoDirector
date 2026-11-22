import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
} from './plannerProvider.interface.js';
import { AppError } from '../../middleware/errorHandler.js';
import { MetricsService } from '../observability/metrics.js';
import { ReferenceStyleService } from '../ai/referenceStyleService.js';
import { PlannerExecutionMode } from '@ai-video/shared';

export class GeminiPlannerAdapter implements PlannerProvider {
  private client: GoogleGenerativeAI | null = null;

  constructor(client?: GoogleGenerativeAI | null) {
    if (client !== undefined) {
      this.client = client;
    } else if (
      env.GEMINI_API_KEY &&
      (!process.env.VITEST || process.env.ALLOW_LIVE_LLM_TESTS === 'true')
    ) {
      this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  async generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    const targetModel = input.model || env.AI_MODEL || 'gemini-3.5-flash-lite';
    const isStrict = input.strictLlm ?? !env.ALLOW_HEURISTIC_FALLBACK;

    if (!this.client) {
      if (isStrict) {
        MetricsService.recordPlannerExecution({
          provider: 'gemini',
          requestedModel: targetModel,
          actualModel: 'none',
          executionMode: 'heuristic_fallback',
          isFallback: true,
          fallbackReason: 'Gemini API client not initialized (missing GEMINI_API_KEY)',
        });
        throw new AppError(
          502,
          'UPSTREAM_LLM_UNAVAILABLE',
          `Gemini API client not initialized (missing GEMINI_API_KEY). Heuristic fallback prohibited in strict mode.`
        );
      }
      return this.generateHeuristicPlan(input, targetModel, 'Missing GEMINI_API_KEY');
    }

    const fallbackCandidates = [
      targetModel,
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-4-argon',
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    let lastError: Error | null = null;
    for (const modelName of fallbackCandidates) {
      if (isStrict && modelName !== targetModel) {
        break;
      }
      try {
        const model = this.client.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            maxOutputTokens: input.maxOutputTokens || 4096,
          },
        });

        const promptText = `${input.systemInstructions}\n\n${input.userPrompt}`;
        const result = await model.generateContent(promptText);
        const response = await result.response;
        let text = response.text();

        if (!text) {
          throw new Error(`Gemini (${modelName}) returned an empty response`);
        }

        // Strip markdown code fences if model returned them
        text = text.trim();
        if (text.startsWith('```')) {
          text = text
            .replace(/^```(json)?\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
        }

        let structuredOutput: unknown;
        try {
          structuredOutput = JSON.parse(text);
        } catch (e) {
          throw new Error(`Failed to parse Gemini output as JSON: ${text.slice(0, 200)}`);
        }

        const isModelFallback = modelName !== targetModel;
        const executionMode: PlannerExecutionMode = isModelFallback
          ? 'fallback_llm'
          : 'primary_llm';
        const fallbackReason = isModelFallback
          ? `Primary model ${targetModel} unavailable: ${lastError?.message || 'switched to fallback model'}`
          : undefined;

        if (isModelFallback) {
          console.log(
            `[GeminiPlannerAdapter] ✓ Automatically switched to fallback model: ${modelName} (original ${targetModel} unavailable)`
          );
        }

        MetricsService.recordPlannerExecution({
          provider: 'gemini',
          requestedModel: targetModel,
          actualModel: modelName,
          executionMode,
          isFallback: isModelFallback,
          fallbackReason,
        });

        return {
          provider: 'gemini',
          model: modelName,
          structuredOutput,
          executionMode,
          isFallback: isModelFallback,
          requestedModel: targetModel,
          fallbackReason,
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount,
            outputTokens: response.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[GeminiPlannerAdapter] Model ${modelName} notice: ${err.message}. Trying fallback...`
        );
      }
    }

    if (isStrict) {
      MetricsService.recordPlannerExecution({
        provider: 'gemini',
        requestedModel: targetModel,
        actualModel: 'none',
        executionMode: 'heuristic_fallback',
        isFallback: true,
        fallbackReason: lastError?.message || 'All LLM models failed',
      });
      throw new AppError(
        502,
        'UPSTREAM_LLM_UNAVAILABLE',
        `Upstream Gemini call failed (${lastError?.message || 'all candidate models exhausted'}). Heuristic fallback prohibited in strict mode.`
      );
    }

    console.warn(
      `[GeminiPlannerAdapter] Remote call failed (${lastError?.message}). Falling back to heuristic planner.`
    );
    return this.generateHeuristicPlan(input, targetModel, lastError?.message);
  }

  private generateHeuristicPlan(
    input: PlannerProviderInput,
    targetModel?: string,
    fallbackReason?: string
  ): PlannerProviderOutput {
    let contextData: any = {};
    try {
      contextData = JSON.parse(input.userPrompt);
    } catch {
      contextData = { instruction: input.userPrompt, context: {} };
    }

    const instruction = (contextData.instruction || '').toLowerCase();
    const ctx = contextData.context || {};
    const baseAssetId = ctx.baseAssetId || 'ast_base';
    const projectId = ctx.projectId || 'prj_demo';
    const targetVersion = ctx.targetVersion || 1;
    const currentPlan = ctx.currentPlan;
    const totalDurationSec = (ctx.videoMeta?.durationMs || 60000) / 1000;

    const resolvedTargetModel =
      targetModel || input.model || env.AI_MODEL || 'gemini-3.5-flash-lite';
    const reason =
      fallbackReason || (this.client ? 'Upstream LLM unavailable' : 'No Gemini API key configured');

    // Check if this is a follow-up prompt on an existing plan and not a reset request
    const isReset =
      instruction.includes('start over') ||
      instruction.includes('from scratch') ||
      instruction.includes('reset');
    if (currentPlan && !isReset) {
      const patches: Array<{ op: string; path: string; value?: unknown }> = [];

      // Silence cuts / dead air removal
      if (
        instruction.includes('silence') ||
        instruction.includes('silent') ||
        instruction.includes('pause') ||
        (instruction.includes('cut') && !instruction.includes('scene'))
      ) {
        let thresholdSec = 0.6;
        const matchThreshold = instruction.match(/(?:longer than|over|>)\s*(\d+(?:\.\d+)?)\s*s/i);
        if (matchThreshold && Number(matchThreshold[1])) {
          thresholdSec = Number(matchThreshold[1]);
        }

        const silences = ctx.audioAnalysis?.silenceIntervalsSec || [];
        const existingCuts = (currentPlan.layers || []).filter((l: any) => l.layer === 'cut');
        let cutCounter = existingCuts.length + 1;

        for (const s of silences) {
          const sStart = typeof s.start === 'number' ? Number(s.start.toFixed(3)) : 0;
          const sEnd = typeof s.end === 'number' ? Number(s.end.toFixed(3)) : 0;
          if (sEnd - sStart >= thresholdSec && sStart < totalDurationSec) {
            patches.push({
              op: 'add',
              path: '/layers/-',
              value: {
                id: `lyr_cut_silence_${cutCounter++}`,
                layer: 'cut',
                enabled: true,
                timebase: 'source',
                range: {
                  start: Math.max(0, sStart),
                  end: Math.min(totalDurationSec, sEnd),
                },
                params: { reason: 'silence', padding: 0.05 },
              },
            });
          }
        }
      }

      // Subtitle adjustments
      if (instruction.includes('subtitle') || instruction.includes('caption')) {
        const subLayer = currentPlan.layers?.find((l: any) => l.layer === 'subtitle');
        const subId = subLayer?.id || 'lyr_sub_1';

        if (
          instruction.includes('big') ||
          instruction.includes('larger') ||
          instruction.includes('size')
        ) {
          const matchNum = instruction.match(/\b(\d{2})\b/);
          const size = matchNum ? parseInt(matchNum[1], 10) : 72;
          patches.push({ op: 'replace', path: `/layers/${subId}/params/size`, value: size });
        }
        if (instruction.includes('small')) {
          patches.push({ op: 'replace', path: `/layers/${subId}/params/size`, value: 36 });
        }
        if (instruction.includes('top')) {
          patches.push({ op: 'replace', path: `/layers/${subId}/params/position`, value: 'top' });
        } else if (instruction.includes('center')) {
          patches.push({
            op: 'replace',
            path: `/layers/${subId}/params/position`,
            value: 'center',
          });
        } else if (instruction.includes('bottom')) {
          patches.push({
            op: 'replace',
            path: `/layers/${subId}/params/position`,
            value: 'bottom',
          });
        }
        if (instruction.includes('font')) {
          for (const f of ['inter', 'roboto', 'montserrat', 'playfair']) {
            if (instruction.includes(f)) {
              patches.push({
                op: 'replace',
                path: `/layers/${subId}/params/font`,
                value: f.charAt(0).toUpperCase() + f.slice(1),
              });
              break;
            }
          }
        }
        if (instruction.includes('yellow') || instruction.includes('highlight')) {
          patches.push({
            op: 'replace',
            path: `/layers/${subId}/params/highlightColor`,
            value: '#FFD84D',
          });
        }
        if (instruction.includes('karaoke')) {
          patches.push({ op: 'replace', path: `/layers/${subId}/params/style`, value: 'karaoke' });
        }
      }

      // Aspect ratio
      if (
        instruction.includes('9:16') ||
        instruction.includes('vertical') ||
        instruction.includes('tiktok') ||
        instruction.includes('reel') ||
        instruction.includes('shorts')
      ) {
        patches.push({ op: 'replace', path: '/global/aspect', value: '9:16' });
      } else if (instruction.includes('1:1') || instruction.includes('square')) {
        patches.push({ op: 'replace', path: '/global/aspect', value: '1:1' });
      } else if (
        instruction.includes('16:9') ||
        instruction.includes('horizontal') ||
        instruction.includes('youtube')
      ) {
        patches.push({ op: 'replace', path: '/global/aspect', value: '16:9' });
      }

      // Color preset / grading
      if (
        instruction.includes('warm') ||
        instruction.includes('cool') ||
        instruction.includes('cinematic') ||
        instruction.includes('bw') ||
        instruction.includes('monochrome') ||
        instruction.includes('vivid')
      ) {
        const colLayer = currentPlan.layers?.find((l: any) => l.layer === 'color');
        const colId = colLayer?.id || 'lyr_col_1';
        const preset = instruction.includes('warm')
          ? 'warm'
          : instruction.includes('cool')
            ? 'cool'
            : instruction.includes('bw') || instruction.includes('monochrome')
              ? 'bw'
              : instruction.includes('vivid')
                ? 'vivid'
                : 'cinematic';
        if (colLayer) {
          patches.push({ op: 'replace', path: `/layers/${colId}/params/preset`, value: preset });
        } else {
          patches.push({
            op: 'add',
            path: '/layers/-',
            value: {
              id: 'lyr_col_new',
              layer: 'color',
              enabled: true,
              timebase: 'global',
              params: { preset, contrast: 1.15, saturation: 1.0 },
            },
          });
        }
      }

      // Music adjustment
      if (
        instruction.includes('music') ||
        instruction.includes('song') ||
        instruction.includes('track')
      ) {
        const musLayer = currentPlan.layers?.find((l: any) => l.layer === 'music');
        const musId = musLayer?.id || 'lyr_mus_1';

        if (
          instruction.includes('quieter') ||
          instruction.includes('lower volume') ||
          instruction.includes('soft')
        ) {
          if (musLayer) {
            patches.push({ op: 'replace', path: `/layers/${musId}/params/volume`, value: 0.15 });
          } else {
            patches.push({
              op: 'add',
              path: '/layers/-',
              value: {
                id: 'lyr_mus_new',
                layer: 'music',
                enabled: true,
                timebase: 'output',
                params: {
                  trackId: ctx.availableCatalog?.music?.[0]?.id || 'tpl_lofi_beat',
                  volume: 0.15,
                  duckUnderSpeech: true,
                },
              },
            });
          }
        } else if (instruction.includes('louder') || instruction.includes('higher volume')) {
          if (musLayer) {
            patches.push({ op: 'replace', path: `/layers/${musId}/params/volume`, value: 0.6 });
          } else {
            patches.push({
              op: 'add',
              path: '/layers/-',
              value: {
                id: 'lyr_mus_new',
                layer: 'music',
                enabled: true,
                timebase: 'output',
                params: {
                  trackId: ctx.availableCatalog?.music?.[0]?.id || 'tpl_lofi_beat',
                  volume: 0.6,
                  duckUnderSpeech: true,
                },
              },
            });
          }
        } else if (
          instruction.includes('remove') ||
          instruction.includes('delete') ||
          instruction.includes('mute')
        ) {
          if (musLayer) {
            patches.push({ op: 'remove', path: `/layers/${musId}` });
          }
        } else if (!musLayer) {
          patches.push({
            op: 'add',
            path: '/layers/-',
            value: {
              id: 'lyr_mus_new',
              layer: 'music',
              enabled: true,
              timebase: 'output',
              params: {
                trackId: ctx.availableCatalog?.music?.[0]?.id || 'tpl_lofi_beat',
                volume: 0.35,
                duckUnderSpeech: true,
              },
            },
          });
        }
      }

      // Audio cleanup adjustments (denoise & loudness normalization)
      if (
        instruction.includes('denoise') ||
        instruction.includes('noise') ||
        instruction.includes('clean') ||
        instruction.includes('loudness') ||
        instruction.includes('lufs') ||
        instruction.includes('normalize audio')
      ) {
        const audLayer = currentPlan.layers?.find((l: any) => l.layer === 'audio');
        const audId = audLayer?.id || 'lyr_aud_1';
        const targetLufs = instruction.includes('-14') ? -14 : instruction.includes('-23') ? -23 : -16;
        const wantDenoise = !instruction.includes('disable denoise') && !instruction.includes('no denoise');

        if (audLayer) {
          patches.push({
            op: 'replace',
            path: `/layers/${audId}/params/normalizeLufs`,
            value: targetLufs,
          });
          patches.push({
            op: 'replace',
            path: `/layers/${audId}/params/denoise`,
            value: wantDenoise,
          });
        } else {
          patches.push({
            op: 'add',
            path: '/layers/-',
            value: {
              id: 'lyr_aud_new',
              layer: 'audio',
              enabled: true,
              timebase: 'global',
              params: {
                normalizeLufs: targetLufs,
                denoise: wantDenoise,
              },
            },
          });
        }
      }

      // Remove intro
      if (
        (instruction.includes('remove') || instruction.includes('delete')) &&
        instruction.includes('intro')
      ) {
        const introLayer = currentPlan.layers?.find((l: any) => l.layer === 'intro');
        if (introLayer) {
          patches.push({ op: 'remove', path: `/layers/${introLayer.id}` });
        }
      }

      // Speed adjustments
      if (
        instruction.includes('faster') ||
        instruction.includes('speed') ||
        instruction.includes('fast') ||
        instruction.includes('slow') ||
        instruction.includes('pacing')
      ) {
        const speedMatch =
          instruction.match(/(\d+(?:\.\d+)?)\s*x\s*speed/i) ||
          instruction.match(/speed\s*(?:of\s*video\s*)?(?:to|by|at)?\s*(\d+(?:\.\d+)?)\s*x?/i) ||
          instruction.match(/(\d+(?:\.\d+)?)\s*x/i);
        let factor = speedMatch
          ? parseFloat(speedMatch[1])
          : instruction.includes('slow')
            ? 0.75
            : 1.5;
        factor = Math.max(0.25, Math.min(4.0, Number(factor.toFixed(2))));

        const spdLayer = currentPlan.layers?.find((l: any) => l.layer === 'speed');
        if (spdLayer) {
          patches.push({
            op: 'replace',
            path: `/layers/${spdLayer.id}/params/factor`,
            value: factor,
          });
        } else {
          patches.push({
            op: 'add',
            path: '/layers/-',
            value: {
              id: 'lyr_spd_new',
              layer: 'speed',
              enabled: true,
              timebase: 'source',
              range: { start: 0, end: totalDurationSec },
              params: { factor, keepPitch: true },
            },
          });
        }
      }

      // B-Roll / Image / Generative Media Overlay
      if (
        instruction.includes('broll') ||
        instruction.includes('b-roll') ||
        instruction.includes('cutaway') ||
        instruction.includes('image') ||
        instruction.includes('generative') ||
        instruction.includes('overlay') ||
        instruction.includes('stock')
      ) {
        let asset = 'broll_tech';
        for (const k of ['tech', 'city', 'nature', 'workspace', 'cyberpunk', 'abstract', 'finance']) {
          if (instruction.includes(k)) {
            asset = `broll_${k}`;
            break;
          }
        }
        const mediaType = instruction.includes('generative')
          ? 'generative'
          : instruction.includes('image')
          ? 'image'
          : 'broll';

        const sStart = Math.min(totalDurationSec - 2, 2.5);
        const sEnd = Math.min(totalDurationSec, sStart + 3.0);
        patches.push({
          op: 'add',
          path: '/layers/-',
          value: {
            id: `lyr_ov_${Date.now()}`,
            layer: 'overlay',
            enabled: true,
            timebase: 'source',
            range: { start: Number(sStart.toFixed(2)), end: Number(sEnd.toFixed(2)) },
            params: {
              asset,
              mediaType,
              mode: instruction.includes('pip') ? 'pip' : 'cutaway',
              scale: 1.0,
              opacity: 1.0,
              prompt: instruction.includes('generate') ? instruction : undefined,
            },
          },
        });
      }

      // Reference-Style Analysis and Transfer Without Copying Assets (Patches)
      if (
        instruction.includes('style') ||
        instruction.includes('reference') ||
        instruction.includes('hormozi') ||
        instruction.includes('abdaal') ||
        instruction.includes('vox')
      ) {
        const profile = ReferenceStyleService.analyzeStyle(instruction);

        // Patch color layer
        const colLayer = currentPlan.layers?.find((l: any) => l.layer === 'color');
        if (colLayer) {
          patches.push({ op: 'replace', path: `/layers/${colLayer.id}/params/preset`, value: profile.color.preset });
          patches.push({ op: 'replace', path: `/layers/${colLayer.id}/params/contrast`, value: profile.color.contrast });
          patches.push({ op: 'replace', path: `/layers/${colLayer.id}/params/saturation`, value: profile.color.saturation });
        }

        // Patch subtitle layer
        const subLayer = currentPlan.layers?.find((l: any) => l.layer === 'subtitle');
        if (subLayer) {
          patches.push({ op: 'replace', path: `/layers/${subLayer.id}/params/style`, value: profile.typography.style });
          patches.push({ op: 'replace', path: `/layers/${subLayer.id}/params/font`, value: profile.typography.font });
          patches.push({ op: 'replace', path: `/layers/${subLayer.id}/params/highlightColor`, value: profile.typography.highlightColor });
          patches.push({ op: 'replace', path: `/layers/${subLayer.id}/params/size`, value: profile.typography.size });
        }

        // Patch music layer
        const musLayer = currentPlan.layers?.find((l: any) => l.layer === 'music');
        if (musLayer) {
          patches.push({ op: 'replace', path: `/layers/${musLayer.id}/params/duckUnderSpeech`, value: profile.audio.duckUnderSpeech });
          patches.push({ op: 'replace', path: `/layers/${musLayer.id}/params/volume`, value: profile.audio.musicVolume });
        }
      }

      // Aspect Ratio Re-framing / Short-form Extraction
      if (
        instruction.includes('9:16') ||
        instruction.includes('vertical') ||
        instruction.includes('short') ||
        instruction.includes('tiktok') ||
        instruction.includes('reel')
      ) {
        patches.push({ op: 'replace', path: '/global/aspect', value: '9:16' });
      }

      return {
        provider: 'gemini',
        model: 'rule-engine-v1',
        structuredOutput: { patch: patches },
        executionMode: 'heuristic_fallback',
        isFallback: true,
        requestedModel: resolvedTargetModel,
        fallbackReason: reason,
        usage: { inputTokens: 40, outputTokens: 80 },
      };
    }

    // Initial Plan Generation
    let aspect: '16:9' | '9:16' | '1:1' | '4:5' = currentPlan?.global?.aspect || '16:9';
    if (
      instruction.includes('9:16') ||
      instruction.includes('vertical') ||
      instruction.includes('tiktok') ||
      instruction.includes('reel') ||
      instruction.includes('shorts')
    ) {
      aspect = '9:16';
    } else if (instruction.includes('1:1') || instruction.includes('square')) {
      aspect = '1:1';
    } else if (
      instruction.includes('16:9') ||
      instruction.includes('horizontal') ||
      instruction.includes('youtube')
    ) {
      aspect = '16:9';
    }

    // Reference-Style Analysis Without Copying Assets
    const isStyleTransfer =
      instruction.includes('style') ||
      instruction.includes('reference') ||
      instruction.includes('hormozi') ||
      instruction.includes('abdaal') ||
      instruction.includes('vox');

    const styleProfile = isStyleTransfer
      ? ReferenceStyleService.analyzeStyle(instruction)
      : null;

    const layers: any[] = [];
    let layerCounter = 1;

    // Short-form extraction trimming if long video has highlights
    const isShortRequested =
      aspect === '9:16' ||
      instruction.includes('short') ||
      instruction.includes('tiktok') ||
      instruction.includes('reel');

    if (isShortRequested && totalDurationSec > 45 && ctx.highlights && ctx.highlights.length > 0) {
      const topHl = ctx.highlights[0];
      const hlStart = Math.max(0, topHl.startSec || 0);
      const hlEnd = Math.min(totalDurationSec, topHl.endSec || Math.min(totalDurationSec, hlStart + 60));

      if (hlStart > 1.0) {
        layers.push({
          id: `lyr_cut_short_pre_${layerCounter++}`,
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: 0, end: Number(hlStart.toFixed(2)) },
          params: { reason: 'short_extraction_trim' },
        });
      }
      if (hlEnd < totalDurationSec - 1.0) {
        layers.push({
          id: `lyr_cut_short_post_${layerCounter++}`,
          layer: 'cut',
          enabled: true,
          timebase: 'source',
          range: { start: Number(hlEnd.toFixed(2)), end: Number(totalDurationSec.toFixed(2)) },
          params: { reason: 'short_extraction_trim' },
        });
      }
    }

    // 1. Cut Layer (silences from audio analysis)
    const isSilenceRequested =
      isStyleTransfer ||
      isShortRequested ||
      instruction.includes('silence') ||
      instruction.includes('cut') ||
      instruction.includes('quiet') ||
      instruction.includes('pacing') ||
      instruction.includes('tighten');

    if (isSilenceRequested) {
      const silences = ctx.audioAnalysis?.silenceIntervalsSec || [];
      const padding = styleProfile ? styleProfile.pacing.silencePaddingSec : 0.15;
      for (const s of silences) {
        if (s.end > s.start) {
          layers.push({
            id: `lyr_cut_${layerCounter++}`,
            layer: 'cut',
            enabled: true,
            timebase: 'source',
            range: {
              start: Number(s.start.toFixed(2)),
              end: Number(s.end.toFixed(2)),
            },
            params: {
              reason: 'silence',
              padding,
            },
          });
        }
      }
    }

    // 2. Color Preset Layer
    const preset = styleProfile
      ? styleProfile.color.preset
      : instruction.includes('warm')
      ? 'warm'
      : instruction.includes('cool')
        ? 'cool'
        : instruction.includes('bw') || instruction.includes('monochrome')
          ? 'bw'
          : instruction.includes('vivid')
            ? 'vivid'
            : 'cinematic';

    layers.push({
      id: `lyr_col_${layerCounter++}`,
      layer: 'color',
      enabled: true,
      timebase: 'global',
      params: {
        preset,
        contrast: styleProfile ? styleProfile.color.contrast : 1.15,
        saturation: preset === 'bw' ? 0 : styleProfile ? styleProfile.color.saturation : 0.95,
        vignette: styleProfile?.color.vignette ?? 0.25,
        grain: styleProfile?.color.grain ?? (instruction.includes('grain') || instruction.includes('vintage') ? 0.2 : 0),
        lut: styleProfile?.color.lut || ctx.availableCatalog?.luts?.[0]?.id || 'teal_orange',
      },
    });

    // 3. Subtitle Layer
    const wantsSubtitles =
      isStyleTransfer ||
      isShortRequested ||
      instruction.includes('sub') ||
      instruction.includes('caption') ||
      instruction.includes('word') ||
      instruction.includes('text') ||
      instruction.includes('cinematic') ||
      instruction.includes('engaging') ||
      instruction.length === 0;

    if (wantsSubtitles) {
      const style = styleProfile
        ? styleProfile.typography.style
        : instruction.includes('karaoke')
          ? 'karaoke'
          : 'word_pop';
      layers.push({
        id: `lyr_sub_${layerCounter++}`,
        layer: 'subtitle',
        enabled: true,
        timebase: 'source',
        params: {
          style,
          font: styleProfile?.typography.font || ctx.availableCatalog?.fonts?.[0] || 'Montserrat',
          size: styleProfile?.typography.size || (isShortRequested ? 58 : 52),
          position: styleProfile?.typography.position || 'bottom',
          primaryColor: styleProfile?.typography.primaryColor || '#FFFFFF',
          highlightColor: styleProfile?.typography.highlightColor || (isShortRequested ? '#FFD700' : '#FFD84D'),
          maxWordsPerLine: styleProfile?.typography.maxWordsPerLine || (isShortRequested ? 3 : 4),
        },
      });
    }

    // 4. Transitions
    if (
      instruction.includes('transition') ||
      instruction.includes('smooth') ||
      instruction.includes('cinematic')
    ) {
      const cuts = ctx.audioAnalysis?.sceneCutPointsSec || [12.4];
      for (const cutSec of cuts.slice(0, 3)) {
        if (cutSec < totalDurationSec - 1) {
          layers.push({
            id: `lyr_trn_${layerCounter++}`,
            layer: 'transition',
            enabled: true,
            timebase: 'source',
            range: {
              start: cutSec,
              end: Number((cutSec + 0.5).toFixed(2)),
            },
            params: {
              type: 'dissolve',
              duration: 0.5,
              at: cutSec,
            },
          });
        }
      }
    }

    // 5. Intro
    if (
      instruction.includes('intro') ||
      instruction.includes('title') ||
      instruction.includes('engaging')
    ) {
      const template = ctx.availableCatalog?.templates?.[0]?.id || 'cinematic';
      layers.push({
        id: `lyr_int_${layerCounter++}`,
        layer: 'intro',
        enabled: true,
        timebase: 'output',
        range: { start: 0, end: 5 },
        params: {
          template,
          duration: 5,
          text: contextData.instruction ? contextData.instruction.slice(0, 40) : 'Video Overview',
        },
      });
    }

    // 6. Speed
    if (
      instruction.includes('speed') ||
      instruction.includes('fast') ||
      instruction.includes('quick') ||
      instruction.includes('slow') ||
      instruction.includes('pacing')
    ) {
      const speedMatch =
        instruction.match(/(\d+(?:\.\d+)?)\s*x\s*speed/i) ||
        instruction.match(/speed\s*(?:of\s*video\s*)?(?:to|by|at)?\s*(\d+(?:\.\d+)?)\s*x?/i) ||
        instruction.match(/(\d+(?:\.\d+)?)\s*x/i);
      let factor = speedMatch
        ? parseFloat(speedMatch[1])
        : instruction.includes('slow')
          ? 0.75
          : 1.5;
      factor = Math.max(0.25, Math.min(4.0, Number(factor.toFixed(2))));
      layers.push({
        id: `lyr_spd_${layerCounter++}`,
        layer: 'speed',
        enabled: true,
        timebase: 'source',
        range: { start: 0, end: totalDurationSec },
        params: { factor, keepPitch: true },
      });
    }

    // 7. Music
    if (
      isStyleTransfer ||
      isShortRequested ||
      instruction.includes('music') ||
      instruction.includes('audio') ||
      instruction.includes('song') ||
      instruction.includes('beat')
    ) {
      layers.push({
        id: `lyr_mus_${layerCounter++}`,
        layer: 'music',
        enabled: true,
        timebase: 'output',
        params: {
          trackId: ctx.availableCatalog?.music?.[0]?.id || 'tpl_lofi_beat',
          volume: styleProfile?.audio.musicVolume ?? 0.35,
          duckUnderSpeech: styleProfile?.audio.duckUnderSpeech ?? true,
          fadeIn: 1.5,
          fadeOut: 2.5,
          beatSync: instruction.includes('beat'),
        },
      });
    }

    // 8. Audio loudness normalize
    layers.push({
      id: `lyr_aud_${layerCounter++}`,
      layer: 'audio',
      enabled: true,
      timebase: 'global',
      params: {
        normalizeLufs: -16,
        denoise: instruction.includes('denoise') || instruction.includes('noise'),
      },
    });

    // 9. B-Roll / Image / Generative Media Cutaway
    if (
      instruction.includes('broll') ||
      instruction.includes('b-roll') ||
      instruction.includes('cutaway') ||
      instruction.includes('image') ||
      instruction.includes('generative') ||
      instruction.includes('overlay') ||
      instruction.includes('stock')
    ) {
      let asset = 'broll_tech';
      for (const k of ['tech', 'city', 'nature', 'workspace', 'cyberpunk', 'abstract', 'finance']) {
        if (instruction.includes(k)) {
          asset = `broll_${k}`;
          break;
        }
      }
      const mediaType = instruction.includes('generative')
        ? 'generative'
        : instruction.includes('image')
        ? 'image'
        : 'broll';

      const sStart = Math.min(totalDurationSec - 2, 2.5);
      const sEnd = Math.min(totalDurationSec, sStart + 3.0);
      layers.push({
        id: `lyr_ov_${layerCounter++}`,
        layer: 'overlay',
        enabled: true,
        timebase: 'source',
        range: { start: Number(sStart.toFixed(2)), end: Number(sEnd.toFixed(2)) },
        params: {
          asset,
          mediaType,
          mode: instruction.includes('pip') ? 'pip' : 'cutaway',
          scale: 1.0,
          opacity: 1.0,
          prompt: instruction.includes('generate') ? instruction : undefined,
        },
      });
    }

    MetricsService.recordPlannerExecution({
      provider: 'gemini',
      requestedModel: resolvedTargetModel,
      actualModel: 'rule-engine-v1',
      executionMode: 'heuristic_fallback',
      isFallback: true,
      fallbackReason: reason,
    });

    const structuredOutput: any = {
      schemaVersion: '1.0',
      projectId,
      baseAssetId,
      version: targetVersion,
      parentVersion: currentPlan?.version ?? null,
      global: {
        aspect,
        fps: ctx.videoMeta?.fps || 30,
        resolution: '1080p',
      },
      layers,
      meta: {
        prompt: contextData.instruction || 'Edit video',
        model: 'heuristic-rule-engine',
        createdAt: new Date().toISOString(),
        executionMode: 'heuristic_fallback',
        isFallback: true,
        requestedModel: resolvedTargetModel,
        fallbackReason: reason,
      },
    };

    return {
      provider: 'gemini',
      model: 'rule-engine-v1',
      structuredOutput,
      executionMode: 'heuristic_fallback',
      isFallback: true,
      requestedModel: resolvedTargetModel,
      fallbackReason: reason,
      usage: {
        inputTokens: 50,
        outputTokens: 150,
      },
    };
  }
}
