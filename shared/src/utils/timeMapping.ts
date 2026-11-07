import { CaptionCue, WordTiming } from '../types/analysis.js';
import { Marker, Timeline, Track } from '../types/timeline.js';

export interface KeepSegment {
  srcStart: number; // in seconds
  srcEnd: number; // in seconds
  speed: number;
}

export interface CutLayerInput {
  id?: string;
  layer?: 'cut';
  timebase?: 'source';
  enabled?: boolean;
  range: {
    start: number;
    end: number;
  };
  params?: {
    reason?: 'silence' | 'filler' | 'user' | 'lowlight';
    padding?: number;
  };
}

export interface SpeedLayerInput {
  range: {
    start: number;
    end: number;
  };
  params: {
    factor: number;
    keepPitch?: boolean;
  };
}

/**
 * Snap time in seconds to the nearest beat boundary within maxDeltaSec (default 60ms = 0.06s).
 * If the distance to the closest beat is <= maxDeltaSec, returns the snapped beat time.
 * Otherwise returns the original time unchanged.
 */
export function snapToBeat(
  timeSec: number,
  beatGridMsOrSec: number[],
  maxDeltaSec: number = 0.06
): number {
  if (!beatGridMsOrSec || beatGridMsOrSec.length === 0) return timeSec;

  // Convert to seconds if values are in milliseconds (e.g. any value > 100)
  const isMs = beatGridMsOrSec.some((b) => b > 100);
  const beatsSec = isMs ? beatGridMsOrSec.map((b) => b / 1000) : beatGridMsOrSec;

  let nearestBeat = timeSec;
  let minDelta = Infinity;

  for (const beat of beatsSec) {
    const delta = Math.abs(timeSec - beat);
    if (delta < minDelta) {
      minDelta = delta;
      nearestBeat = beat;
    }
  }

  if (minDelta <= maxDeltaSec) {
    return Number(nearestBeat.toFixed(3));
  }

  return timeSec;
}

/**
 * Snaps cut boundaries (start and end) to the nearest beat within maxDeltaSec (default 60ms = 0.06s).
 */
export function snapCutsToBeatGrid<T extends { range: { start: number; end: number } }>(
  cuts: T[],
  beatGridMsOrSec: number[],
  maxDeltaSec: number = 0.06
): T[] {
  if (!beatGridMsOrSec || beatGridMsOrSec.length === 0) return cuts;

  return cuts.map((cut) => {
    const snappedStart = snapToBeat(cut.range.start, beatGridMsOrSec, maxDeltaSec);
    let snappedEnd = snapToBeat(cut.range.end, beatGridMsOrSec, maxDeltaSec);
    if (snappedEnd <= snappedStart) {
      snappedEnd = Math.max(snappedStart + 0.1, cut.range.end);
    }
    return {
      ...cut,
      range: {
        start: Number(snappedStart.toFixed(3)),
        end: Number(snappedEnd.toFixed(3)),
      },
    };
  });
}

/**
 * Snap time in seconds to the nearest frame grid boundary.
 */
export function snapToFrame(timeSec: number, fps: number): number {
  if (fps <= 0) return timeSec;
  const frameDuration = 1 / fps;
  return Math.round(timeSec / frameDuration) * frameDuration;
}

/**
 * Convert seconds to integer milliseconds snapped to frame grid.
 */
export function secToFrameMs(timeSec: number, fps: number): number {
  const snappedSec = snapToFrame(timeSec, fps);
  return Math.round(snappedSec * 1000);
}

/**
 * Extracts raw cut intervals applying padding, clamps to [0, totalDurationSec],
 * and merges overlapping or contiguous cuts.
 */
export function mergeAndNormalizeCuts(
  cuts: CutLayerInput[],
  totalDurationSec: number
): Array<{ start: number; end: number; padding: number; reason?: string }> {
  const maxDur = Math.max(0.1, totalDurationSec);

  // Apply padding: cut removes interval [start + padding, end - padding]
  // This preserves `padding` seconds of speech buffer around silence.
  const rawCuts = cuts
    .filter((c) => c.enabled !== false)
    .map((c) => {
      const padding = Math.max(0, Math.min(0.3, c.params?.padding ?? 0.05));
      const start = Math.max(0, c.range.start + padding);
      const end = Math.min(maxDur, Math.max(start, c.range.end - padding));
      return {
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        padding,
        reason: c.params?.reason,
      };
    })
    .filter((c) => c.end > c.start);

  if (rawCuts.length === 0) return [];

  // Sort chronologically by start time
  rawCuts.sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent cuts (within 0.04s frame boundary)
  const merged: Array<{ start: number; end: number; padding: number; reason?: string }> = [];
  for (const cut of rawCuts) {
    if (merged.length === 0) {
      merged.push(cut);
    } else {
      const prev = merged[merged.length - 1];
      if (cut.start <= prev.end + 0.04) {
        prev.end = Math.max(prev.end, cut.end);
        prev.padding = Math.max(prev.padding, cut.padding);
      } else {
        merged.push(cut);
      }
    }
  }

  return merged;
}

/**
 * Pure function: compiles cut and speed layers into an ordered array of keep-segments.
 * Shared by PlanResolver, FFmpegCompiler, and playback engine (Spec §4.4 Pass 1 & §5.3).
 */
export function buildKeepSegments(
  cuts: CutLayerInput[],
  totalDurationSec: number,
  speeds: SpeedLayerInput[] = [],
  fps?: number
): KeepSegment[] {
  const maxDur = Math.max(0.1, totalDurationSec);
  const mergedCuts = mergeAndNormalizeCuts(cuts, maxDur);

  // Invert cuts into keep segments
  const keepIntervals: Array<{ start: number; end: number }> = [];
  let curTime = 0;

  for (const cut of mergedCuts) {
    if (cut.start > curTime + 0.02) {
      keepIntervals.push({
        start: curTime,
        end: cut.start,
      });
    }
    curTime = Math.max(curTime, cut.end);
  }

  if (curTime < maxDur - 0.02) {
    keepIntervals.push({
      start: curTime,
      end: maxDur,
    });
  }

  if (keepIntervals.length === 0 && mergedCuts.length === 0) {
    keepIntervals.push({ start: 0, end: maxDur });
  }

  // Snap to frame grid if fps provided
  return keepIntervals.map((interval) => {
    let start = interval.start;
    let end = interval.end;

    if (fps && fps > 0) {
      start = snapToFrame(start, fps);
      end = snapToFrame(end, fps);
      if (end <= start) {
        end = start + 1 / fps;
      }
    }

    // Match applicable speed factor
    const matchingSpeed = speeds.find((sp) => sp.range.start <= start && sp.range.end >= end);
    const speed = matchingSpeed?.params?.factor
      ? Math.max(0.25, Math.min(4.0, matchingSpeed.params.factor))
      : 1.0;

    return {
      srcStart: Number(start.toFixed(3)),
      srcEnd: Number(end.toFixed(3)),
      speed,
    };
  });
}

/**
 * Maps source asset time (in seconds) to output timeline time.
 * Returns null if the source timestamp falls within a cut (removed) segment.
 *
 * @param t Source time in seconds
 * @param segs Kept segments in source time, ordered
 * @param introDur Duration of intro in output time (seconds)
 * @param overlaps Array of overlap durations (seconds) between successive segments
 */
export function srcToOut(
  t: number,
  segs: KeepSegment[],
  introDur: number = 0,
  overlaps: number[] = []
): number | null {
  let out = introDur;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (t >= s.srcStart && t <= s.srcEnd) {
      return out + (t - s.srcStart) / s.speed;
    }
    out += (s.srcEnd - s.srcStart) / s.speed - (overlaps[i] ?? 0);
  }
  return null; // inside a removed cut
}

/**
 * Maps output timeline time (in seconds) back to source asset time.
 * Returns null if output time falls inside an intro/outro or transition gap.
 */
export function outToSrc(
  t: number,
  segs: KeepSegment[],
  introDur: number = 0,
  overlaps: number[] = []
): number | null {
  if (t < introDur) return null; // inside intro

  let currentOut = introDur;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const segOutDur = (s.srcEnd - s.srcStart) / s.speed;
    const overlap = overlaps[i] ?? 0;
    const nextOut = currentOut + segOutDur - overlap;

    const isLast = i === segs.length - 1;
    const maxSegmentOut = isLast ? currentOut + segOutDur : nextOut;

    if (t >= currentOut && t <= maxSegmentOut) {
      const offset = (t - currentOut) * s.speed;
      return Math.min(s.srcEnd, s.srcStart + offset);
    }

    currentOut = nextOut;
  }

  return null; // beyond segments (e.g. inside outro)
}

/**
 * Millisecond version of srcToOut for database and timeline operations.
 */
export function srcMsToOutMs(
  tMs: number,
  segs: KeepSegment[],
  introDurMs: number = 0,
  overlapsMs: number[] = []
): number | null {
  const tSec = tMs / 1000;
  const introSec = introDurMs / 1000;
  const overlapsSec = overlapsMs.map((o) => o / 1000);
  const outSec = srcToOut(tSec, segs, introSec, overlapsSec);
  return outSec !== null ? Math.round(outSec * 1000) : null;
}

/**
 * Millisecond version of outToSrc for database and timeline scrubbing.
 */
export function outMsToSrcMs(
  tMs: number,
  segs: KeepSegment[],
  introDurMs: number = 0,
  overlapsMs: number[] = []
): number | null {
  const tSec = tMs / 1000;
  const introSec = introDurMs / 1000;
  const overlapsSec = overlapsMs.map((o) => o / 1000);
  const srcSec = outToSrc(tSec, segs, introSec, overlapsSec);
  return srcSec !== null ? Math.round(srcSec * 1000) : null;
}

/**
 * Maps source-time CaptionCues to output timeline time according to Database Blueprint §6.
 * "The resolver maps them to output time at render by walking the video track's srcInMs / startMs pairs,
 * so cutting a clip automatically drops or trims the affected cues without rewriting the caption set."
 */
export function mapCuesToOutput(
  cues: CaptionCue[],
  segs: KeepSegment[],
  introDurMs: number = 0,
  overlapsMs: number[] = []
): CaptionCue[] {
  const outputCues: CaptionCue[] = [];

  for (const cue of cues) {
    const cueStartSec = cue.startMs / 1000;
    const cueEndSec = cue.endMs / 1000;

    // Map each word
    const mappedWords: WordTiming[] = [];
    for (const w of cue.words || []) {
      const wordStartOut = srcMsToOutMs(w.s, segs, introDurMs, overlapsMs);
      const wordEndOut = srcMsToOutMs(w.e, segs, introDurMs, overlapsMs);

      if (wordStartOut !== null && wordEndOut !== null && wordEndOut > wordStartOut) {
        mappedWords.push({
          w: w.w,
          s: wordStartOut,
          e: wordEndOut,
          conf: w.conf ?? 1,
        });
      }
    }

    // If cue has words mapped, derive cue start and end from words
    if (mappedWords.length > 0) {
      outputCues.push({
        id: cue.id,
        startMs: mappedWords[0].s,
        endMs: mappedWords[mappedWords.length - 1].e,
        text: mappedWords.map((mw) => mw.w).join(' '),
        speaker: cue.speaker,
        words: mappedWords,
      });
      continue;
    }

    // If cue has no word timings, map the cue boundary
    const mappedStart = srcMsToOutMs(cue.startMs, segs, introDurMs, overlapsMs);
    const mappedEnd = srcMsToOutMs(cue.endMs, segs, introDurMs, overlapsMs);

    if (mappedStart !== null && mappedEnd !== null && mappedEnd > mappedStart) {
      outputCues.push({
        id: cue.id,
        startMs: mappedStart,
        endMs: mappedEnd,
        text: cue.text,
        speaker: cue.speaker,
        words: [],
      });
    }
  }

  return outputCues;
}

/**
 * Generates silence cut layers from audio analysis silence intervals (Spec §3.4 & §9).
 * Every silence interval longer than minSilenceDurSec (default 0.6s) produces a cut layer.
 */
export function generateSilenceCutLayers(
  silences: Array<{ startMs: number; endMs: number; avgDb?: number }>,
  options: { minSilenceDurSec?: number; paddingSec?: number; idPrefix?: string } = {}
): CutLayerInput[] {
  const minDur = options.minSilenceDurSec ?? 0.6; // 0.6s per Spec §3.4 & §9 acceptance criteria
  const padding = options.paddingSec ?? 0.05;
  const prefix = options.idPrefix ?? 'lyr_cut';

  let count = 1;
  const cutLayers: CutLayerInput[] = [];

  for (const s of silences) {
    const durSec = (s.endMs - s.startMs) / 1000;
    if (durSec >= minDur) {
      cutLayers.push({
        id: `${prefix}_${count++}`,
        layer: 'cut',
        timebase: 'source',
        enabled: true,
        range: {
          start: Number((s.startMs / 1000).toFixed(3)),
          end: Number((s.endMs / 1000).toFixed(3)),
        },
        params: {
          reason: 'silence',
          padding,
        },
      });
    }
  }

  return cutLayers;
}

/**
 * Computes ripple cut markers for the frontend timeline editor (Spec §5.3).
 * "Tracks derived for rendering: Video (keep-segments as clips, cuts shown as ripples)"
 */
export function computeRippleCuts(
  cuts: CutLayerInput[],
  totalDurationSec: number
): Array<{ id: string; startSec: number; endSec: number; durationSec: number; reason: string }> {
  const merged = mergeAndNormalizeCuts(cuts, totalDurationSec);
  return merged.map((c, i) => ({
    id: `ripple_${i + 1}`,
    startSec: c.start,
    endSec: c.end,
    durationSec: Number((c.end - c.start).toFixed(3)),
    reason: c.reason || 'silence',
  }));
}

/**
 * Validates Database Schema Blueprint §5.4 invariants on a resolved Timeline.
 */
export function verifyTimelineInvariants(
  timeline: Timeline,
  assetDurationMs: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const fps = timeline.fps || 30;
  const frameDurMs = 1000 / fps;

  // Invariant 6: At most 12 tracks and 2,000 clips per timeline
  if (timeline.tracks.length > 12) {
    errors.push(`Track limit exceeded: ${timeline.tracks.length} > 12`);
  }
  const totalClips = timeline.tracks.reduce((acc: number, t: Track) => acc + t.clips.length, 0);
  if (totalClips > 2000) {
    errors.push(`Clip limit exceeded: ${totalClips} > 2000`);
  }

  let maxClipEndMs = 0;

  for (const track of timeline.tracks) {
    let prevEndMs = 0;

    for (let i = 0; i < track.clips.length; i++) {
      const clip = track.clips[i];
      const clipEndMs = clip.startMs + clip.durMs;
      if (clipEndMs > maxClipEndMs) {
        maxClipEndMs = clipEndMs;
      }

      // Invariant 1: Within one track, clips never overlap (except transitionOut)
      if (clip.startMs < prevEndMs - 2) {
        // Allow transitionOut overlap if specified
        const prevClip = track.clips[i - 1];
        const allowedOverlap = prevClip?.transitionOut?.durMs || 0;
        if (clip.startMs < prevEndMs - allowedOverlap - 2) {
          errors.push(
            `Clip overlap on track ${track.id}: clip ${clip.id} startMs ${clip.startMs} < prevEndMs ${prevEndMs}`
          );
        }
      }
      prevEndMs = clipEndMs;

      // Invariant 2: srcOutMs - srcInMs divided by speed equals durMs for video/audio
      if (
        (clip.type === 'video' || clip.type === 'audio') &&
        clip.srcInMs !== undefined &&
        clip.srcOutMs !== undefined
      ) {
        const speed = clip.speed || 1.0;
        const expectedDur = Math.round((clip.srcOutMs - clip.srcInMs) / speed);
        if (Math.abs(expectedDur - clip.durMs) > 2) {
          errors.push(
            `Duration mismatch on clip ${clip.id}: durMs ${clip.durMs} != expected ${expectedDur}`
          );
        }

        // Invariant 3: srcOutMs does not exceed referenced asset duration
        if (clip.srcOutMs > assetDurationMs + 100) {
          errors.push(
            `srcOutMs exceeds asset duration on clip ${clip.id}: ${clip.srcOutMs} > ${assetDurationMs}`
          );
        }
      }
    }
  }

  // Invariant 7: durationMs equals greatest startMs + durMs across all tracks
  if (Math.abs(timeline.durationMs - maxClipEndMs) > 5) {
    errors.push(
      `Timeline durationMs ${timeline.durationMs} does not match max track end ${maxClipEndMs}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
