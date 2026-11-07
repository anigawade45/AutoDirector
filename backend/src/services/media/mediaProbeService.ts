import { spawn } from 'child_process';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  bitrate?: number;
  sizeBytes?: number;
  sampleRate: number;
  channels: number;
  rotation?: number;
}

export interface SilenceInterval {
  startMs: number;
  endMs: number;
  avgDb?: number;
}

export interface SceneCut {
  tMs: number;
  score: number;
}

export interface LoudnessInfo {
  integratedLufs: number;
  truePeakDb: number;
}

export class MediaProbeService {
  /**
   * Runs ffprobe to extract technical container and stream metadata.
   */
  static async probeVideo(filePath: string): Promise<VideoMetadata> {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:stream_tags=rotate',
      '-of',
      'json',
      filePath,
    ];

    const stdout = await this.execProcess(env.FFPROBE_PATH, args);
    const data = JSON.parse(stdout);

    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio') || {};

    if (!videoStream || !videoStream.codec_name) {
      throw new AppError(
        422,
        'INPUT_CORRUPT',
        'Uploaded media does not contain a valid video stream or uses an unsupported video codec'
      );
    }

    if (!data.format || !data.format.duration || parseFloat(data.format.duration) <= 0) {
      throw new AppError(
        422,
        'INPUT_CORRUPT',
        'Uploaded media container is corrupt or has invalid zero duration'
      );
    }

    let durationMs = Math.round(parseFloat(data.format.duration) * 1000);

    // Parse FPS from r_frame_rate e.g. "30/1" or "30000/1001"
    let fps = 30;
    if (videoStream.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den > 0) {
        const rawFps = num / den;
        // Snap to common timeline frame rates
        if (Math.abs(rawFps - 24) < 0.5) fps = 24;
        else if (Math.abs(rawFps - 25) < 0.5) fps = 25;
        else if (Math.abs(rawFps - 60) < 0.5) fps = 60;
        else fps = Math.round(rawFps);
      }
    }

    return {
      durationMs: durationMs || 1000,
      width: videoStream.width || 1920,
      height: videoStream.height || 1080,
      fps: fps || 30,
      videoCodec: videoStream.codec_name || 'h264',
      audioCodec: audioStream.codec_name || undefined,
      sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0,
      channels: audioStream.channels || 0,
      bitrate: data.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : undefined,
      sizeBytes: data.format?.size ? parseInt(data.format.size, 10) : undefined,
      rotation: videoStream.tags?.rotate ? parseInt(videoStream.tags.rotate, 10) : 0,
    };
  }

  /**
   * Generates a fast 480p preview proxy for real-time browser timeline scrubbing.
   */
  static async generateProxy480p(
    inputPath: string,
    outputPath: string,
    hasAudio: boolean = true
  ): Promise<void> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=-2:480',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
    ];

    if (hasAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-an');
    }

    args.push('-movflags', '+faststart', outputPath);

    await this.execProcess(env.FFMPEG_PATH, args);
  }

  /**
   * Extracts a 16kHz mono WAV for Whisper speech transcription and silence analysis.
   */
  static async extractAudioWav(inputPath: string, outputPath: string): Promise<void> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outputPath,
    ];

    await this.execProcess(env.FFMPEG_PATH, args);
  }

  /**
   * Detects silences using FFmpeg silencedetect audio filter with temporal ordering resilience.
   */
  static async detectSilences(
    audioPath: string,
    noiseDb = -30,
    minDurationSec = 0.5
  ): Promise<SilenceInterval[]> {
    const args = [
      '-i',
      audioPath,
      '-af',
      `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      '-f',
      'null',
      '-',
    ];

    try {
      const output = await this.execProcess(env.FFMPEG_PATH, args, true);
      const silences: SilenceInterval[] = [];

      // Sequentially match both silence_start and silence_end to avoid shifted pairs
      const eventRegex = /silence_(start|end):\s*([-\d.]+)/g;
      let currentStart: number | null = null;
      let match;

      while ((match = eventRegex.exec(output)) !== null) {
        const type = match[1];
        const valSec = parseFloat(match[2]);
        const valMs = Math.round(valSec * 1000);

        if (type === 'start') {
          currentStart = valMs;
        } else if (type === 'end') {
          const endMs = valMs;
          const startMs =
            currentStart !== null
              ? currentStart
              : Math.max(0, endMs - Math.round(minDurationSec * 1000));
          silences.push({
            startMs,
            endMs,
            avgDb: noiseDb,
          });
          currentStart = null;
        }
      }

      if (currentStart !== null) {
        silences.push({
          startMs: currentStart,
          endMs: currentStart + Math.round(minDurationSec * 1000),
          avgDb: noiseDb,
        });
      }

      return silences;
    } catch {
      return [];
    }
  }

  /**
   * Detects major visual scene transitions using FFmpeg select filter.
   */
  static async detectSceneCuts(videoPath: string, threshold = 0.3): Promise<SceneCut[]> {
    const args = [
      '-i',
      videoPath,
      '-filter_complex',
      `select='gt(scene,${threshold})',metadata=print`,
      '-f',
      'null',
      '-',
    ];

    try {
      const output = await this.execProcess(env.FFMPEG_PATH, args, true);
      const cuts: SceneCut[] = [];

      const ptsRegex = /pts_time:([-\d.]+)/g;
      const scoreRegex = /lavfi\.scene_score=([-\d.]+)/g;

      const ptsTimes: number[] = [];
      let match;
      while ((match = ptsRegex.exec(output)) !== null) {
        ptsTimes.push(Math.round(parseFloat(match[1]) * 1000));
      }

      const scores: number[] = [];
      while ((match = scoreRegex.exec(output)) !== null) {
        scores.push(parseFloat(match[1]));
      }

      ptsTimes.forEach((tMs, idx) => {
        cuts.push({
          tMs,
          score: scores[idx] !== undefined ? scores[idx] : threshold,
        });
      });

      return cuts;
    } catch {
      return [];
    }
  }

  /**
   * Computes integrated loudness and peak decibels using EBU R128 filter.
   */
  static async detectLoudness(audioPath: string): Promise<LoudnessInfo> {
    const args = ['-i', audioPath, '-af', 'ebur128', '-f', 'null', '-'];

    try {
      const output = await this.execProcess(env.FFMPEG_PATH, args, true);

      let integratedLufs = -16.0;
      let truePeakDb = -1.0;

      const lufsMatch = output.match(/I:\s+([-\d.]+)\s+LUFS/);
      if (lufsMatch) {
        integratedLufs = parseFloat(lufsMatch[1]);
      }

      const peakMatch = output.match(/Peak:\s+([-\d.]+)\s+dBFS/);
      if (peakMatch) {
        truePeakDb = parseFloat(peakMatch[1]);
      }

      return { integratedLufs, truePeakDb };
    } catch {
      return { integratedLufs: -16.0, truePeakDb: -1.0 };
    }
  }

  /**
   * Pure deterministic process execution using child_process.spawn.
   */
  public static execProcess(
    binary: string,
    args: string[],
    captureStderr: boolean = false
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to execute ${binary}: ${err.message}`));
      });

      child.on('close', (code) => {
        if (captureStderr) {
          // Many FFmpeg info filters (like silencedetect, ebur128) log exclusively to stderr
          resolve(stderr || stdout);
        } else if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${binary} exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }
}
