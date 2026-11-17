import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { envSchema } from '../config/env.js';

/**
 * Production Compose & Datastore Security Policy Test Suite (POT-004 / SEC-006)
 *
 * Verifies that production and development Docker Compose configurations:
 * 1. Do not expose datastores (MongoDB, Redis) or direct backend APIs to public network interfaces (0.0.0.0).
 * 2. Enforce strict mandatory credentials with no weak fallback passwords (${VAR:?message}).
 * 3. Restrict administrative host port mappings strictly to loopback (127.0.0.1) and declare internal expose ports.
 * 4. Configure authenticated healthchecks for secured datastore containers without unauthenticated fallbacks.
 * 5. Enforce tiered private networking: isolated internal datastore network (internal: true) preventing public egress and frontend direct access.
 * 6. Enforce startup fail-fast validation against weak or default placeholder database/cache credentials.
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

    it('configures authenticated healthcheck for MongoDB replica set without unauthenticated fallback (SEC-006)', () => {
      // Healthcheck must include credentialed authentication
      expect(prodContent).toContain('MONGO_INITDB_ROOT_PASSWORD');
      expect(prodContent).toContain('--authenticationDatabase admin');
      expect(prodContent).toContain('rs.status().ok');
      // Must not contain any unauthenticated mongosh fallback (|| mongosh ...)
      expect(prodContent).not.toMatch(/\|\|\s*mongosh/);
    });

    it('attaches MongoDB strictly to datastore_net and isolates from frontend_net (SEC-006)', () => {
      const mongoSection = prodContent.split('\n  mongodb:\n')[1]?.split('\n  redis:\n')[0];
      expect(mongoSection).toBeDefined();
      expect(mongoSection).toContain('- datastore_net');
      expect(mongoSection).not.toContain('frontend_net');
      expect(mongoSection).toContain("expose:\n      - '27017'");
    });

    it('prohibits hardcoded localhost:27017 replica set member host in production compose (POT-009)', () => {
      // Must not initiate replica set with hardcoded localhost:27017 which breaks inter-container communication
      expect(prodContent).not.toMatch(
        /members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/
      );
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

    it('enforces protected-mode and attaches Redis strictly to datastore_net (SEC-006)', () => {
      const redisSection = prodContent.split('\n  redis:\n')[1]?.split('\n  frontend:\n')[0];
      expect(redisSection).toBeDefined();
      expect(redisSection).toContain('--protected-mode');
      expect(redisSection).toContain('- datastore_net');
      expect(redisSection).not.toContain('frontend_net');
      expect(redisSection).toContain("expose:\n      - '6379'");
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
      const workerAnalysisSection = prodContent
        .split('worker-analysis:')[1]
        ?.split('worker-render:')[0];
      const workerRenderSection = prodContent.split('worker-render:')[1]?.split('mongodb:')[0];

      expect(workerAnalysisSection).toBeDefined();
      expect(workerAnalysisSection).not.toContain('ports:');

      expect(workerRenderSection).toBeDefined();
      expect(workerRenderSection).not.toContain('ports:');
    });

    it('verifies Nginx reverse proxy blocks public ingress to internal endpoints with HTTP 403 (SEC-002)', () => {
      const nginxConfPath = path.join(rootDir, 'frontend/nginx.conf');
      expect(fs.existsSync(nginxConfPath)).toBe(true);
      const nginxContent = fs.readFileSync(nginxConfPath, 'utf8');

      expect(nginxContent).toMatch(/location\s+\^\~\s+\/api\/internal\//);
      expect(nginxContent).toContain('return 403');
      expect(nginxContent).toContain('Direct access to internal endpoints is prohibited');
    });

    it('verifies frontend service attaches only to frontend_net and cannot access datastore_net (SEC-006)', () => {
      const frontendSection = prodContent.split('\n  frontend:\n')[1]?.split('\nvolumes:\n')[0];
      expect(frontendSection).toBeDefined();
      expect(frontendSection).toContain('- frontend_net');
      expect(frontendSection).not.toContain('datastore_net');
      expect(frontendSection).not.toContain('backend_net');
    });
  });

  describe('Tiered Private Networking & Datastore Isolation (SEC-006)', () => {
    const prodContent = fs.readFileSync(prodComposePath, 'utf8');

    it('defines explicit segmented networks for frontend, backend, and datastores', () => {
      expect(prodContent).toContain('networks:');
      expect(prodContent).toContain('frontend_net:');
      expect(prodContent).toContain('backend_net:');
      expect(prodContent).toContain('datastore_net:');
    });

    it('marks datastore_net as internal: true to block public internet egress/ingress', () => {
      const networksSection =
        prodContent.split('networks:')[prodContent.split('networks:').length - 1];
      expect(networksSection).toBeDefined();
      expect(networksSection).toContain('datastore_net:');
      expect(networksSection).toContain('internal: true');
    });

    it('bridges API service across frontend, backend, and datastore networks', () => {
      const apiSection = prodContent.split('\n  api:\n')[1]?.split('\n  worker-analysis:\n')[0];
      expect(apiSection).toBeDefined();
      expect(apiSection).toContain('- frontend_net');
      expect(apiSection).toContain('- backend_net');
      expect(apiSection).toContain('- datastore_net');
    });

    it('attaches background workers strictly to backend and datastore networks', () => {
      const analysisSection = prodContent.split('worker-analysis:')[1]?.split('worker-render:')[0];
      expect(analysisSection).toBeDefined();
      expect(analysisSection).toContain('- backend_net');
      expect(analysisSection).toContain('- datastore_net');
      expect(analysisSection).not.toContain('frontend_net');

      const renderSection = prodContent.split('worker-render:')[1]?.split('mongodb:')[0];
      expect(renderSection).toBeDefined();
      expect(renderSection).toContain('- backend_net');
      expect(renderSection).toContain('- datastore_net');
      expect(renderSection).not.toContain('frontend_net');
    });
  });

  describe('Datastore Credentials Hygiene & Startup Validation (SEC-006)', () => {
    const baseValidProdEnv = {
      PORT: '4000',
      NODE_ENV: 'production' as const,
      API_BASE_URL: 'https://api.studio.ai/api',
      CORS_ORIGIN: 'https://studio.ai',
      JWT_SECRET: 'super-secure-production-jwt-secret-key-12345',
      INTERNAL_WORKER_SECRET: 'super-secure-worker-secret-key-12345',
      MONGODB_URI:
        'mongodb://app_user:verified_strong_mongo_pass@mongodb:27017/ai_video_prod?replicaSet=rs0&authSource=admin',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'verified_strong_redis_password_98765',
      AWS_ACCESS_KEY_ID: 'AKIA_PROD_12345',
      AWS_SECRET_ACCESS_KEY: 'secret_key_prod_12345',
      S3_BUCKET_NAME: 'prod-bucket',
    };

    it('accepts strong production datastore credentials', () => {
      const result = envSchema.safeParse(baseValidProdEnv);
      expect(result.success).toBe(true);
    });

    it('rejects deprecated weak default Redis password in production mode', () => {
      const result = envSchema.safeParse({
        ...baseValidProdEnv,
        REDIS_PASSWORD: 'prod_redis_pass_change_me',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('REDIS_PASSWORD'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain(
          'REDIS_PASSWORD is weak or uses a default placeholder in production'
        );
      }
    });

    it('rejects trivial or placeholder Redis passwords in production', () => {
      for (const weakPass of ['password', 'admin', '123456', '__INJECT_REDIS_PASSWORD__']) {
        const result = envSchema.safeParse({
          ...baseValidProdEnv,
          REDIS_PASSWORD: weakPass,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues.find((i) => i.path.includes('REDIS_PASSWORD'));
          expect(issue).toBeDefined();
        }
      }
    });

    it('rejects placeholder or default MongoDB credentials in production', () => {
      const resultPlaceholder = envSchema.safeParse({
        ...baseValidProdEnv,
        MONGODB_URI:
          'mongodb://app_user:__INJECT_MONGO_PASSWORD__@mongodb:27017/prod?replicaSet=rs0',
      });
      expect(resultPlaceholder.success).toBe(false);
      if (!resultPlaceholder.success) {
        const issue = resultPlaceholder.error.issues.find((i) => i.path.includes('MONGODB_URI'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain(
          'MONGODB_URI contains placeholder or weak default credentials in production'
        );
      }

      const resultDefaultPass = envSchema.safeParse({
        ...baseValidProdEnv,
        MONGODB_URI: 'mongodb://admin:password@mongodb:27017/prod?replicaSet=rs0',
      });
      expect(resultDefaultPass.success).toBe(false);
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
      expect(devContent).not.toMatch(
        /members:\s*\[\{\s*_id:\s*0,\s*host:\s*['"]localhost:27017['"]\s*\}\]/
      );
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
