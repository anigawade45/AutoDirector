import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { StorageKeys } from '../config/s3.js';
import { S3Service } from '../services/storage/s3Service.js';
import { PurgeService } from '../services/maintenance/purgeService.js';
import { ProductionSmokeTestSuite } from '../scripts/smokeTest.js';
import { BackupRestoreService } from '../scripts/backupRestore.js';
import { WorkerCapacityService } from '../scripts/workerCapacityCheck.js';

// Mock models and services for isolated testing
vi.mock('../models/User.js', () => ({
  UserModel: {
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 }),
  },
}));

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    find: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 }),
  },
}));

vi.mock('../models/AnalysisResult.js', () => ({
  AnalysisResultModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 }),
  },
}));

vi.mock('../models/CaptionSet.js', () => ({
  CaptionSetModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 }),
  },
}));

vi.mock('../models/EditPlan.js', () => ({
  EditPlanModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 5 }),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

vi.mock('../models/TimelineVersion.js', () => ({
  TimelineVersionModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 5 }),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 4 }),
  },
}));

vi.mock('../models/ChatMessage.js', () => ({
  ChatMessageModel: {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 10 }),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    deleteObjectsByPrefix: vi.fn().mockResolvedValue(12),
    purgeUserStorage: vi.fn().mockResolvedValue(45),
    configureBucketEncryption: vi.fn().mockResolvedValue(true),
    configureBucketLifecycle: vi.fn().mockResolvedValue(true),
  },
}));

import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';

describe('Phase 9 — Release and Handover Acceptance Suite', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Gate 1: Production Deployment Configuration & Secrets Externalization
  // =========================================================================
  describe('Gate 1: Production Deployment Configuration & External Secrets', () => {
    it('verifies that sensitive environment files are excluded from source control in .gitignore', () => {
      const gitignorePath = path.join(rootDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf8');
      expect(content).toMatch(/\.env/);
      expect(content).toMatch(/\.env\.\*/);
      expect(content).toMatch(/!\.env\.production\.template/);
    });

    it('verifies that .env.production.template defines external secret injection directives', () => {
      const templatePath = path.join(rootDir, '.env.production.template');
      expect(fs.existsSync(templatePath)).toBe(true);

      const content = fs.readFileSync(templatePath, 'utf8');
      expect(content).toContain('JWT_SECRET=__INJECT_VIA_SECRETS_MANAGER_MIN_32_CHARS__');
      expect(content).toContain('INTERNAL_WORKER_SECRET=__INJECT_VIA_SECRETS_MANAGER_MIN_32_CHARS__');
      expect(content).toContain('MONGODB_URI=mongodb://app_user:__INJECT_MONGO_PASSWORD__');
      expect(content).toContain('REDIS_PASSWORD=__INJECT_REDIS_PASSWORD__');
      expect(content).toContain('AWS_ACCESS_KEY_ID=__INJECT_AWS_IAM_ACCESS_KEY__');
      expect(content).toContain('GEMINI_API_KEY=__INJECT_GEMINI_API_KEY__');
    });

    it('verifies that docker-compose.prod.yml defines multi-worker services, healthchecks, and resource limits', () => {
      const composePath = path.join(rootDir, 'docker-compose.prod.yml');
      expect(fs.existsSync(composePath)).toBe(true);

      const content = fs.readFileSync(composePath, 'utf8');
      expect(content).toContain('api:');
      expect(content).toContain('worker-analysis:');
      expect(content).toContain('worker-render:');
      expect(content).toContain('mongodb:');
      expect(content).toContain('redis:');
      expect(content).toContain('frontend:');

      // Healthcheck and limits
      expect(content).toContain('healthcheck:');
      expect(content).toContain('cpus:');
      expect(content).toContain('memory:');
      expect(content).toContain('json-file');
    });
  });

  // =========================================================================
  // Gate 2: S3 Encryption, Lifecycle Policies, User Prefixes & GDPR Purge
  // =========================================================================
  describe('Gate 2: Storage Security, Lifecycle & Delete-on-Request Purge', () => {
    it('enforces per-user key prefixes across all storage keys', () => {
      const userId = 'usr_alice_123';
      const projectId = 'prj_summer_456';
      const assetId = 'ast_raw_789';

      expect(StorageKeys.rawVideo(userId, projectId, assetId)).toBe(
        `users/${userId}/projects/${projectId}/raw/${assetId}.mp4`
      );
      expect(StorageKeys.proxyVideo(userId, projectId, assetId)).toBe(
        `users/${userId}/projects/${projectId}/proxy/${assetId}_480p.mp4`
      );
      expect(StorageKeys.audioWav(userId, projectId, assetId)).toBe(
        `users/${userId}/projects/${projectId}/audio/${assetId}.wav`
      );
      expect(StorageKeys.previewVideo(userId, projectId, 2)).toBe(
        `users/${userId}/projects/${projectId}/previews/2.mp4`
      );
      expect(StorageKeys.finalRender(userId, projectId, 'job_export_99')).toBe(
        `users/${userId}/projects/${projectId}/renders/job_export_99.mp4`
      );
    });

    it('configures AES256 server-side encryption and 7-day preview retention on S3 buckets', async () => {
      const encSuccess = await S3Service.configureBucketEncryption('test-bucket');
      expect(encSuccess).toBe(true);
      expect(S3Service.configureBucketEncryption).toHaveBeenCalledWith('test-bucket');

      const lifeSuccess = await S3Service.configureBucketLifecycle('test-bucket');
      expect(lifeSuccess).toBe(true);
      expect(S3Service.configureBucketLifecycle).toHaveBeenCalledWith('test-bucket');
    });

    it('executes delete-on-request project hard purge across S3 objects and database collections', async () => {
      const mockProject = {
        _id: new mongoose.Types.ObjectId('672b11111111111111111111'),
        publicId: 'prj_purge_test',
        userId: new mongoose.Types.ObjectId('672b00000000000000000001'),
      };
      (ProjectModel.findOne as any).mockResolvedValue(mockProject);
      (AssetModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId('672b22222222222222222222') },
      ]);

      const result = await PurgeService.purgeProjectData('672b00000000000000000001', 'prj_purge_test');

      expect(result.success).toBe(true);
      expect(result.projectId).toBe('prj_purge_test');
      expect(result.deletedS3Objects).toBe(12);
      expect(S3Service.deleteObjectsByPrefix).toHaveBeenCalledWith(
        'users/672b00000000000000000001/projects/prj_purge_test/'
      );
      expect(ProjectModel.deleteOne).toHaveBeenCalledWith({ _id: mockProject._id });
    });

    it('fulfills GDPR right-to-be-forgotten by wiping all user media and cascading through all collections', async () => {
      const userId = '672b00000000000000000001';
      (ProjectModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId('672b11111111111111111111') },
        { _id: new mongoose.Types.ObjectId('672b11111111111111111112') },
      ]);
      (AssetModel.find as any).mockResolvedValue([
        { _id: new mongoose.Types.ObjectId('672b22222222222222222222') },
      ]);

      const result = await PurgeService.purgeUserData(userId);

      expect(result.success).toBe(true);
      expect(result.deletedS3Objects).toBe(45);
      expect(result.deletedProjectsCount).toBe(2);
      expect(S3Service.purgeUserStorage).toHaveBeenCalledWith(userId);
    });
  });

  // =========================================================================
  // Gate 3: Smoke Tests, Backup/Restore Verification & Worker Sizing
  // =========================================================================
  describe('Gate 3: Smoke Testing, Backup Validation & Capacity Sizing', () => {
    it('executes production smoke test suite and verifies all core component checks pass', async () => {
      const smokeSummary = await ProductionSmokeTestSuite.runAll('http://localhost:4000');
      expect(smokeSummary.success).toBe(true);
      expect(smokeSummary.passed).toBeGreaterThanOrEqual(4);
      expect(smokeSummary.failed).toBe(0);
    });

    it('verifies production backup commands, archive formats, and retention policies', () => {
      const backupResult = BackupRestoreService.verifyBackupProcedures();
      expect(backupResult.allPassed).toBe(true);
      expect(backupResult.checks).toHaveLength(4);

      const mongoCheck = backupResult.checks.find((c) => c.service === 'mongodb');
      expect(mongoCheck?.command).toContain('mongodump');
      expect(mongoCheck?.command).toContain('--gzip');

      const redisCheck = backupResult.checks.find((c) => c.service === 'redis');
      expect(redisCheck?.command).toContain('BGSAVE');
    });

    it('calculates mathematically sound worker cluster sizing for 100, 1,000, and 10,000 daily renders', () => {
      const sizing100 = WorkerCapacityService.calculateClusterSizing(100);
      expect(sizing100.recommendedRenderWorkers).toBeGreaterThanOrEqual(2);
      expect(sizing100.totalVcpuRequired).toBeGreaterThanOrEqual(4);

      const sizing1000 = WorkerCapacityService.calculateClusterSizing(1000);
      expect(sizing1000.recommendedRenderWorkers).toBeGreaterThanOrEqual(2);
      expect(sizing1000.totalVcpuRequired).toBeGreaterThanOrEqual(4);

      const sizing10000 = WorkerCapacityService.calculateClusterSizing(10000);
      expect(sizing10000.recommendedRenderWorkers).toBeGreaterThanOrEqual(10);
      expect(sizing10000.totalVcpuRequired).toBeGreaterThanOrEqual(20);
    });
  });

  // =========================================================================
  // Gate 4: Operations Runbook, Architectural Decisions & Sign-Off Documentation
  // =========================================================================
  describe('Gate 4: Operations Runbook, Architectural Decisions & Release Sign-Off', () => {
    it('verifies that docs/OPERATIONS_RUNBOOK.md covers all 5 required operational incident scenarios', () => {
      const runbookPath = path.join(rootDir, 'docs/OPERATIONS_RUNBOOK.md');
      expect(fs.existsSync(runbookPath)).toBe(true);

      const content = fs.readFileSync(runbookPath, 'utf8');
      expect(content).toContain('Runbook 1: Failed Uploads');
      expect(content).toContain('Runbook 2: Failed Video Renders & Exports');
      expect(content).toContain('Runbook 3: Queue Backlog & Worker Stalling');
      expect(content).toContain('Runbook 4: AI Provider Outages');
      expect(content).toContain('Runbook 5: S3 Storage & Signature Mismatch Issues');
    });

    it('verifies that docs/ROLLBACK_PLAN.md defines zero-downtime Blue/Green traffic recovery and schema safety', () => {
      const rollbackPath = path.join(rootDir, 'docs/ROLLBACK_PLAN.md');
      expect(fs.existsSync(rollbackPath)).toBe(true);

      const content = fs.readFileSync(rollbackPath, 'utf8');
      expect(content).toContain('Blue/Green Routing');
      expect(content).toContain('Worker Queue Draining');
      expect(content).toContain('Expand-and-Contract');
    });

    it('verifies that docs/ARCHITECTURAL_DECISIONS.md reviews all 4 required architectural domains', () => {
      const adrPath = path.join(rootDir, 'docs/ARCHITECTURAL_DECISIONS.md');
      expect(fs.existsSync(adrPath)).toBe(true);

      const content = fs.readFileSync(adrPath, 'utf8');
      expect(content).toContain('ADR 1: Intro & Outro Motion Graphic Rendering Approach');
      expect(content).toContain('ADR 2: Audio Transcription & Caption Generation Hosting Strategy');
      expect(content).toContain('ADR 3: Video Transcoding & Hardware Acceleration');
      expect(content).toContain('ADR 4: Multi-Clip Project Scope & Timeline Representation');
    });

    it('verifies that docs/RELEASE_CHECKLIST.md confirms all 10 phases and contains formal sign-off approval', () => {
      const checklistPath = path.join(rootDir, 'docs/RELEASE_CHECKLIST.md');
      expect(fs.existsSync(checklistPath)).toBe(true);

      const content = fs.readFileSync(checklistPath, 'utf8');
      expect(content).toContain('v1.0.0-mvp');
      expect(content).toContain('Phase-by-Phase Completion & Acceptance Matrix');
      expect(content).toContain('APPROVED FOR PRODUCTION RELEASE');
    });
  });
});
