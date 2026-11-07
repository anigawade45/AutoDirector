import { EditPlan, Timeline, Track, Clip, Effect, Marker, TransitionOut, CaptionCue } from '@ai-video/shared';
import { secToFrameMs, buildKeepSegments, computeRippleCuts, mapCuesToOutput, verifyTimelineInvariants } from '@ai-video/shared';
import { nanoid } from 'nanoid';

export interface ResolverInput {
  plan: EditPlan;
  assetDurationMs: number;
  captionSetId?: string;
  cues?: CaptionCue[];
  sourcePlanObjectId?: any;
}

export class PlanResolver {
  /**
   * Deterministically resolves an EditPlan into an editable, output-time Timeline document.
   * Applies silence cut layers, speed scaling, time resolution, transitions, and Blueprint §5.4 invariants.
   */
  static resolve(input: ResolverInput): Timeline {
    const { plan, assetDurationMs, captionSetId, cues, sourcePlanObjectId } = input;
    const fps = plan.global.fps || 30;
    const totalAssetSec = assetDurationMs / 1000;

    // 1. Build keep-segments from cut & speed layers
    const cutLayers = plan.layers.filter((l) => l.enabled && l.layer === 'cut') as any[];
    const speedLayers = plan.layers.filter((l) => l.enabled && l.layer === 'speed') as any[];
    const transitionLayers = plan.layers.filter((l) => l.enabled && l.layer === 'transition') as any[];

    const keepSegments = buildKeepSegments(cutLayers, totalAssetSec, speedLayers, fps);

    // 2. Identify Intro and Outro
    const introLayer = plan.layers.find((l) => l.enabled && l.layer === 'intro') as any;
    const outroLayer = plan.layers.find((l) => l.enabled && l.layer === 'outro') as any;

    const introDurMs = introLayer ? secToFrameMs(introLayer.params.duration, fps) : 0;
    const outroDurMs = outroLayer ? secToFrameMs(outroLayer.params.duration, fps) : 0;

    // 3. Build Video Track Clips
    const videoClips: Clip[] = [];
    let currentStartMs = 0;

    // Add intro clip if present
    if (introLayer) {
      videoClips.push({
        id: `clp_${nanoid(8)}`,
        type: 'intro',
        startMs: 0,
        durMs: introDurMs,
        enabled: true,
        templateId: introLayer.params.template,
        params: {
          text: introLayer.params.text,
          subtext: introLayer.params.subtext,
          theme: introLayer.params.theme,
        },
        origin: { layerId: introLayer.id, source: 'ai' },
      });
      currentStartMs = introDurMs;
    }

    // Add video keep-segments as clips
    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const srcInMs = secToFrameMs(seg.srcStart, fps);
      const srcOutMs = Math.min(assetDurationMs, secToFrameMs(seg.srcEnd, fps));
      const durMs = Math.round((srcOutMs - srcInMs) / seg.speed);

      // Match transition with next segment if applicable
      let transitionOut: TransitionOut | null = null;
      if (i < keepSegments.length - 1) {
        const trans = transitionLayers.find((t) => Math.abs(t.params.at - seg.srcEnd) < 0.2);
        if (trans) {
          transitionOut = {
            type: trans.params.type,
            durMs: secToFrameMs(trans.params.duration, fps),
          };
        }
      }

      videoClips.push({
        id: `clp_${nanoid(8)}`,
        type: 'video',
        assetId: plan.baseAssetId,
        srcInMs,
        srcOutMs,
        startMs: currentStartMs,
        durMs,
        speed: seg.speed,
        enabled: true,
        transitionOut,
        origin: { layerId: `seg_${i}`, source: 'ai' },
      });

      // Advance output timeline, accounting for transition overlap (Blueprint §5.4 Invariant 1)
      const overlapMs = transitionOut ? transitionOut.durMs : 0;
      currentStartMs += durMs - overlapMs;
    }

    // Add outro clip if present
    if (outroLayer) {
      videoClips.push({
        id: `clp_${nanoid(8)}`,
        type: 'outro',
        startMs: currentStartMs,
        durMs: outroDurMs,
        enabled: true,
        templateId: outroLayer.params.template,
        params: {
          text: outroLayer.params.text,
          subtext: outroLayer.params.subtext,
          theme: outroLayer.params.theme,
        },
        origin: { layerId: outroLayer.id, source: 'ai' },
      });
      currentStartMs += outroDurMs;
    }

    const tracks: Track[] = [
      {
        id: `trk_v1`,
        kind: 'video',
        order: 0,
        name: 'Main Video',
        locked: false,
        muted: false,
        hidden: false,
        clips: videoClips,
      },
    ];

    // 4. Subtitle Track
    const subtitleLayer = plan.layers.find((l) => l.enabled && l.layer === 'subtitle') as any;
    if (subtitleLayer && captionSetId) {
      const outputCues = cues ? mapCuesToOutput(cues, keepSegments, introDurMs) : [];
      const subtitleDurMs = Math.max(0, currentStartMs - introDurMs - outroDurMs);

      tracks.push({
        id: `trk_s1`,
        kind: 'subtitle',
        order: 1,
        name: 'Captions',
        locked: false,
        muted: false,
        hidden: false,
        clips: [
          {
            id: `clp_${nanoid(8)}`,
            type: 'subtitle',
            captionSetId,
            startMs: introDurMs,
            durMs: subtitleDurMs,
            enabled: true,
            style: subtitleLayer.params,
            params: {
              cuesCount: outputCues.length,
            },
            origin: { layerId: subtitleLayer.id, source: 'ai' },
          },
        ],
      });
    }

    // 5. Music Track
    const musicLayer = plan.layers.find((l) => l.enabled && l.layer === 'music') as any;
    if (musicLayer) {
      tracks.push({
        id: `trk_m1`,
        kind: 'music',
        order: 2,
        name: 'Background Music',
        locked: false,
        muted: false,
        hidden: false,
        volumeDb: -12,
        clips: [
          {
            id: `clp_${nanoid(8)}`,
            type: 'music',
            catalogId: musicLayer.params.trackId || 'default_music',
            srcInMs: 0,
            srcOutMs: currentStartMs,
            startMs: 0,
            durMs: currentStartMs,
            enabled: true,
            params: musicLayer.params,
            origin: { layerId: musicLayer.id, source: 'ai' },
          },
        ],
      });
    }

    // 6. Global Effects (Color, Audio)
    const colorLayer = plan.layers.find((l) => l.enabled && l.layer === 'color') as any;
    const globalEffects: Effect[] = [];
    if (colorLayer) {
      globalEffects.push({
        id: `fx_${nanoid(6)}`,
        type: 'color',
        enabled: true,
        params: colorLayer.params,
      });
    }

    const audioLayer = plan.layers.find((l) => l.enabled && l.layer === 'audio') as any;
    if (audioLayer) {
      globalEffects.push({
        id: `fx_${nanoid(6)}`,
        type: 'normalize',
        enabled: true,
        params: audioLayer.params,
      });
    }

    // 7. Markers: Ripple Cuts and Scene Cuts
    const markers: Marker[] = [];
    const ripples = computeRippleCuts(cutLayers, totalAssetSec);
    for (const r of ripples) {
      markers.push({
        id: `mk_${r.id}`,
        tMs: Math.round(r.startSec * 1000),
        label: `Cut: ${r.reason} (-${r.durationSec.toFixed(2)}s)`,
        kind: 'user',
      });
    }

    const timeline: Timeline = {
      projectId: plan.projectId,
      userId: '',
      rev: 0,
      version: plan.version,
      fps,
      width: plan.global.width || 1920,
      height: plan.global.height || 1080,
      durationMs: currentStartMs,
      tracks,
      markers,
      globalEffects,
      sourcePlanId: sourcePlanObjectId || null,
    };

    return timeline;
  }
}
