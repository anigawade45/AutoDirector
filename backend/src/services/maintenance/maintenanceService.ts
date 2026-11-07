import { S3Service } from '../storage/s3Service.js';
import { JobScratchDirectory } from '../storage/jobScratchDirectory.js';

export class MaintenanceService {
  private static cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Starts a recurring background scheduler to purge abandoned multipart uploads.
   * Default interval: runs every 6 hours to clean sessions older than 24 hours.
   */
  static startMaintenanceScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.cleanupTimer) return;

    // Run initial sweep 10 seconds after boot
    setTimeout(() => {
      this.runAbandonedUploadCleanup().catch((err) =>
        console.warn('[Maintenance] Initial cleanup sweep notice:', err.message)
      );
    }, 10000);

    this.cleanupTimer = setInterval(() => {
      this.runAbandonedUploadCleanup().catch((err) =>
        console.warn('[Maintenance] Scheduled cleanup sweep notice:', err.message)
      );
    }, intervalMs);

    // Unref so timer does not prevent process exit in CLI scripts or tests
    if (this.cleanupTimer && typeof (this.cleanupTimer as any).unref === 'function') {
      (this.cleanupTimer as any).unref();
    }

    console.log(`[Maintenance] Scheduled recurring abandoned upload cleanup every ${Math.round(intervalMs / 3600000)}h.`);
  }

  static stopMaintenanceScheduler(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Scans the S3 bucket for abandoned multipart uploads older than specified threshold (default 24h),
   * stale scratch directories older than 2h, and preview videos older than 7d.
   */
  static async runAbandonedUploadCleanup(olderThanMs = 24 * 60 * 60 * 1000): Promise<{
    abortedCount: number;
    purgedScratchCount: number;
    stalePreviewsCount: number;
  }> {
    console.log('[Maintenance] Sweeping for stale/abandoned multipart uploads, scratch dirs, and previews...');
    const count = await S3Service.cleanupAbandonedUploads(olderThanMs);
    const purgedScratchCount = JobScratchDirectory.cleanupStaleDirectories(2 * 60 * 60 * 1000);
    const stalePreviewsCount = await S3Service.cleanupStalePreviews(7 * 24 * 60 * 60 * 1000);
    console.log(
      `[Maintenance] Sweep complete: aborted ${count} upload(s), purged ${purgedScratchCount} scratch dir(s), removed ${stalePreviewsCount} stale preview(s).`
    );
    return { abortedCount: count, purgedScratchCount, stalePreviewsCount };
  }
}

