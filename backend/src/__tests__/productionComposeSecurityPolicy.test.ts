import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Production Compose & Datastore Security Policy Test Suite (POT-004)
 * 
 * Verifies that production and development Docker Compose configurations:
 * 1. Do not expose datastores (MongoDB, Redis) or direct backend APIs to public network interfaces (0.0.0.0).
 * 2. Enforce strict mandatory credentials with no weak fallback passwords (${VAR:?message}).
 * 3. Restrict administrative host port mappings strictly to loopback (127.0.0.1).
 * 4. Configure authenticated healthchecks for secured datastore containers.
 */
describe('POT-004: Production Compose Datastore Security & Port Isolation Policy', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const prodComposePath = path.join(rootDir, 'docker-compose.prod.yml');
  const devComposePath = path.join(rootDir, 'docker-compose.yml');
  const prodEnvTemplatePath = path.join(rootDir, '.env.production.template');

  it('ensures docker-compose.prod.yml exists and can be parsed', () => {
    expect(fs.existsSync(prodComposePath)).toBe(true);
    const content = fs.readFileSync(prodComposePath, 'utf8');
    expect(content.length).toBeGreaterThan(100);
  });

  describe('MongoDB Security Policy in Production Compose', () => {
    const prodContent = fs.readFileSync(prodComposePath, 'utf8');

    it('prohibits open 0.0.0.0 or un-prefixed port binding for MongoDB', () => {
      // Must not contain bare '27017:27017' or '0.0.0.0:27017:27017'
      expect(prodContent).not.toMatch(/['"](?:0\.0\.0\.0:)?27017:27017['"]/);
      // If ports are declared, must be strictly loopback 127.0.0.1
      expect(prodContent).toMatch(/['"]127\.0\.0\.1:27017:27017['"]/);
    });

    it('enforces mandatory root credentials with no weak default fallbacks', () => {
      // Must set MONGO_INITDB_ROOT_USERNAME
      expect(prodContent).toContain('MONGO_INITDB_ROOT_USERNAME');
      // Must set MONGO_INITDB_ROOT_PASSWORD using mandatory expansion syntax (:?)
      expect(prodContent).toMatch(/MONGO_INITDB_ROOT_PASSWORD=\$\{MONGO_ROOT_PASSWORD:\?[^}]+\}/);
      // Must not allow common insecure default fallbacks
      expect(prodContent).not.toContain('MONGO_ROOT_PASSWORD:-password');
      expect(prodContent).not.toContain('MONGO_ROOT_PASSWORD:-admin');
      expect(prodContent).not.toContain('MONGO_ROOT_PASSWORD:-root');
      expect(prodContent).not.toContain('MONGO_ROOT_PASSWORD:-change_me');
    });

    it('configures authenticated healthcheck for MongoDB replica set', () => {
      // Healthcheck must include credentialed authentication
      expect(prodContent).toContain('MONGO_INITDB_ROOT_PASSWORD');
      expect(prodContent).toContain('--authenticationDatabase admin');
      expect(prodContent).toContain('rs.status().ok');
    });

    it('prohibits hardcoded localhost:27017 replica set member host in production compose (POT-009)', () => {
      // Must not initiate replica set with hardcoded localhost:27017 which breaks inter-container communication
      expect(prodContent).not.toMatch(/members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/);
      // Must support service hostname targetHost defaulting to mongodb:27017
      expect(prodContent).toContain('MONGO_REPLICA_HOST');
      expect(prodContent).toContain('mongodb:27017');
    });
  });

  describe('Redis Security Policy in Production Compose', () => {
    const prodContent = fs.readFileSync(prodComposePath, 'utf8');

    it('prohibits open 0.0.0.0 or un-prefixed port binding for Redis', () => {
      // Must not contain bare '6379:6379' or '0.0.0.0:6379:6379'
      expect(prodContent).not.toMatch(/['"](?:0\.0\.0\.0:)?6379:6379['"]/);
      // If ports are declared, must be strictly loopback 127.0.0.1
      expect(prodContent).toMatch(/['"]127\.0\.0\.1:6379:6379['"]/);
    });

    it('enforces mandatory REDIS_PASSWORD with no weak default fallbacks', () => {
      // Must not contain the deprecated weak fallback
      expect(prodContent).not.toContain('prod_redis_pass_change_me');
      // Must require REDIS_PASSWORD via mandatory syntax
      expect(prodContent).toMatch(/REDIS_PASSWORD=\$\{REDIS_PASSWORD:\?[^}]+\}/);
      // Command requirepass must also require REDIS_PASSWORD
      expect(prodContent).toMatch(/--requirepass['"],\s*['"]\$\{REDIS_PASSWORD:\?[^}]+\}/);
    });

    it('configures authenticated healthcheck for Redis', () => {
      // Redis healthcheck must pass auth password
      expect(prodContent).toMatch(/redis-cli -a "\$\$REDIS_PASSWORD" ping/);
    });
  });

  describe('API & Ingress Security Policy in Production Compose', () => {
    const prodContent = fs.readFileSync(prodComposePath, 'utf8');

    it('restricts direct API server port to loopback interface', () => {
      // Direct API port 4000 must not be exposed to 0.0.0.0
      expect(prodContent).not.toMatch(/['"](?:0\.0\.0\.0:)?4000:4000['"]/);
      // Must bind strictly to 127.0.0.1
      expect(prodContent).toMatch(/['"]127\.0\.0\.1:4000:4000['"]/);
    });

    it('allows only Frontend Nginx reverse proxy to bind public ports 80 and 443', () => {
      // Frontend binds 80 and 443
      expect(prodContent).toMatch(/['"]80:80['"]/);
      expect(prodContent).toMatch(/['"]443:443['"]/);
    });

    it('verifies workers do not publish any host ports', () => {
      // Worker services must not have any 'ports:' blocks
      const workerAnalysisSection = prodContent.split('worker-analysis:')[1]?.split('worker-render:')[0];
      const workerRenderSection = prodContent.split('worker-render:')[1]?.split('mongodb:')[0];

      expect(workerAnalysisSection).toBeDefined();
      expect(workerAnalysisSection).not.toContain('ports:');

      expect(workerRenderSection).toBeDefined();
      expect(workerRenderSection).not.toContain('ports:');
    });
  });

  describe('Development Compose Security Policy', () => {
    const devContent = fs.readFileSync(devComposePath, 'utf8');

    it('restricts development datastores (MongoDB, Redis, LocalStack S3) to 127.0.0.1', () => {
      // MongoDB
      expect(devContent).toMatch(/['"]127\.0\.0\.1:27017:27017['"]/);
      expect(devContent).not.toMatch(/['"](?:0\.0\.0\.0:)?27017:27017['"]/);

      // Redis
      expect(devContent).toMatch(/['"]127\.0\.0\.1:6379:6379['"]/);
      expect(devContent).not.toMatch(/['"](?:0\.0\.0\.0:)?6379:6379['"]/);

      // S3 LocalStack
      expect(devContent).toMatch(/['"]127\.0\.0\.1:4566:4566['"]/);
      expect(devContent).not.toMatch(/['"](?:0\.0\.0\.0:)?4566:4566['"]/);
    });

    it('prohibits hardcoded localhost:27017 replica set member host in development compose (POT-009)', () => {
      // Must not initiate replica set with hardcoded localhost:27017 which breaks inter-container communication
      expect(devContent).not.toMatch(/members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/);
      // Must support service hostname targetHost defaulting to mongodb:27017
      expect(devContent).toContain('MONGO_REPLICA_HOST');
      expect(devContent).toContain('mongodb:27017');
    });
  });

  describe('Production Environment Template Documentation', () => {
    const templateContent = fs.readFileSync(prodEnvTemplatePath, 'utf8');

    it('contains placeholder instructions for MongoDB and Redis secrets', () => {
      expect(templateContent).toContain('MONGO_ROOT_USER=admin');
      expect(templateContent).toContain('MONGO_ROOT_PASSWORD=__INJECT_MONGO_ROOT_PASSWORD__');
      expect(templateContent).toContain('REDIS_PASSWORD=__INJECT_REDIS_PASSWORD__');
      expect(templateContent).not.toContain('prod_redis_pass_change_me');
    });
  });
});
