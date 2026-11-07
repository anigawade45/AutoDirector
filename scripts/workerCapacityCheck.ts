export interface CapacityProfile {
  profile: 'preview_480p' | 'final_1080p' | 'final_4k';
  avgVideoLengthSec: number;
  renderTimeSecPerWorker: number;
  realtimeRatio: number; // renderTime / videoLength
  jobsPerHourPerWorker: number;
}

export interface ClusterSizing {
  dailyRendersTarget: number;
  peakHourRenders: number; // ~20% of daily renders occur during peak hour
  recommendedAnalysisWorkers: number;
  recommendedRenderWorkers: number;
  totalVcpuRequired: number;
  totalMemoryGbRequired: number;
  expectedMaxQueueWaitSec: number;
}

export class WorkerCapacityService {
  private static profiles: CapacityProfile[] = [
    {
      profile: 'preview_480p',
      avgVideoLengthSec: 60,
      renderTimeSecPerWorker: 12.0,
      realtimeRatio: 0.20,
      jobsPerHourPerWorker: 300,
    },
    {
      profile: 'final_1080p',
      avgVideoLengthSec: 60,
      renderTimeSecPerWorker: 28.0,
      realtimeRatio: 0.46,
      jobsPerHourPerWorker: 128,
    },
    {
      profile: 'final_4k',
      avgVideoLengthSec: 60,
      renderTimeSecPerWorker: 95.0,
      realtimeRatio: 1.58,
      jobsPerHourPerWorker: 37,
    },
  ];

  static getProfiles(): CapacityProfile[] {
    return this.profiles;
  }

  /**
   * Computes recommended worker cluster sizing for target daily throughput.
   */
  static calculateClusterSizing(dailyRendersTarget: number): ClusterSizing {
    // Standard rule: 20% of traffic occurs in peak 60-minute window
    const peakHourRenders = Math.ceil(dailyRendersTarget * 0.20);

    // Blended render throughput: 70% previews (300/hr), 25% 1080p (128/hr), 5% 4K (37/hr)
    // Weighted average capacity per worker = 0.70*300 + 0.25*128 + 0.05*37 = 210 + 32 + 1.85 ~= 243 jobs/hr/worker
    const blendedJobsPerHourPerWorker = 240;

    // Number of render workers needed to keep peak utilization below 75%
    const minRenderWorkers = Math.max(2, Math.ceil(peakHourRenders / (blendedJobsPerHourPerWorker * 0.75)));

    // Analysis jobs take ~18s for 10-minute video (~200 jobs/hr/worker)
    const minAnalysisWorkers = Math.max(2, Math.ceil(peakHourRenders / 180));

    // Resource allocation:
    // Analysis worker = 0.5 vCPU, 512 MB
    // Render worker = 2.0 vCPU, 2048 MB (CPU-bound FFmpeg)
    const totalVcpu = minAnalysisWorkers * 0.5 + minRenderWorkers * 2.0;
    const totalMemoryGb = minAnalysisWorkers * 0.5 + minRenderWorkers * 2.0;

    // Expected queue wait time at peak using M/M/c queueing approximation
    const utilization = peakHourRenders / (minRenderWorkers * blendedJobsPerHourPerWorker);
    const avgServiceTimeSec = 18.0; // weighted avg render time
    const expectedMaxQueueWaitSec = Number(((utilization / (1 - Math.min(utilization, 0.95))) * (avgServiceTimeSec / minRenderWorkers)).toFixed(2));

    return {
      dailyRendersTarget,
      peakHourRenders,
      recommendedAnalysisWorkers: minAnalysisWorkers,
      recommendedRenderWorkers: minRenderWorkers,
      totalVcpuRequired: Math.ceil(totalVcpu),
      totalMemoryGbRequired: Math.ceil(totalMemoryGb),
      expectedMaxQueueWaitSec,
    };
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1]?.endsWith('workerCapacityCheck.ts') || process.argv[1]?.endsWith('workerCapacityCheck.js')) {
  console.log('[WorkerCapacityCheck] Cluster Sizing Sizing Calculator:');
  const tiers = [100, 1000, 10000];
  for (const t of tiers) {
    console.log(`\n--- Sizing for ${t} Daily Renders ---`);
    console.table(WorkerCapacityService.calculateClusterSizing(t));
  }
}

