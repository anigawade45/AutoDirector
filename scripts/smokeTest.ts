export * from '../backend/src/scripts/smokeTest.js';
import { ProductionSmokeTestSuite } from '../backend/src/scripts/smokeTest.js';

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  !process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('smokeTest.ts') || process.argv[1]?.endsWith('smokeTest.js'))
);

if (isDirectEntry) {
  const targetUrl = process.argv[2];
  ProductionSmokeTestSuite.runAll(targetUrl)
    .then((summary) => {
      process.exit(summary.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[SmokeTest] Fatal error during smoke test run:', err);
      process.exit(1);
    });
}
