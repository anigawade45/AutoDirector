export interface ParsedProgress {
  percent: number;
  outTimeMs: number;
  speed?: number;
  fps?: number;
  frame?: number;
}

export class FFmpegProgressParser {
  /**
   * Parses FFmpeg -progress pipe:1 key-value chunks and calculates completion percentage.
   */
  static parse(chunk: string, totalDurationMs: number): ParsedProgress | null {
    if (!chunk || !chunk.includes('out_time')) {
      return null;
    }

    let outTimeMs = 0;

    // FFmpeg -progress emits out_time_us or out_time_ms or out_time=HH:MM:SS.microseconds
    const usMatch = chunk.match(/out_time_us=(\d+)/);
    const msMatch = chunk.match(/out_time_ms=(\d+)/);
    const formattedMatch = chunk.match(/out_time=(\d+):(\d+):([\d.]+)/);

    if (usMatch) {
      outTimeMs = Math.round(parseInt(usMatch[1], 10) / 1000);
    } else if (msMatch) {
      const raw = parseInt(msMatch[1], 10);
      outTimeMs = raw > totalDurationMs * 10 ? Math.round(raw / 1000) : raw;
    } else if (formattedMatch) {
      const hours = parseInt(formattedMatch[1], 10);
      const minutes = parseInt(formattedMatch[2], 10);
      const seconds = parseFloat(formattedMatch[3]);
      outTimeMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
    } else {
      return null;
    }

    const duration = Math.max(1000, totalDurationMs);
    const progressRatio = Math.min(1.0, Math.max(0.0, outTimeMs / duration));

    // Progress percentage scales from 20% (render start) to 92% (render finish, prior to S3 upload)
    const percent = Math.min(92, Math.max(20, Math.round(20 + progressRatio * 72)));

    let speed: number | undefined;
    const speedMatch = chunk.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) {
      speed = parseFloat(speedMatch[1]);
    }

    let fps: number | undefined;
    const fpsMatch = chunk.match(/fps=\s*([\d.]+)/);
    if (fpsMatch) {
      fps = parseFloat(fpsMatch[1]);
    }

    let frame: number | undefined;
    const frameMatch = chunk.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      frame = parseInt(frameMatch[1], 10);
    }

    return {
      percent,
      outTimeMs,
      speed,
      fps,
      frame,
    };
  }
}
