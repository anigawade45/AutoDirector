export * from '../backend/src/scripts/workerCapacityCheck.js';
import { WorkerCapacityService } from '../backend/src/scripts/workerCapacityCheck.js';

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  !process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('workerCapacityCheck.ts') ||
    process.argv[1]?.endsWith('workerCapacityCheck.js'))
);

if (isDirectEntry) {
  console.log(
    '[WorkerCapacityCheck] Worker Cluster Sizing Planner (ESTIMATED / THEORETICAL MODEL):'
  );
  console.log(
    'NOTE: Sizing outputs are theoretical capacity models based on baseline FFmpeg benchmarks and simulated traffic distributions. Actual production cluster performance requires real-time queue telemetry.\n'
  );
  const tiers = [100, 1000, 10000];
  for (const t of tiers) {
    console.log(`\n--- Estimated Sizing for ${t} Daily Renders (SIMULATED) ---`);
    console.table(WorkerCapacityService.calculateClusterSizing(t));
  }
}
