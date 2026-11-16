import { describe, it, expect } from 'vitest';
import { BackupRestoreService } from '../scripts/backupRestore.js';
import { WorkerCapacityService } from '../scripts/workerCapacityCheck.js';

describe('Disaster Recovery & Capacity Planning Verification Suite (BUG-008)', () => {
  describe('BackupRestoreService — DR Procedure & Verification Integrity', () => {
    it('strictly emits UNVERIFIED (never false VERIFIED) when called without injected evidence', () => {
      const summary = BackupRestoreService.verifyBackupProcedures();

      expect(summary.isSimulated).toBe(true);
      expect(summary.allPassed).toBe(false);
      expect(summary.status).toBe('ESTIMATED_SPECIFICATION');
      expect(summary.specificationValid).toBe(true);
      expect(summary.label).toContain('ESTIMATED / SPECIFICATION ONLY');

      expect(summary.checks).toHaveLength(4);
      for (const check of summary.checks) {
        expect(check.verificationStatus).toBe('UNVERIFIED');
        expect(check.verificationMode).toBe('DOCUMENTED_SPEC');
        expect(check.details).toContain('UNVERIFIED');
      }
    });

    it('verifies specification completeness and command syntax across MongoDB, Redis, and S3', () => {
      const summary = BackupRestoreService.verifyBackupProcedures();

      const mongoDump = summary.checks.find(
        (c) => c.service === 'mongodb' && c.command.includes('mongodump')
      );
      expect(mongoDump).toBeDefined();
      expect(mongoDump?.command).toContain('--gzip');
      expect(mongoDump?.command).toContain('--archive=');
      expect(mongoDump?.retentionPolicy).toContain('30 days');

      const mongoRestore = summary.checks.find(
        (c) => c.service === 'mongodb' && c.command.includes('mongorestore')
      );
      expect(mongoRestore).toBeDefined();
      expect(mongoRestore?.command).toContain('--drop');

      const redisSave = summary.checks.find((c) => c.service === 'redis');
      expect(redisSave).toBeDefined();
      expect(redisSave?.command).toContain('BGSAVE');
      expect(redisSave?.retentionPolicy).toContain('AOF');

      const s3Sync = summary.checks.find((c) => c.service === 's3');
      expect(s3Sync).toBeDefined();
      expect(s3Sync?.command).toContain('aws s3 sync');
      expect(s3Sync?.retentionPolicy).toContain('S3 Cross-Region Replication');
    });

    it('emits VERIFIED and allPassed: true when complete valid evidence is injected', () => {
      const summary = BackupRestoreService.verifyBackupProcedures({
        evidence: [
          {
            service: 'mongodb',
            status: 'VERIFIED',
            details: 'mongodump replica set snapshot verified in staging',
          },
          {
            service: 'mongodb',
            status: 'VERIFIED',
            details: 'mongorestore dry-run successful with zero collisions',
          },
          {
            service: 'redis',
            status: 'VERIFIED',
            details: 'BGSAVE snapshot executed and verified against Upstash Redis',
          },
          {
            service: 's3',
            status: 'VERIFIED',
            details: 'S3 CRR replication verified across us-east-1 and us-west-2',
          },
        ],
      });

      expect(summary.isSimulated).toBe(false);
      expect(summary.allPassed).toBe(true);
      expect(summary.status).toBe('VERIFIED');
      expect(summary.label).toContain('VERIFIED WITH INJECTED EVIDENCE');

      for (const check of summary.checks) {
        expect(check.verificationStatus).toBe('VERIFIED');
        expect(check.verificationMode).toBe('INJECTED_EVIDENCE');
      }
    });

    it('emits FAILED and allPassed: false when any injected evidence item reports failure', () => {
      const summary = BackupRestoreService.verifyBackupProcedures({
        evidence: [
          {
            service: 'mongodb',
            status: 'VERIFIED',
            details: 'mongodump verified',
          },
          {
            service: 'mongodb',
            status: 'FAILED',
            details: 'mongorestore failed: replica set disk full',
          },
          {
            service: 'redis',
            status: 'VERIFIED',
            details: 'BGSAVE verified',
          },
          {
            service: 's3',
            status: 'VERIFIED',
            details: 'S3 replication verified',
          },
        ],
      });

      expect(summary.allPassed).toBe(false);
      expect(summary.status).toBe('FAILED');
      expect(summary.label).toContain('VALIDATION FAILURES DETECTED');

      const failedCheck = summary.checks.find((c) => c.verificationStatus === 'FAILED');
      expect(failedCheck).toBeDefined();
      expect(failedCheck?.details).toContain('replica set disk full');
    });

    it('marks unprovided checks as UNVERIFIED when partial evidence is supplied', () => {
      const summary = BackupRestoreService.verifyBackupProcedures({
        evidence: [
          {
            service: 's3',
            status: 'VERIFIED',
            details: 'S3 replication verified',
          },
        ],
      });

      expect(summary.allPassed).toBe(false);
      expect(summary.status).toBe('ESTIMATED_SPECIFICATION');

      const s3Check = summary.checks.find((c) => c.service === 's3');
      expect(s3Check?.verificationStatus).toBe('VERIFIED');

      const mongoChecks = summary.checks.filter((c) => c.service === 'mongodb');
      expect(mongoChecks.every((c) => c.verificationStatus === 'UNVERIFIED')).toBe(true);
    });
  });

  describe('WorkerCapacityService — Cluster Sizing & Model Integrity', () => {
    it('always marks capacity sizing outputs with isEstimated: true and theoretical model metadata', () => {
      const sizing = WorkerCapacityService.calculateClusterSizing(500);

      expect(sizing.isEstimated).toBe(true);
      expect(sizing.modelType).toBe('ESTIMATED_THEORETICAL_MODEL');
      expect(sizing.label).toContain('THEORETICAL CAPACITY ESTIMATE');
      expect(sizing.assumptions.benchmarkSource).toBe('static_profile_defaults');
      expect(sizing.assumptions.peakTrafficSharePercent).toBe(20);
      expect(sizing.assumptions.targetPeakUtilization).toBe(0.75);
    });

    it('computes mathematically sound cluster sizing across standard workload tiers', () => {
      const sizing100 = WorkerCapacityService.calculateClusterSizing(100);
      expect(sizing100.peakHourRenders).toBe(20);
      expect(sizing100.recommendedRenderWorkers).toBe(2);
      expect(sizing100.recommendedAnalysisWorkers).toBe(2);
      expect(sizing100.totalVcpuRequired).toBe(5);
      expect(sizing100.totalMemoryGbRequired).toBe(5);

      const sizing1000 = WorkerCapacityService.calculateClusterSizing(1000);
      expect(sizing1000.peakHourRenders).toBe(200);
      expect(sizing1000.recommendedRenderWorkers).toBe(2);
      expect(sizing1000.recommendedAnalysisWorkers).toBe(2);

      const sizing10000 = WorkerCapacityService.calculateClusterSizing(10000);
      expect(sizing10000.peakHourRenders).toBe(2000);
      expect(sizing10000.recommendedRenderWorkers).toBeGreaterThanOrEqual(12);
      expect(sizing10000.recommendedAnalysisWorkers).toBeGreaterThanOrEqual(12);
      expect(sizing10000.totalVcpuRequired).toBeGreaterThanOrEqual(30);
    });

    it('adapts capacity sizing when empirical telemetry is injected', () => {
      const sizingMeasured = WorkerCapacityService.calculateClusterSizing(2000, {
        measuredTelemetry: {
          measuredJobsPerHour: 100, // Slower measured rendering (e.g. heavy effects)
          avgRenderTimeSec: 36.0,
        },
      });

      expect(sizingMeasured.isEstimated).toBe(true);
      expect(sizingMeasured.modelType).toBe('EMPIRICAL_MEASURED_MODEL');
      expect(sizingMeasured.label).toContain('EMPIRICAL CAPACITY ESTIMATE');
      expect(sizingMeasured.assumptions.benchmarkSource).toBe('injected_telemetry');
      expect(sizingMeasured.assumptions.blendedJobsPerHourPerWorker).toBe(100);

      // Slower jobs per hour must require more workers for the same workload
      const sizingTheoretical = WorkerCapacityService.calculateClusterSizing(2000);
      expect(sizingMeasured.recommendedRenderWorkers).toBeGreaterThan(
        sizingTheoretical.recommendedRenderWorkers
      );
    });

    it('supports custom peak traffic share and target utilization overrides', () => {
      const sizingCustom = WorkerCapacityService.calculateClusterSizing(1000, {
        peakTrafficSharePercent: 40, // Extreme burstiness (40% in peak hour)
        targetPeakUtilization: 0.5, // Conservative 50% target headroom
      });

      expect(sizingCustom.peakHourRenders).toBe(400);
      expect(sizingCustom.assumptions.peakTrafficSharePercent).toBe(40);
      expect(sizingCustom.assumptions.targetPeakUtilization).toBe(0.5);
      expect(sizingCustom.recommendedRenderWorkers).toBeGreaterThanOrEqual(4);
    });

    it('exposes baseline profiles for 480p, 1080p, and 4k encoding targets', () => {
      const profiles = WorkerCapacityService.getProfiles();
      expect(profiles).toHaveLength(3);

      const p480 = profiles.find((p) => p.profile === 'preview_480p');
      expect(p480?.jobsPerHourPerWorker).toBe(300);

      const p1080 = profiles.find((p) => p.profile === 'final_1080p');
      expect(p1080?.jobsPerHourPerWorker).toBe(128);

      const p4k = profiles.find((p) => p.profile === 'final_4k');
      expect(p4k?.jobsPerHourPerWorker).toBe(37);
    });
  });
});
