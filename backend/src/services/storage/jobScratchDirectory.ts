import fs from 'fs';
import path from 'path';
import { env } from '../../config/env.js';

export class JobScratchDirectory {
  public readonly jobId: string;
  public readonly dirPath: string;

  constructor(jobId: string) {
    this.jobId = jobId.replace(/^job_/, '');
    const baseDir = path.resolve(env.TEMP_MEDIA_DIR);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    this.dirPath = path.join(baseDir, `job-${this.jobId}`);
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }
  }

  /**
   * Resolves a relative filename inside the isolated scratch directory,
   * enforcing strict path containment to prevent directory traversal attacks.
   */
  resolve(filename: string): string {
    const resolved = path.resolve(this.dirPath, filename);
    if (!resolved.startsWith(this.dirPath)) {
      throw new Error(`Path traversal violation: ${filename} resolves outside scratch directory`);
    }
    return resolved;
  }

  // Pre-configured paths for media pipelines
  get sourceVideo(): string {
    return this.resolve('source.mp4');
  }

  get proxyVideo(): string {
    return this.resolve('proxy_480p.mp4');
  }

  get audioWav(): string {
    return this.resolve('audio_16k.wav');
  }

  get assSubtitles(): string {
    return this.resolve('subtitles.ass');
  }

  outputVideo(profile: string = 'preview_480p'): string {
    return this.resolve(`out_${profile}.mp4`);
  }

  /**
   * Guaranteed cleanup: removes the entire isolated per-job directory and all its contents.
   * On Windows, applies retries with backoff if a process briefly holds a file descriptor.
   */
  cleanup(maxRetries: number = 3, retryDelayMs: number = 200): void {
    if (!fs.existsSync(this.dirPath)) {
      return;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.rmSync(this.dirPath, { recursive: true, force: true });
        return;
      } catch (err: any) {
        if (attempt === maxRetries) {
          console.warn(
            `[JobScratchDirectory] Could not fully remove ${this.dirPath}:`,
            err.message
          );
        } else {
          // Synchronous spin-wait before retry
          const start = Date.now();
          while (Date.now() - start < retryDelayMs) {}
        }
      }
    }
  }

  /**
   * Higher-order execution wrapper that guarantees cleanup in a finally block.
   */
  static async withScratch<T>(
    jobId: string,
    action: (scratch: JobScratchDirectory) => Promise<T>
  ): Promise<T> {
    const scratch = new JobScratchDirectory(jobId);
    try {
      return await action(scratch);
    } finally {
      scratch.cleanup();
    }
  }

  /**
   * Periodic maintenance sweep: cleans up any stale `job-*` temporary folders
   * older than the specified age (default 2 hours) created by crashed processes.
   */
  static cleanupStaleDirectories(maxAgeMs: number = 2 * 60 * 60 * 1000): number {
    const baseDir = path.resolve(env.TEMP_MEDIA_DIR);
    if (!fs.existsSync(baseDir)) {
      return 0;
    }

    let purgedCount = 0;
    const now = Date.now();

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('job-')) {
          const fullPath = path.join(baseDir, entry.name);
          try {
            const stats = fs.statSync(fullPath);
            if (now - stats.mtimeMs > maxAgeMs) {
              fs.rmSync(fullPath, { recursive: true, force: true });
              purgedCount++;
              console.log(
                `[JobScratchDirectory] Purged stale job scratch directory: ${entry.name}`
              );
            }
          } catch {
            // Ignore individual stat errors
          }
        }
      }
    } catch (err: any) {
      console.warn('[JobScratchDirectory] Error scanning stale temp directories:', err.message);
    }

    return purgedCount;
  }
}
