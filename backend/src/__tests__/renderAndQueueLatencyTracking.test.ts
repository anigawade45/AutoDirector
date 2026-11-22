import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RenderLatencyTracker,
  LatencyPercentiles,
  FullLatencyReport,
} from '../services/telemetry/renderLatencyTracker.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { JobsController } from '../controllers/jobsController.js';
import mongoose from 'mongoose';

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    findById: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
}));

describe('P95 Render & Queue Latency Tracking Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RenderLatencyTracker.reset();
  });

  describe('1. Mathematical Percentile Engine (p50, p90, p95, p99)', () => {
    it('returns zeroes for empty sample array', () => {
      const stats = RenderLatencyTracker.computePercentiles([]);
      expect(stats.sampleCount).toBe(0);
      expect(stats.minMs).toBe(0);
      expect(stats.maxMs).toBe(0);
      expect(stats.avgMs).toBe(0);
      expect(stats.p50Ms).toBe(0);
      expect(stats.p95Ms).toBe(0);
    });

    it('correctly computes percentiles on a uniform 100-sample distribution (10ms to 1000ms)', () => {
      // 100 samples: 10, 20, 30, ..., 1000 ms
      const samples: number[] = [];
      for (let i = 1; i <= 100; i++) {
        samples.push(i * 10);
      }

      const stats = RenderLatencyTracker.computePercentiles(samples);

      expect(stats.sampleCount).toBe(100);
      expect(stats.minMs).toBe(10);
      expect(stats.maxMs).toBe(1000);
      expect(stats.avgMs).toBe(505);
      expect(stats.p50Ms).toBe(500); // 50th percentile
      expect(stats.p90Ms).toBe(900); // 90th percentile
      expect(stats.p95Ms).toBe(950); // 95th percentile
      expect(stats.p99Ms).toBe(990); // 99th percentile
    });

    it('handles heavy-tailed skewed distributions where outlier renders drive p95/p99', () => {
      // 90 fast renders (800ms - 1200ms) and 10 slow/outlier renders (25,000ms - 45,000ms)
      const samples: number[] = [];
      for (let i = 0; i < 90; i++) {
        samples.push(800 + (i % 5) * 100); // ~800 - 1200 ms
      }
      for (let i = 0; i < 10; i++) {
        samples.push(25000 + i * 2000); // 10 outliers: 25k to 43k
      }

      const stats = RenderLatencyTracker.computePercentiles(samples);

      expect(stats.sampleCount).toBe(100);
      expect(stats.p50Ms).toBeLessThanOrEqual(1200); // Median is fast
      expect(stats.p95Ms).toBeGreaterThanOrEqual(25000); // p95 exposes the inflection point
      expect(stats.p99Ms).toBeGreaterThanOrEqual(40000); // p99 captures high extreme
      expect(stats.maxMs).toBe(43000);
    });
  });

  describe('2. RenderJob Lifecycle Automated Latency Recording', () => {
    it('calculates and saves queueWaitMs when job transitions from queued to processing', async () => {
      const queuedTime = new Date(Date.now() - 4500); // Queued 4.5s ago
      const mockJob: any = {
        _id: '672b11111111111111111111',
        type: 'preview',
        profile: 'preview_480p',
        state: 'queued',
        percent: 0,
        timings: {
          queuedAt: queuedTime,
        },
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(mockJob);

      await RenderJobLifecycle.transition(mockJob._id, 'processing', {
        workerId: 'worker-node-1',
        percent: 10,
      });

      expect(mockJob.state).toBe('processing');
      expect(mockJob.timings.startedAt).toBeInstanceOf(Date);
      expect(mockJob.timings.queueWaitMs).toBeGreaterThanOrEqual(4400);

      // Verify sample was recorded in RenderLatencyTracker
      const report = RenderLatencyTracker.getLatencyReport();
      expect(report.byProfile.preview_480p.queueLatency.sampleCount).toBe(1);
      expect(report.byProfile.preview_480p.queueLatency.p95Ms).toBeGreaterThanOrEqual(4400);
    });

    it('calculates render durationMs and total E2E latency when job transitions to completed', async () => {
      const queuedTime = new Date(Date.now() - 15000);
      const startedTime = new Date(Date.now() - 10000); // Started 10s ago

      const mockJob: any = {
        _id: '672b22222222222222222222',
        type: 'export',
        profile: 'final_1080p',
        state: 'processing',
        percent: 80,
        timings: {
          queuedAt: queuedTime,
          startedAt: startedTime,
          queueWaitMs: 5000,
        },
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(RenderJobModel, 'findById').mockResolvedValue(mockJob);

      await RenderJobLifecycle.transition(mockJob._id, 'completed', {
        output: {
          key: 'users/u1/projects/p1/renders/out.mp4',
          sizeBytes: 15000000,
          durationMs: 60000,
        },
      });

      expect(mockJob.state).toBe('completed');
      expect(mockJob.timings.finishedAt).toBeInstanceOf(Date);
      expect(mockJob.timings.durationMs).toBeGreaterThanOrEqual(9900); // ~10s execution

      const report = RenderLatencyTracker.getLatencyReport();
      const exportStats = report.byProfile.final_1080p;

      expect(exportStats.renderLatency.sampleCount).toBe(1);
      expect(exportStats.renderLatency.p95Ms).toBeGreaterThanOrEqual(9900);
      expect(exportStats.e2eLatency.sampleCount).toBe(1);
      expect(exportStats.e2eLatency.p95Ms).toBeGreaterThanOrEqual(14900); // 15s total E2E
    });
  });

  describe('3. Multi-Profile Slicing & Dimensional Breakdown', () => {
    it('isolates 480p preview, 1080p export, and 4K export metrics into independent percentiles', () => {
      // 1. Record 20 preview samples (queue: 500ms, render: 8,000ms)
      for (let i = 0; i < 20; i++) {
        RenderLatencyTracker.recordQueueLatency(500 + i * 10, {
          profile: 'preview_480p',
          type: 'preview',
        });
        RenderLatencyTracker.recordRenderLatency(8000 + i * 50, {
          profile: 'preview_480p',
          type: 'preview',
        });
      }

      // 2. Record 10 1080p export samples (queue: 4,000ms, render: 28,000ms)
      for (let i = 0; i < 10; i++) {
        RenderLatencyTracker.recordQueueLatency(4000 + i * 100, {
          profile: 'final_1080p',
          type: 'export',
        });
        RenderLatencyTracker.recordRenderLatency(28000 + i * 200, {
          profile: 'final_1080p',
          type: 'export',
        });
      }

      // 3. Record 5 4K export samples (queue: 12,000ms, render: 95,000ms)
      for (let i = 0; i < 5; i++) {
        RenderLatencyTracker.recordQueueLatency(12000 + i * 200, {
          profile: 'final_4k',
          type: 'export',
        });
        RenderLatencyTracker.recordRenderLatency(95000 + i * 500, {
          profile: 'final_4k',
          type: 'export',
        });
      }

      const report = RenderLatencyTracker.getLatencyReport();

      // Preview 480p checks
      expect(report.byProfile.preview_480p.queueLatency.sampleCount).toBe(20);
      expect(report.byProfile.preview_480p.queueLatency.p95Ms).toBeLessThanOrEqual(700);
      expect(report.byProfile.preview_480p.renderLatency.p95Ms).toBeLessThanOrEqual(9000);

      // Final 1080p checks
      expect(report.byProfile.final_1080p.queueLatency.sampleCount).toBe(10);
      expect(report.byProfile.final_1080p.queueLatency.p95Ms).toBeGreaterThan(4500);
      expect(report.byProfile.final_1080p.renderLatency.p95Ms).toBeGreaterThan(29000);

      // Final 4K checks
      expect(report.byProfile.final_4k.queueLatency.sampleCount).toBe(5);
      expect(report.byProfile.final_4k.renderLatency.p95Ms).toBeGreaterThan(95000);

      // Overall combined checks
      expect(report.overall.queueLatency.sampleCount).toBe(35);
      expect(report.overall.renderLatency.sampleCount).toBe(35);
    });
  });

  describe('4. SLA Threshold Monitoring & Breach Detection', () => {
    it('evaluates SLA compliance as TRUE when all p95 metrics remain within target limits', () => {
      // Preview queue: 1,500ms (< 10,000ms SLA)
      // Preview render: 12,000ms (< 25,000ms SLA)
      // Export queue: 8,000ms (< 60,000ms SLA)
      // Export render: 45,000ms (< 180,000ms SLA)
      RenderLatencyTracker.recordQueueLatency(1500, { profile: 'preview_480p' });
      RenderLatencyTracker.recordRenderLatency(12000, { profile: 'preview_480p' });
      RenderLatencyTracker.recordQueueLatency(8000, { profile: 'final_1080p' });
      RenderLatencyTracker.recordRenderLatency(45000, { profile: 'final_1080p' });

      const report = RenderLatencyTracker.getLatencyReport();

      expect(report.slaStatus.compliant).toBe(true);
      expect(report.slaStatus.previewQueueP95.breached).toBe(false);
      expect(report.slaStatus.previewRenderP95.breached).toBe(false);
      expect(report.slaStatus.exportQueueP95.breached).toBe(false);
      expect(report.slaStatus.exportRenderP95.breached).toBe(false);
    });

    it('evaluates SLA compliance as FALSE and flags specific breach when preview queue wait p95 > 10s', () => {
      // 17 fast samples (2,000ms) and 3 slow samples (18,000ms - 20,000ms) causing p95 breach in a 20-sample window
      for (let i = 0; i < 17; i++) {
        RenderLatencyTracker.recordQueueLatency(2000, { profile: 'preview_480p' });
      }
      RenderLatencyTracker.recordQueueLatency(18000, { profile: 'preview_480p' });
      RenderLatencyTracker.recordQueueLatency(19000, { profile: 'preview_480p' });
      RenderLatencyTracker.recordQueueLatency(20000, { profile: 'preview_480p' });

      const report = RenderLatencyTracker.getLatencyReport();

      expect(report.slaStatus.compliant).toBe(false);
      expect(report.slaStatus.previewQueueP95.breached).toBe(true);
      expect(report.slaStatus.previewQueueP95.actualMs).toBeGreaterThanOrEqual(18000);
      expect(report.slaStatus.previewQueueP95.thresholdMs).toBe(10000);
    });
  });

  describe('5. Database Querying & API Metrics Endpoint', () => {
    it('aggregates historical RenderJob documents from MongoDB to compute persistent percentiles', async () => {
      const mockJobs = [
        {
          profile: 'preview_480p',
          type: 'preview',
          timings: {
            queuedAt: new Date(Date.now() - 30000),
            startedAt: new Date(Date.now() - 28000), // 2000ms wait
            finishedAt: new Date(Date.now() - 18000), // 10000ms render
            queueWaitMs: 2000,
            durationMs: 10000,
          },
        },
        {
          profile: 'preview_480p',
          type: 'preview',
          timings: {
            queuedAt: new Date(Date.now() - 25000),
            startedAt: new Date(Date.now() - 22000), // 3000ms wait
            finishedAt: new Date(Date.now() - 10000), // 12000ms render
            queueWaitMs: 3000,
            durationMs: 12000,
          },
        },
      ];

      (RenderJobModel.find as any).mockReturnValue({
        select: vi.fn().mockResolvedValue(mockJobs),
      });

      const report = await RenderLatencyTracker.computeFromDatabase(3600000);

      expect(report.byProfile.preview_480p.queueLatency.sampleCount).toBe(2);
      expect(report.byProfile.preview_480p.queueLatency.minMs).toBe(2000);
      expect(report.byProfile.preview_480p.queueLatency.maxMs).toBe(3000);
      expect(report.byProfile.preview_480p.renderLatency.minMs).toBe(10000);
      expect(report.byProfile.preview_480p.renderLatency.maxMs).toBe(12000);
    });

    it('handles GET /api/jobs/metrics/latency and returns structured 200 report', async () => {
      RenderLatencyTracker.recordQueueLatency(1200, { profile: 'preview_480p' });
      RenderLatencyTracker.recordRenderLatency(9500, { profile: 'preview_480p' });

      let resData: any = null;
      let statusCode = 0;

      const mockReq: any = {
        id: 'req_latency_test_1',
      };

      const mockRes: any = {
        status: vi.fn((code: number) => {
          statusCode = code;
          return {
            json: vi.fn((body: any) => {
              resData = body;
            }),
          };
        }),
      };

      await JobsController.getLatencyMetrics(mockReq, mockRes, vi.fn());

      expect(statusCode).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.overall).toBeDefined();
      expect(resData.data.slaStatus).toBeDefined();
      expect(resData.data.byProfile.preview_480p.queueLatency.sampleCount).toBe(1);
    });
  });
});
