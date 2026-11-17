import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MongoReplicaSetValidator } from '../scripts/validateMongoReplicaSet.js';

describe('POT-009: MongoDB Replica Set Topology & Compose Member Host Validation', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const devComposePath = path.join(rootDir, 'docker-compose.yml');
  const prodComposePath = path.join(rootDir, 'docker-compose.prod.yml');
  const prodEnvTemplatePath = path.join(rootDir, '.env.production.template');

  describe('1. Docker Compose Manifest Hardening (POT-009)', () => {
    it('ensures development docker-compose.yml advertises mongodb:27017 instead of hardcoded localhost:27017', () => {
      const devContent = fs.readFileSync(devComposePath, 'utf8');

      // Must not initiate replica set with hardcoded localhost:27017
      expect(devContent).not.toMatch(/members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/);

      // Must specify MONGO_REPLICA_HOST defaulting to mongodb:27017
      expect(devContent).toContain('MONGO_REPLICA_HOST=${MONGO_REPLICA_HOST:-mongodb:27017}');
      expect(devContent).toContain("targetHost = (typeof process !== 'undefined' && process.env && process.env.MONGO_REPLICA_HOST) || 'mongodb:27017'");

      // Must include automatic reconfig migration for existing volumes
      expect(devContent).toContain("cfg.members[0].host === 'localhost:27017'");
      expect(devContent).toContain('rs.reconfig(cfg)');
    });

    it('ensures production docker-compose.prod.yml advertises mongodb:27017 instead of hardcoded localhost:27017', () => {
      const prodContent = fs.readFileSync(prodComposePath, 'utf8');

      // Must not initiate replica set with hardcoded localhost:27017
      expect(prodContent).not.toMatch(/members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/);

      // Must specify MONGO_REPLICA_HOST defaulting to mongodb:27017
      expect(prodContent).toContain('MONGO_REPLICA_HOST=${MONGO_REPLICA_HOST:-mongodb:27017}');
      expect(prodContent).toContain("targetHost = (typeof process !== 'undefined' && process.env && process.env.MONGO_REPLICA_HOST) || 'mongodb:27017'");

      // Must include automatic reconfig migration for existing volumes
      expect(prodContent).toContain("cfg.members[0].host === 'localhost:27017'");
      expect(prodContent).toContain('rs.reconfig(cfg)');
    });

    it('ensures .env.production.template configures MONGODB_URI targeting mongodb:27017 on the Docker network', () => {
      const templateContent = fs.readFileSync(prodEnvTemplatePath, 'utf8');
      expect(templateContent).toContain('@mongodb:27017/ai_video_prod?replicaSet=rs0');
    });
  });

  describe('2. MongoReplicaSetValidator Automated Diagnostic Suite', () => {
    it('validates healthy replica set with primary mongodb:27017 and multi-document transactions', async () => {
      const mockDbAdmin = {
        command: vi.fn().mockResolvedValue({
          ok: 1,
          set: 'rs0',
          members: [
            {
              _id: 0,
              name: 'mongodb:27017',
              stateStr: 'PRIMARY',
              health: 1,
            },
          ],
        }),
      };

      const mockSession = {
        startTransaction: vi.fn(),
        abortTransaction: vi.fn(),
      };

      const result = await MongoReplicaSetValidator.validate({
        expectedReplSetName: 'rs0',
        expectedMemberHost: 'mongodb:27017',
        mockDbAdmin,
        mockSession,
      });

      expect(result.success).toBe(true);
      expect(result.setName).toBe('rs0');
      expect(result.primary).toBe('mongodb:27017');
      expect(result.members.length).toBe(1);
      expect(result.transactionsSupported).toBe(true);
      expect(result.message).toContain("Replica set 'rs0' healthy");
    });

    it('detects and flags POT-009 localhost member host in container/networked context', async () => {
      const mockDbAdmin = {
        command: vi.fn().mockResolvedValue({
          ok: 1,
          set: 'rs0',
          members: [
            {
              _id: 0,
              name: 'localhost:27017',
              stateStr: 'PRIMARY',
              health: 1,
            },
          ],
        }),
      };

      const result = await MongoReplicaSetValidator.validate({
        expectedReplSetName: 'rs0',
        prohibitLocalhostFromContainer: true,
        mockDbAdmin,
      });

      expect(result.success).toBe(false);
      expect(result.primary).toBe('localhost:27017');
      expect(result.message).toContain('POT-009 Detected: Primary member host advertised as');
      expect(result.message).toContain("Other containers cannot resolve 'localhost'");
    });

    it('detects and flags replica set name mismatch', async () => {
      const mockDbAdmin = {
        command: vi.fn().mockResolvedValue({
          ok: 1,
          set: 'wrong_replica_set',
          members: [
            {
              _id: 0,
              name: 'mongodb:27017',
              stateStr: 'PRIMARY',
              health: 1,
            },
          ],
        }),
      };

      const result = await MongoReplicaSetValidator.validate({
        expectedReplSetName: 'rs0',
        mockDbAdmin,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Replica set name mismatch: expected 'rs0', got 'wrong_replica_set'");
    });

    it('detects when MongoDB is running in standalone mode (not a replica set)', async () => {
      const mockDbAdmin = {
        command: vi.fn().mockRejectedValue(new Error('not running with --replSet')),
      };

      const result = await MongoReplicaSetValidator.validate({
        mockDbAdmin,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('MongoDB server is not running as a replica set');
    });

    it('detects when expected member host does not match advertised host', async () => {
      const mockDbAdmin = {
        command: vi.fn().mockResolvedValue({
          ok: 1,
          set: 'rs0',
          members: [
            {
              _id: 0,
              name: 'other-host:27017',
              stateStr: 'PRIMARY',
              health: 1,
            },
          ],
        }),
      };

      const result = await MongoReplicaSetValidator.validate({
        expectedMemberHost: 'mongodb:27017',
        mockDbAdmin,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Primary member host 'other-host:27017' does not match expected 'mongodb:27017'");
    });
  });
});
