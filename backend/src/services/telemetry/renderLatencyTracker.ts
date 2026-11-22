import { RenderJobModel } from '../../models/RenderJob.js';

export interface LatencyPercentiles {
  sampleCount: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ProfileLatencyReport {
  queueLatency: LatencyPercentiles;
  renderLatency: LatencyPercentiles;
  e2eLatency: LatencyPercentiles;
}

export interface SlaThresholdCheck {
  actualMs: number;
  thresholdMs: number;
  breached: boolean;
}

export interface FullLatencyReport {
  timestamp: string;
  overall: ProfileLatencyReport;
  byProfile: {
    preview_480p: ProfileLatencyReport;
    final_1080p: ProfileLatencyReport;
    final_4k: ProfileLatencyReport;
  };
  byQueue: {
    preview: LatencyPercentiles;
    render: LatencyPercentiles;
    analysis: LatencyPercentiles;
  };
  slaStatus: {
    compliant: boolean;
    previewQueueP95: SlaThresholdCheck;
    previewRenderP95: SlaThresholdCheck;
    exportQueueP95: SlaThresholdCheck;
    exportRenderP95: SlaThresholdCheck;
  };
}

export interface LatencySampleMeta {
  type?: string;
  profile?: string;
  queueName?: string;
}

export class RenderLatencyTracker {
  private static readonly MAX_SAMPLES = 5000;

  // In-memory sliding sample buffers
  private static queueSamples: Map<string, number[]> = new Map();
  private static renderSamples: Map<string, number[]> = new Map();
  private static e2eSamples: Map<string, number[]> = new Map();

  // Production SLA Thresholds (in ms)
  public static readonly SLA_THRESHOLDS = {
    PREVIEW_QUEUE_P95_MS: 10000, // 10s max p95 queue wait for preview
    PREVIEW_RENDER_P95_MS: 25000, // 25s max p95 render time for 480p preview
    EXPORT_QUEUE_P95_MS: 60000, // 60s max p95 queue wait for export
    EXPORT_RENDER_P95_MS: 180000, // 180s max p95 render time for 1080p export
  };

  /**
   * Records a queue wait latency sample (queuedAt -> startedAt).
   */
  static recordQueueLatency(latencyMs: number, meta?: LatencySampleMeta): void {
    if (latencyMs < 0 || !Number.isFinite(latencyMs)) return;

    this.appendSample('overall', this.queueSamples, latencyMs);

    if (meta?.profile) {
      this.appendSample(meta.profile, this.queueSamples, latencyMs);
    }
    if (meta?.type) {
      this.appendSample(meta.type, this.queueSamples, latencyMs);
    }
    if (meta?.queueName) {
      this.appendSample(meta.queueName, this.queueSamples, latencyMs);
    }
  }

  /**
   * Records a render execution latency sample (startedAt -> finishedAt).
   */
  static recordRenderLatency(latencyMs: number, meta?: LatencySampleMeta): void {
    if (latencyMs < 0 || !Number.isFinite(latencyMs)) return;

    this.appendSample('overall', this.renderSamples, latencyMs);

    if (meta?.profile) {
      this.appendSample(meta.profile, this.renderSamples, latencyMs);
    }
    if (meta?.type) {
      this.appendSample(meta.type, this.renderSamples, latencyMs);
    }
    if (meta?.queueName) {
      this.appendSample(meta.queueName, this.renderSamples, latencyMs);
    }
  }

  /**
   * Records an end-to-end total latency sample (queuedAt -> finishedAt).
   */
  static recordE2ELatency(latencyMs: number, meta?: LatencySampleMeta): void {
    if (latencyMs < 0 || !Number.isFinite(latencyMs)) return;

    this.appendSample('overall', this.e2eSamples, latencyMs);

    if (meta?.profile) {
      this.appendSample(meta.profile, this.e2eSamples, latencyMs);
    }
    if (meta?.type) {
      this.appendSample(meta.type, this.e2eSamples, latencyMs);
    }
  }

  /**
   * Computes p50, p90, p95, p99, min, max, avg percentiles from an array of numeric samples.
   */
  static computePercentiles(samples: number[]): LatencyPercentiles {
    if (!samples || samples.length === 0) {
      return {
        sampleCount: 0,
        minMs: 0,
        maxMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    const getRank = (percentile: number): number => {
      const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
      );
      return sorted[idx];
    };

    return {
      sampleCount: sorted.length,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      avgMs: Math.round(sum / sorted.length),
      p50Ms: getRank(50),
      p90Ms: getRank(90),
      p95Ms: getRank(95),
      p99Ms: getRank(99),
    };
  }

  /**
   * Returns a complete latency report across overall, profile, and queue dimensions with SLA compliance.
   */
  static getLatencyReport(): FullLatencyReport {
    const buildProfileReport = (key: string): ProfileLatencyReport => ({
      queueLatency: this.computePercentiles(this.queueSamples.get(key) || []),
      renderLatency: this.computePercentiles(this.renderSamples.get(key) || []),
      e2eLatency: this.computePercentiles(this.e2eSamples.get(key) || []),
    });

    const overall = buildProfileReport('overall');
    const preview480p = buildProfileReport('preview_480p');
    const final1080p = buildProfileReport('final_1080p');
    const final4k = buildProfileReport('final_4k');

    const previewQueuePct = this.computePercentiles(
      this.queueSamples.get('preview') || this.queueSamples.get('preview_480p') || []
    );
    const renderQueuePct = this.computePercentiles(
      this.queueSamples.get('render') || this.queueSamples.get('export') || []
    );
    const analysisQueuePct = this.computePercentiles(this.queueSamples.get('analysis') || []);

    // Check SLA thresholds against p95 metrics
    const previewQueueCheck: SlaThresholdCheck = {
      actualMs: preview480p.queueLatency.p95Ms,
      thresholdMs: this.SLA_THRESHOLDS.PREVIEW_QUEUE_P95_MS,
      breached:
        preview480p.queueLatency.sampleCount > 0 &&
        preview480p.queueLatency.p95Ms > this.SLA_THRESHOLDS.PREVIEW_QUEUE_P95_MS,
    };

    const previewRenderCheck: SlaThresholdCheck = {
      actualMs: preview480p.renderLatency.p95Ms,
      thresholdMs: this.SLA_THRESHOLDS.PREVIEW_RENDER_P95_MS,
      breached:
        preview480p.renderLatency.sampleCount > 0 &&
        preview480p.renderLatency.p95Ms > this.SLA_THRESHOLDS.PREVIEW_RENDER_P95_MS,
    };

    const exportQueueCheck: SlaThresholdCheck = {
      actualMs: final1080p.queueLatency.p95Ms,
      thresholdMs: this.SLA_THRESHOLDS.EXPORT_QUEUE_P95_MS,
      breached:
        final1080p.queueLatency.sampleCount > 0 &&
        final1080p.queueLatency.p95Ms > this.SLA_THRESHOLDS.EXPORT_QUEUE_P95_MS,
    };

    const exportRenderCheck: SlaThresholdCheck = {
      actualMs: final1080p.renderLatency.p95Ms,
      thresholdMs: this.SLA_THRESHOLDS.EXPORT_RENDER_P95_MS,
      breached:
        final1080p.renderLatency.sampleCount > 0 &&
        final1080p.renderLatency.p95Ms > this.SLA_THRESHOLDS.EXPORT_RENDER_P95_MS,
    };

    const compliant =
      !previewQueueCheck.breached &&
      !previewRenderCheck.breached &&
      !exportQueueCheck.breached &&
      !exportRenderCheck.breached;

    return {
      timestamp: new Date().toISOString(),
      overall,
      byProfile: {
        preview_480p: preview480p,
        final_1080p: final1080p,
        final_4k: final4k,
      },
      byQueue: {
        preview: previewQueuePct,
        render: renderQueuePct,
        analysis: analysisQueuePct,
      },
      slaStatus: {
        compliant,
        previewQueueP95: previewQueueCheck,
        previewRenderP95: previewRenderCheck,
        exportQueueP95: exportQueueCheck,
        exportRenderP95: exportRenderCheck,
      },
    };
  }

  /**
   * Queries historical RenderJob documents from MongoDB to compute authoritative persistent percentiles.
   */
  static async computeFromDatabase(timeWindowMs: number = 86400000): Promise<FullLatencyReport> {
    const sinceDate = new Date(Date.now() - timeWindowMs);

    try {
      const completedJobs = await RenderJobModel.find({
        state: 'completed',
        'timings.finishedAt': { $gte: sinceDate },
      }).select('profile type timings');

      const queueSamples = new Map<string, number[]>();
      const renderSamples = new Map<string, number[]>();
      const e2eSamples = new Map<string, number[]>();

      const append = (key: string, map: Map<string, number[]>, val: number) => {
        const arr = map.get(key) || [];
        arr.push(val);
        map.set(key, arr);
      };

      for (const job of completedJobs) {
        const queuedAt = job.timings?.queuedAt ? new Date(job.timings.queuedAt).getTime() : 0;
        const startedAt = job.timings?.startedAt ? new Date(job.timings.startedAt).getTime() : 0;
        const finishedAt = job.timings?.finishedAt ? new Date(job.timings.finishedAt).getTime() : 0;

        if (queuedAt > 0 && startedAt >= queuedAt) {
          const qWait = job.timings?.queueWaitMs ?? (startedAt - queuedAt);
          append('overall', queueSamples, qWait);
          if (job.profile) append(job.profile, queueSamples, qWait);
          if (job.type) append(job.type, queueSamples, qWait);
        }

        if (startedAt > 0 && finishedAt >= startedAt) {
          const rDur = job.timings?.durationMs ?? (finishedAt - startedAt);
          append('overall', renderSamples, rDur);
          if (job.profile) append(job.profile, renderSamples, rDur);
          if (job.type) append(job.type, renderSamples, rDur);
        }

        if (queuedAt > 0 && finishedAt >= queuedAt) {
          const e2e = finishedAt - queuedAt;
          append('overall', e2eSamples, e2e);
          if (job.profile) append(job.profile, e2eSamples, e2e);
          if (job.type) append(job.type, e2eSamples, e2e);
        }
      }

      // Re-hydrate tracker or return database-derived report
      const buildProfileReport = (key: string): ProfileLatencyReport => ({
        queueLatency: this.computePercentiles(queueSamples.get(key) || []),
        renderLatency: this.computePercentiles(renderSamples.get(key) || []),
        e2eLatency: this.computePercentiles(e2eSamples.get(key) || []),
      });

      const overall = buildProfileReport('overall');
      const preview480p = buildProfileReport('preview_480p');
      const final1080p = buildProfileReport('final_1080p');
      const final4k = buildProfileReport('final_4k');

      const previewQueuePct = this.computePercentiles(
        queueSamples.get('preview') || queueSamples.get('preview_480p') || []
      );
      const renderQueuePct = this.computePercentiles(
        queueSamples.get('render') || queueSamples.get('export') || []
      );
      const analysisQueuePct = this.computePercentiles(queueSamples.get('analysis') || []);

      const previewQueueCheck: SlaThresholdCheck = {
        actualMs: preview480p.queueLatency.p95Ms,
        thresholdMs: this.SLA_THRESHOLDS.PREVIEW_QUEUE_P95_MS,
        breached:
          preview480p.queueLatency.sampleCount > 0 &&
          preview480p.queueLatency.p95Ms > this.SLA_THRESHOLDS.PREVIEW_QUEUE_P95_MS,
      };

      const previewRenderCheck: SlaThresholdCheck = {
        actualMs: preview480p.renderLatency.p95Ms,
        thresholdMs: this.SLA_THRESHOLDS.PREVIEW_RENDER_P95_MS,
        breached:
          preview480p.renderLatency.sampleCount > 0 &&
          preview480p.renderLatency.p95Ms > this.SLA_THRESHOLDS.PREVIEW_RENDER_P95_MS,
      };

      const exportQueueCheck: SlaThresholdCheck = {
        actualMs: final1080p.queueLatency.p95Ms,
        thresholdMs: this.SLA_THRESHOLDS.EXPORT_QUEUE_P95_MS,
        breached:
          final1080p.queueLatency.sampleCount > 0 &&
          final1080p.queueLatency.p95Ms > this.SLA_THRESHOLDS.EXPORT_QUEUE_P95_MS,
      };

      const exportRenderCheck: SlaThresholdCheck = {
        actualMs: final1080p.renderLatency.p95Ms,
        thresholdMs: this.SLA_THRESHOLDS.EXPORT_RENDER_P95_MS,
        breached:
          final1080p.renderLatency.sampleCount > 0 &&
          final1080p.renderLatency.p95Ms > this.SLA_THRESHOLDS.EXPORT_RENDER_P95_MS,
      };

      return {
        timestamp: new Date().toISOString(),
        overall,
        byProfile: {
          preview_480p: preview480p,
          final_1080p: final1080p,
          final_4k: final4k,
        },
        byQueue: {
          preview: previewQueuePct,
          render: renderQueuePct,
          analysis: analysisQueuePct,
        },
        slaStatus: {
          compliant:
            !previewQueueCheck.breached &&
            !previewRenderCheck.breached &&
            !exportQueueCheck.breached &&
            !exportRenderCheck.breached,
          previewQueueP95: previewQueueCheck,
          previewRenderP95: previewRenderCheck,
          exportQueueP95: exportQueueCheck,
          exportRenderP95: exportRenderCheck,
        },
      };
    } catch {
      return this.getLatencyReport();
    }
  }

  /**
   * Resets in-memory sliding buffers (useful for testing and window rotation).
   */
  static reset(): void {
    this.queueSamples.clear();
    this.renderSamples.clear();
    this.e2eSamples.clear();
  }

  private static appendSample(key: string, map: Map<string, number[]>, val: number): void {
    const list = map.get(key) || [];
    list.push(val);
    if (list.length > this.MAX_SAMPLES) {
      list.shift(); // Drop oldest sample
    }
    map.set(key, list);
  }
}
