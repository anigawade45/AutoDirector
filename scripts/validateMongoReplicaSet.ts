export * from '../backend/src/scripts/validateMongoReplicaSet.js';
import { MongoReplicaSetValidator } from '../backend/src/scripts/validateMongoReplicaSet.js';

// Auto-run if executed directly via CLI
const isDirectEntry = Boolean(
  !process.argv[1]?.includes('backend') &&
  (process.argv[1]?.endsWith('validateMongoReplicaSet.ts') || process.argv[1]?.endsWith('validateMongoReplicaSet.js'))
);

if (isDirectEntry) {
  const customUri = process.argv[2];
  const expectedHost = process.argv[3];
  MongoReplicaSetValidator.validate({
    mongoUri: customUri,
    expectedMemberHost: expectedHost,
    prohibitLocalhostFromContainer: process.env.CONTAINER_MODE === 'true',
  })
    .then((result) => {
      console.log(`\n================ MONGO REPLICA SET VALIDATION ================`);
      console.log(`Status: ${result.success ? 'PASSED' : 'FAILED'}`);
      console.log(`Set Name: ${result.setName || 'N/A'}`);
      console.log(`Primary Host: ${result.primary || 'N/A'}`);
      console.log(`Transactions Supported: ${result.transactionsSupported}`);
      console.log(`Details: ${result.message}`);
      console.log(`==============================================================\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ReplicaSetValidator] Fatal error during execution:', err);
      process.exit(1);
    });
}
