import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('CI/CD Pipeline Quality Gate Policy Verification (BUG-010)', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');

  it('verifies that .github/workflows/ci.yml exists and is readable', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true);
  });

  it('strictly prohibits continue-on-error: true anywhere in the CI workflow', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // Asserts no continue-on-error directive exists in the entire workflow
    expect(content).not.toMatch(/continue-on-error\s*:\s*true/i);
    expect(content).not.toMatch(/continue-on-error\s*:\s*['"]?true['"]?/i);
  });

  it('enforces blocking quality gates for both backend and frontend test suites', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // Both backend and frontend test steps must be defined
    expect(content).toContain('name: Run Backend Tests');
    expect(content).toContain('run: npm --workspace=backend run test');

    expect(content).toContain('name: Run Frontend Tests');
    expect(content).toContain('run: npm --workspace=frontend run test');

    // Verify step definitions do not include continue-on-error
    const lines = content.split('\n');
    let insideBackendTestStep = false;
    let insideFrontendTestStep = false;

    for (const line of lines) {
      if (line.includes('name: Run Backend Tests')) {
        insideBackendTestStep = true;
        insideFrontendTestStep = false;
      } else if (line.includes('name: Run Frontend Tests')) {
        insideBackendTestStep = false;
        insideFrontendTestStep = true;
      } else if (line.trim().startsWith('- name:')) {
        insideBackendTestStep = false;
        insideFrontendTestStep = false;
      }

      if (insideBackendTestStep || insideFrontendTestStep) {
        expect(line.toLowerCase()).not.toContain('continue-on-error');
      }
    }
  });

  it('triggers on pull requests and pushes to protected branches', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    expect(content).toContain('push:');
    expect(content).toContain('pull_request:');
    expect(content).toContain('main');
    expect(content).toContain('master');
  });

  it('ensures type-checking and builds precede test execution in the pipeline', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    const backendBuildIndex = content.indexOf('run: npm run build:backend');
    const frontendBuildIndex = content.indexOf('run: npm run build:frontend');
    const backendTestIndex = content.indexOf('run: npm --workspace=backend run test');
    const frontendTestIndex = content.indexOf('run: npm --workspace=frontend run test');

    expect(backendBuildIndex).toBeGreaterThan(-1);
    expect(frontendBuildIndex).toBeGreaterThan(-1);
    expect(backendTestIndex).toBeGreaterThan(-1);
    expect(frontendTestIndex).toBeGreaterThan(-1);

    expect(backendBuildIndex).toBeLessThan(backendTestIndex);
    expect(frontendBuildIndex).toBeLessThan(frontendTestIndex);
  });
});
