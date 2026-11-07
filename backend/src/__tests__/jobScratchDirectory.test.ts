import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobScratchDirectory } from '../services/storage/jobScratchDirectory.js';
import fs from 'fs';
import path from 'path';

describe('Phase 3 Task 3: Isolated Per-Job Temporary Directories & Guaranteed Cleanup', () => {
  const testJobId = 'test_job_12345';
  let scratch: JobScratchDirectory;

  afterEach(() => {
    if (scratch && fs.existsSync(scratch.dirPath)) {
      scratch.cleanup();
    }
  });

  it('creates an isolated directory named job-{jobId}', () => {
    scratch = new JobScratchDirectory(testJobId);
    expect(fs.existsSync(scratch.dirPath)).toBe(true);
    expect(scratch.dirPath).toContain(`job-${testJobId}`);
  });

  it('resolves standard media paths inside the isolated sandbox', () => {
    scratch = new JobScratchDirectory(testJobId);
    expect(scratch.sourceVideo).toBe(path.join(scratch.dirPath, 'source.mp4'));
    expect(scratch.proxyVideo).toBe(path.join(scratch.dirPath, 'proxy_480p.mp4'));
    expect(scratch.audioWav).toBe(path.join(scratch.dirPath, 'audio_16k.wav'));
    expect(scratch.assSubtitles).toBe(path.join(scratch.dirPath, 'subtitles.ass'));
    expect(scratch.outputVideo('final_1080p')).toBe(
      path.join(scratch.dirPath, 'out_final_1080p.mp4')
    );
  });

  it('prevents directory traversal attacks when resolving paths', () => {
    scratch = new JobScratchDirectory(testJobId);
    expect(() => scratch.resolve('../../etc/passwd')).toThrow('Path traversal violation');
    expect(() => scratch.resolve('../secret.env')).toThrow('Path traversal violation');
  });

  it('completely cleans up the isolated directory and all contents', () => {
    scratch = new JobScratchDirectory(testJobId);
    const tempFile1 = path.join(scratch.dirPath, 'test1.txt');
    const tempFile2 = path.join(scratch.dirPath, 'test2.mp4');

    fs.writeFileSync(tempFile1, 'temporary data');
    fs.writeFileSync(tempFile2, 'dummy video bytes');

    expect(fs.existsSync(tempFile1)).toBe(true);
    expect(fs.existsSync(tempFile2)).toBe(true);

    scratch.cleanup();

    expect(fs.existsSync(scratch.dirPath)).toBe(false);
    expect(fs.existsSync(tempFile1)).toBe(false);
    expect(fs.existsSync(tempFile2)).toBe(false);
  });

  it('withScratch higher-order wrapper guarantees cleanup even on thrown error', async () => {
    let capturedPath = '';

    await expect(
      JobScratchDirectory.withScratch('error_job_999', async (dir) => {
        capturedPath = dir.dirPath;
        expect(fs.existsSync(capturedPath)).toBe(true);
        fs.writeFileSync(dir.resolve('error_dump.log'), 'fatal crash');
        throw new Error('Simulated processing failure');
      })
    ).rejects.toThrow('Simulated processing failure');

    // Scratch directory must be cleaned up despite the failure
    expect(fs.existsSync(capturedPath)).toBe(false);
  });

  it('sweeps and purges stale scratch directories older than maxAgeMs', () => {
    const staleJobId = 'stale_job_ancient';
    const staleDir = new JobScratchDirectory(staleJobId);
    const staleFilePath = staleDir.resolve('old.tmp');
    fs.writeFileSync(staleFilePath, 'old data');

    // Artificially modify mtime to 3 hours ago
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(staleDir.dirPath, threeHoursAgo, threeHoursAgo);

    const purged = JobScratchDirectory.cleanupStaleDirectories(1 * 60 * 60 * 1000);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(staleDir.dirPath)).toBe(false);
  });
});
