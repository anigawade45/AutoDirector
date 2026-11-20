/**
 * Speech-Aware Subtitle Word Timing and Cadence Engine
 * Computes natural human speech pacing using syllable/character weighting and punctuation pauses,
 * and maintains proportional anchor points during cue edits.
 */

export interface WordItem {
  word: string;
  startMs: number;
  endMs: number;
  score?: number;
}

/**
 * Computes natural word timings based on character count and punctuation pauses,
 * or proportionally shifts existing word timings when cue boundaries change.
 */
export function computeNaturalWordTimings(
  tokens: string[],
  startMs: number,
  endMs: number,
  existingWords?: Array<{
    word?: string;
    w?: string;
    startMs?: number;
    s?: number;
    endMs?: number;
    e?: number;
  }>
): WordItem[] {
  if (!tokens || tokens.length === 0) return [];
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart + 100, Math.round(endMs));
  const totalDuration = safeEnd - safeStart;

  // Case 1: Existing words match tokens count and words match tokens text
  // Scale and shift existing acoustic anchor points proportionally into the new [safeStart, safeEnd] window
  if (
    Array.isArray(existingWords) &&
    existingWords.length === tokens.length &&
    existingWords.length > 0 &&
    existingWords.every((w, i) => {
      const existingText = String(w.word || w.w || '')
        .toLowerCase()
        .trim();
      const tokenText = tokens[i].toLowerCase().trim();
      return existingText === tokenText || Math.abs(existingText.length - tokenText.length) <= 1;
    })
  ) {
    const oldFirstStart = existingWords[0].startMs ?? existingWords[0].s ?? safeStart;
    const oldLastEnd =
      existingWords[existingWords.length - 1].endMs ??
      existingWords[existingWords.length - 1].e ??
      safeEnd;
    const oldDur = Math.max(100, oldLastEnd - oldFirstStart);

    return existingWords.map((w, i) => {
      const s = w.startMs ?? w.s ?? oldFirstStart;
      const e = w.endMs ?? w.e ?? oldLastEnd;
      const relStart = Math.max(0, Math.min(1, (s - oldFirstStart) / oldDur));
      const relEnd = Math.max(relStart + 0.05, Math.min(1, (e - oldFirstStart) / oldDur));
      const newStart = Math.round(safeStart + relStart * totalDuration);
      const newEnd = Math.round(safeStart + relEnd * totalDuration);
      return {
        word: tokens[i],
        startMs: newStart,
        endMs: Math.max(newStart + 60, newEnd),
        score: 1,
      };
    });
  }

  // Case 2: Natural Speech Weighting based on character length and punctuation cadence
  // Human speech spends more vocal time on multi-syllable words and pauses on punctuation
  const weights = tokens.map((token) => {
    const cleanLen = token.replace(/[^a-zA-Z0-9]/g, '').length;
    let weight = Math.max(2, cleanLen);

    // Minor pause for clause breaks
    if (token.endsWith(',') || token.endsWith(';') || token.endsWith(':') || token.endsWith('-')) {
      weight += 2.5;
    }
    // Major pause for sentence terminals
    else if (token.endsWith('.') || token.endsWith('!') || token.endsWith('?')) {
      weight += 4.5;
    }
    return weight;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let currentStart = safeStart;

  return tokens.map((token, idx) => {
    const isLast = idx === tokens.length - 1;
    const tokenDuration = isLast
      ? safeEnd - currentStart
      : Math.round((weights[idx] / totalWeight) * totalDuration);

    const s = currentStart;
    const e = isLast ? safeEnd : Math.min(safeEnd, s + Math.max(80, tokenDuration));
    currentStart = e;

    return {
      word: token,
      startMs: s,
      endMs: Math.max(s + 60, e),
      score: 1,
    };
  });
}

/**
 * Nudges a specific word's start timing by deltaMs (+/-), maintaining sequence order
 */
export function nudgeWordTiming(
  words: WordItem[],
  wordIdx: number,
  deltaMs: number,
  cueStartMs: number,
  cueEndMs: number
): WordItem[] {
  if (!words || wordIdx < 0 || wordIdx >= words.length) return words;

  const updated = words.map((w) => ({ ...w }));
  const target = updated[wordIdx];
  const newStart = Math.max(cueStartMs, Math.min(target.endMs - 60, target.startMs + deltaMs));

  // If nudging earlier than previous word's start, adjust previous word's end
  if (wordIdx > 0 && newStart < updated[wordIdx - 1].endMs) {
    updated[wordIdx - 1].endMs = newStart;
  }

  target.startMs = newStart;

  // Maintain next word relationship if start nudged past current end
  if (target.startMs >= target.endMs) {
    target.endMs = Math.min(cueEndMs, target.startMs + 150);
  }

  return updated;
}

export interface OverlapItem {
  index: number;
  overlapMs: number;
  nextStartMs: number;
}

/**
 * Detects any subtitle cues that overlap in time with subsequent cues
 */
export function detectCueOverlaps<T extends { startMs: number; endMs: number }>(
  cues: T[]
): OverlapItem[] {
  if (!cues || cues.length <= 1) return [];
  const overlaps: OverlapItem[] = [];

  for (let i = 0; i < cues.length - 1; i++) {
    const cur = cues[i];
    const next = cues[i + 1];
    if (cur.endMs > next.startMs) {
      overlaps.push({
        index: i,
        overlapMs: cur.endMs - next.startMs,
        nextStartMs: next.startMs,
      });
    }
  }

  return overlaps;
}

/**
 * Intelligently parses raw timestamps (numbers, decimal seconds, and timecode strings) into integer milliseconds.
 */
export function parseTimestampToMs(raw: any, isSecondsMode: boolean = false): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') {
    if (isNaN(raw)) return 0;
    if (isSecondsMode || (raw > 0 && raw < 1000 && raw % 1 !== 0)) {
      return Math.round(raw * 1000);
    }
    if (isSecondsMode) {
      return Math.round(raw * 1000);
    }
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      if (parts.length === 2) {
        const m = parseFloat(parts[0]) || 0;
        const s = parseFloat(parts[1]) || 0;
        return Math.round((m * 60 + s) * 1000);
      } else if (parts.length === 3) {
        const h = parseFloat(parts[0]) || 0;
        const m = parseFloat(parts[1]) || 0;
        const s = parseFloat(parts[2]) || 0;
        return Math.round((h * 3600 + m * 60 + s) * 1000);
      }
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
      if (isSecondsMode || trimmed.endsWith('s') || num % 1 !== 0) {
        return Math.round(num * 1000);
      }
      return Math.round(num);
    }
  }
  return 0;
}

/**
 * Detects if raw cues timestamps are denominated in seconds rather than milliseconds.
 */
export function detectIfSeconds(rawCues: any[], totalDurationMs?: number): boolean {
  if (!Array.isArray(rawCues) || rawCues.length === 0) return false;
  let maxVal = 0;
  let hasDecimals = false;

  for (const c of rawCues) {
    const rawStart = c.startMs ?? c.start_ms ?? c.start ?? c.startTime ?? c.start_time ?? c.s;
    const rawEnd = c.endMs ?? c.end_ms ?? c.end ?? c.endTime ?? c.end_time ?? c.e;

    const numStart = typeof rawStart === 'number' ? rawStart : parseFloat(rawStart);
    const numEnd = typeof rawEnd === 'number' ? rawEnd : parseFloat(rawEnd);

    if (!isNaN(numStart) && numStart > 0) {
      if (numStart > maxVal) maxVal = numStart;
      if (numStart % 1 !== 0) hasDecimals = true;
    }
    if (!isNaN(numEnd) && numEnd > 0) {
      if (numEnd > maxVal) maxVal = numEnd;
      if (numEnd % 1 !== 0) hasDecimals = true;
    }

    const words = Array.isArray(c.words) ? c.words : Array.isArray(c.tokens) ? c.tokens : [];
    for (const w of words) {
      const ws = w.s ?? w.start ?? w.startMs ?? w.start_ms ?? w.startTime;
      const we = w.e ?? w.end ?? w.endMs ?? w.end_ms ?? w.endTime;
      const numWs = typeof ws === 'number' ? ws : parseFloat(ws);
      const numWe = typeof we === 'number' ? we : parseFloat(we);
      if (!isNaN(numWs) && numWs > 0) {
        if (numWs > maxVal) maxVal = numWs;
        if (numWs % 1 !== 0) hasDecimals = true;
      }
      if (!isNaN(numWe) && numWe > 0) {
        if (numWe > maxVal) maxVal = numWe;
        if (numWe % 1 !== 0) hasDecimals = true;
      }
    }
  }

  if (hasDecimals) return true;
  if (totalDurationMs && totalDurationMs >= 10000 && maxVal > 0 && maxVal < 1000) {
    return true;
  }
  if (
    totalDurationMs &&
    totalDurationMs >= 10000 &&
    maxVal > 0 &&
    maxVal <= Math.ceil(totalDurationMs / 1000) * 1.5 &&
    maxVal < totalDurationMs * 0.1
  ) {
    return true;
  }
  return false;
}

/**
 * Normalizes any cues in seconds to standard integer milliseconds
 */
export function normalizeCuesTimebase<T extends { startMs: number; endMs: number; words?: any[] }>(
  cues: T[],
  totalDurationMs?: number
): T[] {
  if (!cues || cues.length === 0) return [];
  const isSeconds = detectIfSeconds(cues, totalDurationMs);
  if (!isSeconds) return cues;

  return cues.map((cue: any) => {
    const rawStart = cue.startMs ?? cue.start_ms ?? cue.start ?? cue.startTime ?? cue.s;
    const rawEnd = cue.endMs ?? cue.end_ms ?? cue.end ?? cue.endTime ?? cue.e;
    const startMs = parseTimestampToMs(rawStart, true);
    const endMs = Math.max(startMs + 100, parseTimestampToMs(rawEnd, true));

    const words = (cue.words || []).map((w: any) => {
      const rawWs = w.s ?? w.start ?? w.startMs ?? w.start_ms ?? w.startTime;
      const rawWe = w.e ?? w.end ?? w.endMs ?? w.end_ms ?? w.endTime;
      const ws = parseTimestampToMs(rawWs, true);
      const we = Math.max(ws + 50, parseTimestampToMs(rawWe, true));
      return {
        ...w,
        s: ws,
        e: we,
        startMs: ws,
        endMs: we,
      };
    });

    return {
      ...cue,
      startMs,
      endMs,
      words,
    };
  });
}

/**
 * Strictly enforces sequential, non-overlapping cue boundaries.
 * Clamps cue[i].endMs to cue[i+1].startMs - minGapMs and rescales internal word timings
 * so duplicate text never displays simultaneously on video.
 */
export function resolveCueOverlaps<
  T extends { startMs: number; endMs: number; words?: any[]; id?: string; text?: string },
>(cues: T[], minGapMs: number = 30, maxDurationMs?: number): T[] {
  if (!cues || cues.length === 0) return [];
  if (cues.length === 1) {
    const single = { ...cues[0] };
    if (maxDurationMs && maxDurationMs > 0) {
      if (single.endMs > maxDurationMs) {
        single.endMs = maxDurationMs;
        if (single.startMs >= maxDurationMs) {
          single.startMs = Math.max(0, maxDurationMs - 150);
        }
      }
    }
    return [single as T];
  }

  const sorted = [...cues].map((c) => ({
    ...c,
    text: String(c.text || (c.words || []).map((w: any) => w.word || w.w || '').join(' ') || '').trim(),
    startMs: Math.max(0, Math.round(Number(c.startMs) || 0)),
    endMs: Math.max(0, Math.round(Number(c.endMs) || 0)),
    words: Array.isArray(c.words) ? [...c.words] : [],
  }));
  sorted.sort((a, b) => a.startMs - b.startMs);

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];

    // If next cue starts at or before current start, enforce clean separation
    if (next.startMs <= cur.startMs) {
      const step = maxDurationMs
        ? Math.max(
            100,
            Math.min(500, Math.floor((maxDurationMs - cur.startMs) / (sorted.length - i)))
          )
        : 500;
      next.startMs = cur.startMs + step;
      if (next.endMs <= next.startMs) {
        next.endMs = next.startMs + 1000;
      }
    }

    // If current cue ends after next cue starts, cleanly clamp and resolve the overlap
    if (cur.endMs > next.startMs - minGapMs) {
      const maxAllowedEnd = Math.max(cur.startMs + 100, next.startMs - minGapMs);
      const oldDur = Math.max(100, cur.endMs - cur.startMs);
      const newDur = Math.max(100, maxAllowedEnd - cur.startMs);
      cur.endMs = maxAllowedEnd;

      // Proportionally rescale word timings inside cur cue
      if (Array.isArray(cur.words) && cur.words.length > 0) {
        const curStart = cur.startMs;
        const curEnd = cur.endMs;

        cur.words = cur.words.map((w: any) => {
          const s = w.s ?? w.startMs ?? curStart;
          const e = w.e ?? w.endMs ?? curEnd;
          const relS = Math.max(0, Math.min(1, (s - curStart) / oldDur));
          const relE = Math.max(relS + 0.05, Math.min(1, (e - curStart) / oldDur));
          const newS = Math.round(curStart + relS * newDur);
          const newE = Math.min(curEnd, Math.max(newS + 40, Math.round(curStart + relE * newDur)));
          return {
            ...w,
            s: newS,
            e: newE,
            startMs: newS,
            endMs: newE,
          };
        });
      }
    }
  }

  // Ensure final cue has valid non-zero duration
  const last = sorted[sorted.length - 1];
  if (last.endMs <= last.startMs) {
    last.endMs = last.startMs + 1000;
  }

  if (maxDurationMs && maxDurationMs > 0) {
    for (const cue of sorted) {
      if (cue.endMs > maxDurationMs) {
        cue.endMs = maxDurationMs;
        if (cue.startMs >= maxDurationMs) {
          cue.startMs = Math.max(0, maxDurationMs - 150);
        }
        if (Array.isArray(cue.words)) {
          for (const w of cue.words) {
            if (w.e > maxDurationMs) {
              w.e = maxDurationMs;
              w.endMs = maxDurationMs;
            }
            if (w.s >= maxDurationMs) {
              w.s = Math.max(0, maxDurationMs - 100);
              w.startMs = w.s;
            }
          }
        }
      }
    }
  }

  return sorted as T[];
}

/**
 * Intelligently distributes collapsed or zero-offset dialogue cues across physical audible speech intervals.
 */
export function distributeCuesAcrossSpeech<
  T extends { startMs: number; endMs: number; words?: any[]; id?: string; text?: string },
>(
  cues: T[],
  speechSegments: Array<{ startMs: number; endMs: number }>,
  totalDurationMs: number
): T[] {
  if (!cues || cues.length === 0) return [];

  let segments = [...speechSegments].filter((s) => s.endMs > s.startMs + 100);
  if (segments.length === 0) {
    segments = [{ startMs: 500, endMs: Math.max(1000, totalDurationMs - 500) }];
  }

  const cueTokenCounts = cues.map((c) => {
    const tokens = String(c.text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return Math.max(1, tokens.length);
  });
  const totalTokens = cueTokenCounts.reduce((sum, n) => sum + n, 0);
  const totalSpeechTimeMs = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

  let currentSegIdx = 0;
  let segConsumedMs = 0;

  const distributed = cues.map((cue, idx) => {
    const cueTokens = cueTokenCounts[idx];
    const cueTargetDurMs = Math.max(
      1000,
      Math.round((cueTokens / totalTokens) * totalSpeechTimeMs)
    );

    while (
      currentSegIdx < segments.length - 1 &&
      segConsumedMs >= segments[currentSegIdx].endMs - segments[currentSegIdx].startMs
    ) {
      currentSegIdx++;
      segConsumedMs = 0;
    }

    const curSeg = segments[currentSegIdx];
    const segRemaining = curSeg.endMs - curSeg.startMs - segConsumedMs;
    const startMs = curSeg.startMs + segConsumedMs;
    const allocatedDur = Math.min(cueTargetDurMs, Math.max(1000, segRemaining));
    const endMs = Math.min(curSeg.endMs, startMs + allocatedDur);
    segConsumedMs += allocatedDur;

    const tokens = String(cue.text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const cueDur = Math.max(200, endMs - startMs);
    const perWordDur = Math.max(80, Math.floor(cueDur / Math.max(1, tokens.length)));

    const words = tokens.map((tok, tIdx) => {
      const isLast = tIdx === tokens.length - 1;
      const s = startMs + tIdx * perWordDur;
      const e = isLast ? endMs : Math.min(endMs, s + perWordDur);
      return {
        word: tok,
        w: tok,
        s,
        e: Math.max(s + 50, e),
        startMs: s,
        endMs: Math.max(s + 50, e),
        score: 1,
      };
    });

    return {
      ...cue,
      id: cue.id || `cue_${idx + 1}`,
      startMs,
      endMs,
      words,
    };
  });

  return resolveCueOverlaps(distributed, 30, totalDurationMs);
}

/**
 * Shifts all cues forward or backward by deltaMs (milliseconds)
 */
export function shiftAllCues<
  T extends { startMs: number; endMs: number; words?: any[]; id?: string; text?: string },
>(cues: T[], deltaMs: number, maxDurationMs?: number): T[] {
  if (!cues || cues.length === 0 || deltaMs === 0) return cues ? [...cues] : [];

  return cues.map((cue) => {
    const s = Math.max(0, Math.round(cue.startMs + deltaMs));
    const dur = Math.max(100, cue.endMs - cue.startMs);
    let e = s + dur;
    if (maxDurationMs && maxDurationMs > 0) {
      e = Math.min(maxDurationMs, e);
    }

    const words = (cue.words || []).map((w: any) => {
      const ws = Math.max(0, Math.round((w.s ?? w.startMs ?? cue.startMs) + deltaMs));
      const we = Math.max(ws + 40, Math.round((w.e ?? w.endMs ?? cue.endMs) + deltaMs));
      return {
        ...w,
        s: ws,
        e: we,
        startMs: ws,
        endMs: we,
      };
    });

    return {
      ...cue,
      startMs: s,
      endMs: e,
      words,
    };
  });
}

/**
 * Snaps a target cue to the playhead position and optionally shifts all subsequent cues by the same delta
 */
export function syncCueToPlayhead<
  T extends { startMs: number; endMs: number; words?: any[]; id?: string; text?: string },
>(cues: T[], targetIdx: number, playheadMs: number, shiftFollowing: boolean = false): T[] {
  if (!cues || targetIdx < 0 || targetIdx >= cues.length) return cues;

  const target = cues[targetIdx];
  const deltaMs = Math.round(playheadMs) - target.startMs;

  return cues.map((c, i) => {
    if (i < targetIdx) return c;
    if (!shiftFollowing && i > targetIdx) return c;

    const s = Math.max(0, Math.round(c.startMs + deltaMs));
    const dur = Math.max(100, c.endMs - c.startMs);
    const e = s + dur;

    const words = (c.words || []).map((w: any) => {
      const ws = Math.max(0, Math.round((w.s ?? w.startMs ?? c.startMs) + deltaMs));
      const we = Math.max(ws + 40, Math.round((w.e ?? w.endMs ?? c.endMs) + deltaMs));
      return {
        ...w,
        s: ws,
        e: we,
        startMs: ws,
        endMs: we,
      };
    });

    return {
      ...c,
      startMs: s,
      endMs: e,
      words,
    };
  });
}

/**
 * Derives audible physical speech intervals from detected silence regions
 */
export function computeSpeechIntervals(
  totalDurationMs: number,
  silences: Array<{ startMs: number; endMs: number }> = []
): Array<{ startMs: number; endMs: number }> {
  const speechSegments: Array<{ startMs: number; endMs: number }> = [];
  let curTime = 0;
  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs);

  for (const sil of sorted) {
    if (sil.startMs > curTime + 300) {
      speechSegments.push({ startMs: curTime, endMs: sil.startMs });
    }
    curTime = Math.max(curTime, sil.endMs);
  }

  if (curTime < totalDurationMs - 300) {
    speechSegments.push({ startMs: curTime, endMs: totalDurationMs });
  }

  if (speechSegments.length === 0 && totalDurationMs > 500) {
    speechSegments.push({ startMs: 0, endMs: totalDurationMs });
  }

  return speechSegments;
}

/**
 * Acoustically snaps cues to physical speech segments detected from the waveform
 */
export function alignCuesToSpeechIntervals<
  T extends { startMs: number; endMs: number; words?: any[]; id?: string; text?: string },
>(cues: T[], speechSegments: Array<{ startMs: number; endMs: number }>): T[] {
  if (!cues || cues.length === 0 || !speechSegments || speechSegments.length === 0) {
    return cues || [];
  }

  const sortedSegs = [...speechSegments].sort((a, b) => a.startMs - b.startMs);

  const aligned = cues.map((cue, idx) => {
    const cueStart = Number(cue.startMs) || 0;
    const cueEnd = Number(cue.endMs) || cueStart + 1000;
    const cueText = String(
      cue.text ||
      (cue.words || []).map((w: any) => w.w || w.word || '').join(' ') ||
      ''
    ).trim();

    let targetStart = cueStart;
    let targetEnd = cueEnd;

    // Find overlapping speech segments
    const overlappingSegs = sortedSegs.filter(
      (seg) =>
        (cueStart >= seg.startMs && cueStart < seg.endMs) ||
        (cueEnd > seg.startMs && cueEnd <= seg.endMs) ||
        (cueStart <= seg.startMs && cueEnd >= seg.endMs)
    );

    if (overlappingSegs.length > 0) {
      const firstSeg = overlappingSegs[0];
      const lastSeg = overlappingSegs[overlappingSegs.length - 1];

      // If cue starts before speech segment starts (e.g. in leading silence), snap forward to speech start
      if (cueStart < firstSeg.startMs) {
        targetStart = firstSeg.startMs;
      }
      // If cue ends after speech segment ends (e.g. in trailing silence), snap back to speech end
      if (cueEnd > lastSeg.endMs) {
        targetEnd = lastSeg.endMs;
      }
    } else {
      // Cue was placed entirely in silence; snap to nearest speech segment if within 2000ms
      let closestSeg = sortedSegs[0];
      let minDistance = Infinity;
      for (const seg of sortedSegs) {
        const dist = Math.min(Math.abs(seg.startMs - cueStart), Math.abs(seg.endMs - cueEnd));
        if (dist < minDistance) {
          minDistance = dist;
          closestSeg = seg;
        }
      }
      if (minDistance <= 2000) {
        if (cueStart < closestSeg.startMs) {
          targetStart = closestSeg.startMs;
          targetEnd = Math.min(closestSeg.endMs, targetStart + (cueEnd - cueStart));
        } else if (cueEnd > closestSeg.endMs) {
          targetEnd = closestSeg.endMs;
          targetStart = Math.max(closestSeg.startMs, targetEnd - (cueEnd - cueStart));
        }
      }
    }

    if (targetEnd <= targetStart) {
      targetEnd = targetStart + Math.max(200, cueEnd - cueStart);
    }

    const oldDur = Math.max(100, cueEnd - cueStart);
    const newDur = Math.max(100, targetEnd - targetStart);

    const words = (cue.words || []).map((w: any) => {
      const wS = w.s ?? w.startMs ?? cueStart;
      const wE = w.e ?? w.endMs ?? cueEnd;
      const relS = Math.max(0, Math.min(1, (wS - cueStart) / oldDur));
      const relE = Math.max(relS + 0.05, Math.min(1, (wE - cueStart) / oldDur));
      const s = Math.round(targetStart + relS * newDur);
      const e = Math.min(targetEnd, Math.max(s + 40, Math.round(targetStart + relE * newDur)));
      return {
        ...w,
        s,
        e,
        startMs: s,
        endMs: e,
      };
    });

    return {
      ...cue,
      id: cue.id || `cue_${idx + 1}`,
      startMs: targetStart,
      endMs: Math.max(targetStart + 100, targetEnd),
      text: cueText || words.map((w: any) => w.word || w.w).join(' '),
      words,
    };
  });

  return resolveCueOverlaps(aligned, 30);
}
