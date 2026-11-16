export * from '../backend/src/scripts/backupRestore.js';
import { BackupRestoreService } from '../backend/src/scripts/backupRestore.js';

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  !process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('backupRestore.ts') || process.argv[1]?.endsWith('backupRestore.js'))
);

if (isDirectEntry) {
  const result = BackupRestoreService.verifyBackupProcedures();
  console.log(
    '[BackupRestore] DR Procedure Plan & Readiness Specification (ESTIMATED / UNVERIFIED):'
  );
  console.log(
    'NOTE: Procedures reflect documented operational runbook commands. Runtime DR execution remains UNVERIFIED without injected snapshot evidence or active target verification.\n'
  );
  console.table(result.checks);
  process.exit(result.specificationValid ? 0 : 1);
}
