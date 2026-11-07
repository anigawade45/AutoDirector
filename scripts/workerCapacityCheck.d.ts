export interface CapacityProfile {
    profile: 'preview_480p' | 'final_1080p' | 'final_4k';
    avgVideoLengthSec: number;
    renderTimeSecPerWorker: number;
    realtimeRatio: number;
    jobsPerHourPerWorker: number;
}
export interface ClusterSizing {
    dailyRendersTarget: number;
    peakHourRenders: number;
    recommendedAnalysisWorkers: number;
    recommendedRenderWorkers: number;
    totalVcpuRequired: number;
    totalMemoryGbRequired: number;
    expectedMaxQueueWaitSec: number;
}
export declare class WorkerCapacityService {
    private static profiles;
    static getProfiles(): CapacityProfile[];
    /**
     * Computes recommended worker cluster sizing for target daily throughput.
     */
    static calculateClusterSizing(dailyRendersTarget: number): ClusterSizing;
}
//# sourceMappingURL=workerCapacityCheck.d.ts.map