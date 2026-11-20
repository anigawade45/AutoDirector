import { describe, it, expect } from 'vitest';
import {
  computeNaturalWordTimings,
  nudgeWordTiming,
  detectCueOverlaps,
  resolveCueOverlaps,
  shiftAllCues,
  syncCueToPlayhead,
  computeSpeechIntervals,
  alignCuesToSpeechIntervals,
  parseTimestampToMs,
  detectIfSeconds,
  normalizeCuesTimebase,
  distributeCuesAcrossSpeech,
} from '../utils/subtitleTiming';

describe('Subtitle Word Timing and Speech Cadence Engine', () => {
  it('weights multi-syllable words and punctuation pauses naturally over short words', () => {
    const tokens = ['Hello,', 'my', 'name', 'is', 'Aniket', 'Lakshman', 'Gawade.'];
    const startMs = 0;
    const endMs = 3000;

    const words = computeNaturalWordTimings(tokens, startMs, endMs);

    expect(words).toHaveLength(7);
    expect(words[0].word).toBe('Hello,');
    expect(words[6].word).toBe('Gawade.');

    // Long multi-syllable word 'Lakshman' should have significantly longer duration than 2-letter 'is'
    const isDuration = words[3].endMs - words[3].startMs;
    const lakshmanDuration = words[5].endMs - words[5].startMs;

    expect(lakshmanDuration).toBeGreaterThan(isDuration);
    // Sequence must be monotonically increasing and strictly contained in [0, 3000]
    expect(words[0].startMs).toBe(0);
    expect(words[6].endMs).toBe(3000);
    for (let i = 0; i < words.length - 1; i++) {
      expect(words[i].startMs).toBeLessThan(words[i].endMs);
      expect(words[i].endMs).toBeLessThanOrEqual(words[i + 1].startMs);
    }
  });

  it('proportionally shifts and preserves existing acoustic word timings when cue timing moves', () => {
    const tokens = ['Hello', 'World'];
    const existingWords = [
      { word: 'Hello', startMs: 1000, endMs: 1800 },
      { word: 'World', startMs: 1800, endMs: 2000 },
    ];

    // Cue moved from [1000, 2000] to [2000, 4000] (doubled duration and shifted by 1000ms)
    const shifted = computeNaturalWordTimings(tokens, 2000, 4000, existingWords);

    expect(shifted).toHaveLength(2);
    expect(shifted[0].startMs).toBe(2000);
    expect(shifted[1].endMs).toBe(4000);
    // Relative proportion (0.8 vs 0.2) should be preserved:
    // Hello should end around 2000 + 0.8 * 2000 = 3600
    expect(shifted[0].endMs).toBeCloseTo(3600, -1);
    expect(shifted[1].startMs).toBeCloseTo(3600, -1);
  });

  it('nudges word timing earlier or later without breaking sequence order', () => {
    const words = [
      { word: 'First', startMs: 0, endMs: 500 },
      { word: 'Second', startMs: 500, endMs: 1000 },
    ];

    // Nudge second word earlier by 100ms
    const nudged = nudgeWordTiming(words, 1, -100, 0, 1000);

    expect(nudged[1].startMs).toBe(400);
    expect(nudged[0].endMs).toBe(400); // Previous word end adjusted to prevent overlap
  });

  it('detects and cleanly resolves cue timing overlaps (user bug reproduction)', () => {
    // User's exact case from screenshot:
    // Cue 0: 46.1s - 62.0s (46100 - 62000 ms)
    // Cue 1: 59.8s - 65.5s (59800 - 65500 ms)
    const overlappingCues = [
      {
        id: 'cue_1',
        startMs: 46100,
        endMs: 62000,
        text: 'So here I running the automation against the configuration URL, the...',
        words: [
          { word: 'So', startMs: 46100, endMs: 46600 },
          { word: 'the...', startMs: 61500, endMs: 62000 },
        ],
      },
      {
        id: 'cue_2',
        startMs: 59800,
        endMs: 65500,
        text: 'After interacting with the field, it verify that an expected value has...',
        words: [
          { word: 'After', startMs: 59800, endMs: 60500 },
          { word: 'has...', startMs: 65000, endMs: 65500 },
        ],
      },
    ];

    const detected = detectCueOverlaps(overlappingCues);
    expect(detected).toHaveLength(1);
    expect(detected[0].index).toBe(0);
    expect(detected[0].overlapMs).toBe(62000 - 59800); // 2200 ms overlap

    const resolved = resolveCueOverlaps(overlappingCues, 30);
    expect(resolved).toHaveLength(2);
    // Cue 0 end must now be strictly before Cue 1 start
    expect(resolved[0].endMs).toBeLessThanOrEqual(resolved[1].startMs);
    expect(resolved[0].endMs).toBeLessThanOrEqual(59770);
    // Words in Cue 0 must also not exceed resolved[0].endMs
    expect(resolved[0].words[1].endMs).toBeLessThanOrEqual(resolved[0].endMs);

    // No remaining overlaps
    const remaining = detectCueOverlaps(resolved);
    expect(remaining).toHaveLength(0);
  });

  it('shifts all cues uniformly to compensate for audio container offset', () => {
    const cues = [
      {
        id: 'c1',
        startMs: 1000,
        endMs: 3000,
        text: 'One',
        words: [{ word: 'One', startMs: 1000, endMs: 3000 }],
      },
      {
        id: 'c2',
        startMs: 3500,
        endMs: 5000,
        text: 'Two',
        words: [{ word: 'Two', startMs: 3500, endMs: 5000 }],
      },
    ];

    const shiftedLater = shiftAllCues(cues, 500);
    expect(shiftedLater[0].startMs).toBe(1500);
    expect(shiftedLater[0].endMs).toBe(3500);
    expect(shiftedLater[0].words[0].startMs).toBe(1500);
    expect(shiftedLater[1].startMs).toBe(4000);

    const shiftedEarlier = shiftAllCues(cues, -500);
    expect(shiftedEarlier[0].startMs).toBe(500);
    expect(shiftedEarlier[0].endMs).toBe(2500);
    expect(shiftedEarlier[1].startMs).toBe(3000);
  });

  it('snaps cue to playhead with optional cascading shift', () => {
    const cues = [
      { id: 'c1', startMs: 1000, endMs: 3000, text: 'One', words: [] },
      { id: 'c2', startMs: 4000, endMs: 6000, text: 'Two', words: [] },
      { id: 'c3', startMs: 7000, endMs: 9000, text: 'Three', words: [] },
    ];

    // Snap cue 2 to playhead at 4500ms and shift following
    const synced = syncCueToPlayhead(cues, 1, 4500, true);
    expect(synced[0].startMs).toBe(1000); // Prior cue unchanged
    expect(synced[1].startMs).toBe(4500); // Target cue shifted +500ms
    expect(synced[1].endMs).toBe(6500);
    expect(synced[2].startMs).toBe(7500); // Following cue shifted +500ms
  });

  it('acoustically snaps drifted cues to physical speech intervals', () => {
    // Physical speech intervals from FFmpeg waveform silence detection
    const speechSegments = [
      { startMs: 2000, endMs: 5500 }, // Physical voice segment 1
      { startMs: 7000, endMs: 12000 }, // Physical voice segment 2
    ];

    // Cues with AI hallucinated timestamps (e.g. starting in silence at 1200ms and ending late)
    const driftedCues = [
      {
        id: 'c1',
        startMs: 1200,
        endMs: 6200,
        text: 'Hello voice',
        words: [
          { word: 'Hello', startMs: 1200, endMs: 3000 },
          { word: 'voice', startMs: 3000, endMs: 6200 },
        ],
      },
      {
        id: 'c2',
        startMs: 6500,
        endMs: 13000,
        text: 'Second line',
        words: [
          { word: 'Second', startMs: 6500, endMs: 9000 },
          { word: 'line', startMs: 9000, endMs: 13000 },
        ],
      },
    ];

    const aligned = alignCuesToSpeechIntervals(driftedCues, speechSegments);

    // Cue 1 must snap forward out of silence to 2000ms
    expect(aligned[0].startMs).toBe(2000);
    expect(aligned[0].endMs).toBe(5500);
    // Words must be inside [2000, 5500]
    expect(aligned[0].words[0].startMs).toBe(2000);
    expect(aligned[0].words[1].endMs).toBeLessThanOrEqual(5500);

    // Cue 2 must snap to segment 2 [7000, 12000]
    expect(aligned[1].startMs).toBe(7000);
    expect(aligned[1].endMs).toBe(12000);
  });

  it('detects second timestamps and normalizes them into milliseconds', () => {
    // Raw AI output with second timestamps
    const rawCues = [
      {
        id: 'cue_1',
        startMs: 0.0,
        endMs: 4.2,
        text: 'Hello, my name is Aniket Laxman Gawde.',
        words: [
          { word: 'Hello,', startMs: 0.0, endMs: 0.8 },
          { word: 'Aniket', startMs: 1.5, endMs: 2.5 },
          { word: 'Gawde.', startMs: 2.6, endMs: 4.2 },
        ],
      },
      {
        id: 'cue_2',
        startMs: 4.5,
        endMs: 9.1,
        text: 'As part of this internship assignment, I was given to automation task.',
        words: [
          { word: 'As', startMs: 4.5, endMs: 5.0 },
          { word: 'task.', startMs: 8.5, endMs: 9.1 },
        ],
      },
    ];

    expect(detectIfSeconds(rawCues, 263000)).toBe(true);

    const normalized = normalizeCuesTimebase(rawCues, 263000);
    expect(normalized[0].startMs).toBe(0);
    expect(normalized[0].endMs).toBe(4200);
    expect(normalized[0].words[0].startMs).toBe(0);
    expect(normalized[0].words[0].endMs).toBe(800);
    expect(normalized[0].words[2].endMs).toBe(4200);

    expect(normalized[1].startMs).toBe(4500);
    expect(normalized[1].endMs).toBe(9100);
  });

  it('distributes collapsed 0-16s cues across speech intervals of a 4-minute video', () => {
    // 32 collapsed cues like in Screenshot 3: 0:00.0 - 0:00.4, 0:00.5 - 0:00.9, etc.
    const collapsedCues = Array.from({ length: 32 }, (_, i) => ({
      id: `cue_${i + 1}`,
      startMs: i * 500,
      endMs: i * 500 + 400,
      text: `Dialogue sentence ${i + 1} with several words for speech pacing`,
    }));

    // Speech intervals spanning a 4m 23s (263,000ms) video
    const speechSegments = [
      { startMs: 1000, endMs: 45000 },
      { startMs: 50000, endMs: 120000 },
      { startMs: 125000, endMs: 200000 },
      { startMs: 205000, endMs: 260000 },
    ];

    const distributed = distributeCuesAcrossSpeech(collapsedCues, speechSegments, 263000);

    expect(distributed).toHaveLength(32);
    // First cue starts in speech segment 1
    expect(distributed[0].startMs).toBeGreaterThanOrEqual(1000);
    // Last cue must be near the end of video speech, not stuck at 16 seconds!
    expect(distributed[31].endMs).toBeGreaterThan(200000);
    expect(distributed[31].endMs).toBeLessThanOrEqual(263000);

    // Overlaps must be completely resolved
    const overlaps = detectCueOverlaps(distributed);
    expect(overlaps).toHaveLength(0);
  });

  it('prevents cue timings from exceeding video duration', () => {
    const videoDurationMs = 263000; // 4 minutes 23 seconds
    const dilatedCues = [
      { id: 'c1', startMs: 369300, endMs: 383300, text: 'Exceeding video text' },
    ];

    const resolved = resolveCueOverlaps(dilatedCues, 30, videoDurationMs);
    expect(resolved[0].endMs).toBeLessThanOrEqual(videoDurationMs);
    expect(resolved[0].startMs).toBeLessThan(videoDurationMs);
  });
});
