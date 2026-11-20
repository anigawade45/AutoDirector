import { CaptionCue } from '../types/analysis.js';

export interface SceneSegment {
  id: string; // "scene_1"
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  cues: CaptionCue[];
  speakers: string[];
}

export interface SpeakerStats {
  id: string; // e.g. "Speaker 1"
  name: string;
  color: string;
  cuesCount: number;
  wordCount: number;
  totalSpeakingMs: number;
  percentageOfDialogue: number;
  sceneIndices: number[];
}

export interface MediaIndexSummary {
  totalDurationMs: number;
  scenes: SceneSegment[];
  speakers: SpeakerStats[];
  cues: CaptionCue[];
  speakerTurnCount: number;
}

export const SPEAKER_PALETTE: string[] = [
  '#E3B5BE', // Dusty Rose
  '#A3C4BC', // Soft Sage / Teal
  '#F4D06F', // Warm Amber
  '#B8A7E0', // Lavender
  '#89C2D9', // Sky Blue
  '#F7A072', // Coral
  '#B7E4C7', // Mint
  '#E9D8A6', // Champagne
];

export function getSpeakerColor(speakerId: string | null | undefined, index = 0): string {
  if (!speakerId) return '#FFF5F5';
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = (hash << 5) - hash + speakerId.charCodeAt(i);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash + index) % SPEAKER_PALETTE.length;
  return SPEAKER_PALETTE[colorIndex];
}

/**
 * Builds a unified multimodal media index correlating dialogue cues,
 * visual scene intervals, and speaker diarization statistics.
 */
export function buildMediaIndex(
  cues: CaptionCue[] = [],
  sceneCuts: number[] = [],
  totalDurationSec = 60
): MediaIndexSummary {
  const totalDurationMs = Math.max(1000, Math.round(totalDurationSec * 1000));

  // 1. Sort & sanitize cues
  const cleanCues = [...cues].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  // 2. Build continuous scene intervals
  const sortedCutSecs = Array.from(
    new Set(
      sceneCuts
        .filter((s) => typeof s === 'number' && s > 0 && s < totalDurationSec - 0.2)
        .map((s) => Number(s.toFixed(2)))
    )
  ).sort((a, b) => a - b);

  const sceneBoundariesSec = [0, ...sortedCutSecs, totalDurationSec];
  const scenes: SceneSegment[] = [];

  for (let i = 0; i < sceneBoundariesSec.length - 1; i++) {
    const startSec = sceneBoundariesSec[i];
    const endSec = sceneBoundariesSec[i + 1];
    const durationSec = Math.max(0.1, Number((endSec - startSec).toFixed(2)));
    const startMs = Math.round(startSec * 1000);
    const endMs = Math.round(endSec * 1000);

    // Find cues overlapping this scene
    const sceneCues = cleanCues.filter((c) => {
      const cStart = c.startMs ?? 0;
      const cEnd = c.endMs ?? cStart + 100;
      return cStart < endMs && cEnd > startMs;
    });

    // Unique speakers in this scene
    const speakerSet = new Set<string>();
    sceneCues.forEach((c) => {
      const spk = (c.speaker || 'Speaker 1').trim();
      if (spk) speakerSet.add(spk);
    });

    scenes.push({
      id: `scene_${i + 1}`,
      index: i + 1,
      startSec,
      endSec,
      durationSec,
      cues: sceneCues,
      speakers: Array.from(speakerSet),
    });
  }

  // 3. Build speaker statistics & diarization metrics
  const speakerMap = new Map<
    string,
    {
      cuesCount: number;
      wordCount: number;
      totalSpeakingMs: number;
      sceneIndices: Set<number>;
    }
  >();

  let totalDialogueMs = 0;
  let speakerTurnCount = 0;
  let lastSpeaker: string | null = null;

  cleanCues.forEach((cue) => {
    const spk = (cue.speaker || 'Speaker 1').trim();
    const durMs = Math.max(0, (cue.endMs || 0) - (cue.startMs || 0));
    const words = cue.words?.length || (cue.text || '').trim().split(/\s+/).filter(Boolean).length;

    totalDialogueMs += durMs;

    if (lastSpeaker !== null && lastSpeaker !== spk) {
      speakerTurnCount++;
    }
    lastSpeaker = spk;

    if (!speakerMap.has(spk)) {
      speakerMap.set(spk, {
        cuesCount: 0,
        wordCount: 0,
        totalSpeakingMs: 0,
        sceneIndices: new Set(),
      });
    }

    const data = speakerMap.get(spk)!;
    data.cuesCount++;
    data.wordCount += words;
    data.totalSpeakingMs += durMs;

    // Associate speaker with matching scenes
    scenes.forEach((s) => {
      if (s.cues.some((sc) => sc.id === cue.id || sc.startMs === cue.startMs)) {
        data.sceneIndices.add(s.index);
      }
    });
  });

  const speakers: SpeakerStats[] = [];
  let spkIdx = 0;

  speakerMap.forEach((data, spkName) => {
    const pct = totalDialogueMs > 0 ? (data.totalSpeakingMs / totalDialogueMs) * 100 : 0;
    speakers.push({
      id: spkName,
      name: spkName,
      color: getSpeakerColor(spkName, spkIdx++),
      cuesCount: data.cuesCount,
      wordCount: data.wordCount,
      totalSpeakingMs: data.totalSpeakingMs,
      percentageOfDialogue: Number(pct.toFixed(1)),
      sceneIndices: Array.from(data.sceneIndices).sort((a, b) => a - b),
    });
  });

  speakers.sort((a, b) => b.totalSpeakingMs - a.totalSpeakingMs);

  return {
    totalDurationMs,
    scenes,
    speakers,
    cues: cleanCues,
    speakerTurnCount,
  };
}

/**
 * Searches dialogue cues by query string and optional speaker or scene filters.
 */
export function searchMediaIndex(
  index: MediaIndexSummary,
  options: {
    query?: string;
    speakerId?: string;
    sceneIndex?: number;
  } = {}
): CaptionCue[] {
  const { query, speakerId, sceneIndex } = options;
  const qLower = (query || '').trim().toLowerCase();

  return index.cues.filter((cue) => {
    if (speakerId && (cue.speaker || 'Speaker 1') !== speakerId) {
      return false;
    }

    if (sceneIndex !== undefined) {
      const scene = index.scenes.find((s) => s.index === sceneIndex);
      if (scene) {
        const sStart = scene.startSec * 1000;
        const sEnd = scene.endSec * 1000;
        if (cue.startMs >= sEnd || cue.endMs <= sStart) {
          return false;
        }
      }
    }

    if (qLower) {
      const matchesText = (cue.text || '').toLowerCase().includes(qLower);
      const matchesWord = cue.words?.some((w: any) =>
        ((w as any).word || (w as any).w || '').toLowerCase().includes(qLower)
      );
      if (!matchesText && !matchesWord) return false;
    }

    return true;
  });
}

/**
 * Renames all occurrences of a speaker across caption cues.
 */
export function renameSpeakerInCues(
  cues: CaptionCue[],
  oldSpeaker: string,
  newSpeaker: string
): CaptionCue[] {
  const cleanNew = newSpeaker.trim() || 'Speaker 1';
  return cues.map((c) => {
    const current = (c.speaker || 'Speaker 1').trim();
    if (current === oldSpeaker.trim()) {
      return {
        ...c,
        speaker: cleanNew,
      };
    }
    return c;
  });
}

/**
 * Removes empty, whitespace-only, or orphaned punctuation cues from the cue list.
 */
export function cleanEmptyCues(cues: CaptionCue[]): CaptionCue[] {
  return cues.filter((c) => {
    const text = (c.text || '').replace(/["'.,!?;:\s]/g, '').trim();
    return text.length > 0;
  });
}
