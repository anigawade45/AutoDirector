export interface CapacityProfile {
  profile: 'preview_480p' | 'final_1080p' | 'final_4k';
  avgVideoLengthSec: number;
  renderTimeSecPerWorker: number;
  realtimeRatio: number; // renderTime / videoLength
  jobsPerHourPerWorker: number;
}

export interface CapacitySizingOptions {
  peakTrafficSharePercent?: number; // default: 20%
  blendedJobsPerHourOverride?: number; // override weighted jobs/hr
  targetPeakUtilization?: number; // default: 0.75 (75%)
  measuredTelemetry?: {
    avgRenderTimeSec?: number;
    peakQueueDepth?: number;
    measuredJobsPerHour?: number;
  };
}

export interface ClusterSizing {
  dailyRendersTarget: number;
  peakHourRenders: number; // ~20% of daily renders occur during peak hour
  recommendedAnalysisWorkers: number;
  recommendedRenderWorkers: number;
  totalVcpuRequired: number;
  totalMemoryGbRequired: number;
  expectedMaxQueueWaitSec: number;
  isEstimated: boolean;
  modelType: 'ESTIMATED_THEORETICAL_MODEL' | 'EMPIRICAL_MEASURED_MODEL';
  label: string;
  assumptions: {
    peakTrafficSharePercent: number;
    targetPeakUtilization: number;
    blendedJobsPerHourPerWorker: number;
    benchmarkSource: 'static_profile_defaults' | 'injected_telemetry';
  };
}

export class WorkerCapacityService {
  private static profiles: CapacityProfile[] = [
    {
      profile: 'preview_480p',
      avgVideoLengthSec: 60,
      renderTimeSecPerWorker: 12.0,
      realtimeRatio: 0.2,
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
   * Explicitly labeled as theoretical estimation unless empirical telemetry is injected.
   */
  static calculateClusterSizing(
    dailyRendersTarget: number,
    options?: CapacitySizingOptions
  ): ClusterSizing {
    const peakShare = options?.peakTrafficSharePercent ?? 20;
    const peakHourRenders = Math.ceil(dailyRendersTarget * (peakShare / 100));

    // Blended render throughput:
    // Default baseline model: 70% previews (300/hr), 25% 1080p (128/hr), 5% 4K (37/hr) = ~240 jobs/hr/worker
    const isMeasured = Boolean(options?.measuredTelemetry?.measuredJobsPerHour);
    const blendedJobsPerHourPerWorker =
      options?.blendedJobsPerHourOverride || options?.measuredTelemetry?.measuredJobsPerHour || 240;

    const targetPeakUtilization = options?.targetPeakUtilization ?? 0.75;

    // Number of render workers needed to keep peak utilization below target
    const minRenderWorkers = Math.max(
      2,
      Math.ceil(peakHourRenders / (blendedJobsPerHourPerWorker * targetPeakUtilization))
    );

    // Analysis jobs take ~18s for 10-minute video (~200 jobs/hr/worker)
    const minAnalysisWorkers = Math.max(2, Math.ceil(peakHourRenders / 180));

    // Resource allocation:
    // Analysis worker = 0.5 vCPU, 512 MB
    // Render worker = 2.0 vCPU, 2048 MB (CPU-bound FFmpeg)
    const totalVcpu = minAnalysisWorkers * 0.5 + minRenderWorkers * 2.0;
    const totalMemoryGb = minAnalysisWorkers * 0.5 + minRenderWorkers * 2.0;

    // Expected queue wait time at peak using M/M/c queueing approximation
    const utilization = peakHourRenders / (minRenderWorkers * blendedJobsPerHourPerWorker);
    const avgServiceTimeSec = options?.measuredTelemetry?.avgRenderTimeSec ?? 18.0;
    const expectedMaxQueueWaitSec = Number(
      (
        (utilization / (1 - Math.min(utilization, 0.95))) *
        (avgServiceTimeSec / minRenderWorkers)
      ).toFixed(2)
    );

    return {
      dailyRendersTarget,
      peakHourRenders,
      recommendedAnalysisWorkers: minAnalysisWorkers,
      recommendedRenderWorkers: minRenderWorkers,
      totalVcpuRequired: Math.ceil(totalVcpu),
      totalMemoryGbRequired: Math.ceil(totalMemoryGb),
      expectedMaxQueueWaitSec,
      isEstimated: true,
      modelType: isMeasured ? 'EMPIRICAL_MEASURED_MODEL' : 'ESTIMATED_THEORETICAL_MODEL',
      label: isMeasured
        ? 'EMPIRICAL CAPACITY ESTIMATE (MEASURED TELEMETRY)'
        : 'THEORETICAL CAPACITY ESTIMATE (SIMULATED PROFILE MODEL)',
      assumptions: {
        peakTrafficSharePercent: peakShare,
        targetPeakUtilization,
        blendedJobsPerHourPerWorker,
        benchmarkSource: isMeasured ? 'injected_telemetry' : 'static_profile_defaults',
      },
    };
  }
}

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('workerCapacityCheck.ts') ||
    process.argv[1]?.endsWith('workerCapacityCheck.js'))
);

if (isDirectEntry) {
  console.log(
    '[WorkerCapacityCheck] Worker Cluster Sizing Planner (ESTIMATED / THEORETICAL MODEL):'
  );
  console.log(
    'NOTE: Sizing outputs are theoretical capacity models based on baseline FFmpeg benchmarks and simulated traffic distributions. Actual production cluster performance requires real-time queue telemetry.\n'
  );
  const tiers = [100, 1000, 10000];
  for (const t of tiers) {
    console.log(`\n--- Estimated Sizing for ${t} Daily Renders (SIMULATED) ---`);
    console.table(WorkerCapacityService.calculateClusterSizing(t));
  }
}
