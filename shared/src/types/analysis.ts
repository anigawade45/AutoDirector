export interface SilenceRange {
  startMs: number;
  endMs: number;
  avgDb: number;
}

export interface SceneCut {
  tMs: number;
  score: number;
}

export interface BeatGrid {
  bpm: number;
  grid: number[]; // beat timestamps in ms
}

export interface LoudnessMetrics {
  integratedLufs: number;
  truePeakDb: number;
}

export interface HighlightSegment {
  startMs: number;
  endMs: number;
  score: number;
  reason: string;
}

export interface AnalysisResult {
  assetId: string;
  version: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  silences: SilenceRange[];
  sceneCuts: SceneCut[];
  beats: BeatGrid;
  loudness: LoudnessMetrics;
  transcriptRef?: string;
  highlights?: HighlightSegment[];
}

export interface WordTiming {
  w: string; // word
  s: number; // start in ms
  e: number; // end in ms
  conf: number; // confidence 0 to 1
}

export interface CaptionCue {
  id: string; // "cue_1"
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  words: WordTiming[];
}

export interface CaptionSet {
  id: string;
  projectId: string;
  assetId: string;
  language: string; // BCP-47 e.g. "en"
  origin: 'whisper' | 'manual' | 'imported';
  basedOn?: string | null;
  cues: CaptionCue[];
  contentHash: string;
}

export interface CompactAnalysisSummary {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  silences: SilenceRange[];
  sceneCuts: SceneCut[];
  beats: BeatGrid;
  loudness: LoudnessMetrics;
  transcriptExcerpt: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
}
