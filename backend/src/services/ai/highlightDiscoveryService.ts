import {
  CaptionCue,
  SilenceRange,
  SceneCut,
  HighlightSegment,
  ChapterSegment,
  HookSegment,
} from '@ai-video/shared';

export interface DiscoveryInput {
  cues: CaptionCue[];
  silences: SilenceRange[];
  sceneCuts: SceneCut[];
  durationMs: number;
  bpm?: number;
}

export interface DiscoveryResult {
  hook: HookSegment;
  chapters: ChapterSegment[];
  highlights: HighlightSegment[];
}

export class HighlightDiscoveryService {
  /**
   * Discover viral hook, semantic chapters, and top highlight segments from multimodal indexing data.
   */
  static discover(input: DiscoveryInput): DiscoveryResult {
    const { cues = [], silences = [], sceneCuts = [], durationMs = 60000 } = input;

    const hook = this.discoverHook(cues, durationMs);
    const chapters = this.discoverChapters(cues, silences, sceneCuts, durationMs);
    const highlights = this.discoverHighlights(cues, silences, sceneCuts, durationMs);

    return {
      hook,
      chapters,
      highlights,
    };
  }

  /**
   * Discovers the best opening viral hook (3s-6s) with high speech energy or curiosity gap.
   */
  private static discoverHook(cues: CaptionCue[], durationMs: number): HookSegment {
    if (cues.length === 0) {
      return {
        startMs: 0,
        endMs: Math.min(5000, durationMs),
        score: 0.85,
        reason: 'Opening introduction hook (default)',
      };
    }

    // Look at opening cues within the first 30 seconds
    const earlyCues = cues.filter((c) => c.startMs < 30000);
    const candidates = earlyCues.length > 0 ? earlyCues : cues.slice(0, 3);

    let bestCue = candidates[0];
    let bestScore = 0.8;
    let bestReason = 'Opening introduction hook';

    const hookWordsRegex = /\b(why|how|what|did you know|secret|stop|never|always|best|crazy|shocking|imagine|truth)\b/i;

    for (const cue of candidates) {
      const durSec = Math.max(0.5, (cue.endMs - cue.startMs) / 1000);
      const wordCount = (cue.text || '').trim().split(/\s+/).filter(Boolean).length;
      const wps = wordCount / durSec;

      let score = 0.82;
      let reason = 'High-cadence opening delivery';

      if (cue.text.includes('?') || hookWordsRegex.test(cue.text)) {
        score += 0.12;
        reason = 'Curiosity-inducing question or hook keyword';
      }

      if (wps > 2.5) {
        score += 0.05;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCue = cue;
        bestReason = reason;
      }
    }

    const startMs = Math.max(0, bestCue.startMs);
    // Ensure hook is between 3.5s and 6.0s
    let endMs = Math.max(bestCue.endMs, startMs + 3500);
    endMs = Math.min(endMs, startMs + 6000, durationMs);

    return {
      startMs,
      endMs,
      score: Number(Math.min(0.99, bestScore).toFixed(2)),
      reason: bestReason,
    };
  }

  /**
   * Clusters cues and scene cuts into semantic video chapters.
   */
  private static discoverChapters(
    cues: CaptionCue[],
    silences: SilenceRange[],
    sceneCuts: SceneCut[],
    durationMs: number
  ): ChapterSegment[] {
    if (durationMs < 15000 || cues.length === 0) {
      return [
        {
          id: 'ch_1',
          startMs: 0,
          endMs: durationMs,
          title: 'Full Video Overview',
          summary: cues[0]?.text?.slice(0, 60) || 'Complete video sequence',
        },
      ];
    }

    // Identify candidate split points (major pauses > 1.2s or prominent scene cuts)
    const longPauses = silences
      .filter((s) => s.endMs - s.startMs >= 1000 && s.startMs > 5000 && s.endMs < durationMs - 5000)
      .map((s) => (s.startMs + s.endMs) / 2);

    const majorCuts = sceneCuts
      .filter((c) => c.score >= 0.5 && c.tMs > 5000 && c.tMs < durationMs - 5000)
      .map((c) => c.tMs);

    // Merge split points and sort
    const rawSplits = Array.from(new Set([...longPauses, ...majorCuts])).sort((a, b) => a - b);

    // Filter splits so chapters are at least 10s apart
    const selectedSplits: number[] = [];
    let lastSplit = 0;
    for (const split of rawSplits) {
      if (split - lastSplit >= 10000 && durationMs - split >= 8000) {
        selectedSplits.push(split);
        lastSplit = split;
      }
      if (selectedSplits.length >= 4) break; // Max 5 chapters total
    }

    // Build chapter boundaries: [0, ...splits, durationMs]
    const boundaries = [0, ...selectedSplits, durationMs];
    const chapters: ChapterSegment[] = [];

    for (let i = 0; i < boundaries.length - 1; i++) {
      const cStart = Math.round(boundaries[i]);
      const cEnd = Math.round(boundaries[i + 1]);

      // Collect cues within this chapter
      const chapterCues = cues.filter(
        (c) => (c.startMs >= cStart && c.startMs < cEnd) || (c.endMs > cStart && c.endMs <= cEnd)
      );

      const combinedText = chapterCues.map((c) => c.text).join(' ').trim();
      let title = `Chapter ${i + 1}`;

      if (i === 0) {
        title = 'Introduction & Hook';
      } else if (i === boundaries.length - 2) {
        title = 'Summary & Wrap-up';
      } else if (combinedText.length > 0) {
        // Generate title from most prominent words
        const words = combinedText
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 4 && !['about', 'there', 'which', 'their', 'would', 'could'].includes(w.toLowerCase()));
        if (words.length > 0) {
          title = words.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } else {
          title = `Discussion Part ${i + 1}`;
        }
      }

      chapters.push({
        id: `ch_${i + 1}`,
        startMs: cStart,
        endMs: cEnd,
        title,
        summary: combinedText.slice(0, 80) || `Section spanning ${Math.round(cStart / 1000)}s - ${Math.round(cEnd / 1000)}s`,
      });
    }

    return chapters;
  }

  /**
   * Discovers top 3-5 highlight segments across the timeline (15s-60s) with scores.
   */
  private static discoverHighlights(
    cues: CaptionCue[],
    silences: SilenceRange[],
    sceneCuts: SceneCut[],
    durationMs: number
  ): HighlightSegment[] {
    const highlights: HighlightSegment[] = [];

    if (durationMs <= 30000 || cues.length <= 2) {
      return [
        {
          id: 'hl_1',
          startMs: 0,
          endMs: Math.min(durationMs, 25000),
          score: 0.94,
          reason: 'Core primary highlight segment',
        },
      ];
    }

    // Windows of ~20s-45s across the video
    const windowDurMs = Math.min(30000, durationMs);
    const stepMs = Math.max(10000, Math.floor(windowDurMs / 2));

    let windowId = 1;
    for (let wStart = 0; wStart + 15000 <= durationMs; wStart += stepMs) {
      const wEnd = Math.min(durationMs, wStart + windowDurMs);

      // Cues in this window
      const windowCues = cues.filter((c) => c.startMs >= wStart && c.endMs <= wEnd);
      if (windowCues.length === 0) continue;

      const fullText = windowCues.map((c) => c.text).join(' ');
      const wordCount = fullText.split(/\s+/).filter(Boolean).length;
      const speechSec = (wEnd - wStart) / 1000;
      const wps = wordCount / Math.max(1, speechSec);

      // Silences in this window
      const windowSilences = silences.filter((s) => s.startMs >= wStart && s.endMs <= wEnd);
      const totalSilenceMs = windowSilences.reduce((acc, s) => acc + (s.endMs - s.startMs), 0);
      const silenceRatio = totalSilenceMs / (wEnd - wStart);

      // Scene cuts in this window
      const cutsInWindow = sceneCuts.filter((c) => c.tMs >= wStart && c.tMs <= wEnd).length;

      // Calculate composite score (0.75 - 0.98)
      let score = 0.8;
      let reason = 'Key informational dialogue moment';

      if (wps > 2.2) {
        score += 0.08;
        reason = 'High speech density and fast information delivery';
      }
      if (silenceRatio < 0.15) {
        score += 0.05;
      }
      if (cutsInWindow >= 1) {
        score += 0.04;
      }

      const punchyKeywords = /\b(key|secret|important|future|best|amazing|solution|problem|strategy|result|win)\b/i;
      if (punchyKeywords.test(fullText)) {
        score += 0.05;
        reason = 'High-impact value statement with key takeaways';
      }

      highlights.push({
        id: `hl_${windowId++}`,
        startMs: Math.round(wStart),
        endMs: Math.round(wEnd),
        score: Number(Math.min(0.98, score).toFixed(2)),
        reason,
      });

      if (highlights.length >= 6) break;
    }

    // Sort by score descending and take top 4
    highlights.sort((a, b) => b.score - a.score);
    return highlights.slice(0, 4).sort((a, b) => a.startMs - b.startMs);
  }
}
