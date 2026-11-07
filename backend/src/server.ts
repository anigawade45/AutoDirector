import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { redisConnection } from './config/redis.js';
import { S3Service } from './services/storage/s3Service.js';
import { MaintenanceService } from './services/maintenance/maintenanceService.js';
import { startAnalysisWorker } from './workers/analysisWorker.js';
import { startRenderWorker } from './workers/renderWorker.js';

async function bootstrap() {
  console.log('--- Starting AI-Native Video Creation Platform API ---');

  // 1. Connect to MongoDB
  try {
    await connectDatabase();
  } catch (err) {
    console.warn('[Warning] MongoDB connection deferred or failed. Ensure local Mongo is running.');
  }

  // 2. Verify Redis connection
  try {
    await redisConnection.ping();
    console.log('[Redis] Connected successfully');
  } catch (err) {
    console.warn('[Warning] Redis connection deferred or failed. Ensure local Redis is running.');
  }

  // 3. Ensure S3 Bucket exists and configure CORS
  try {
    await S3Service.ensureBucketExists();
  } catch (err: any) {
    console.warn('[Warning] S3 connection deferred or failed. Ensure MinIO/S3 is running.');
  }

  // 4. Initialize Express application
  const app = createApp();

  // 5. In development mode, run workers in-process for single-command developer workflow (can be disabled via ENABLE_IN_PROCESS_WORKERS=false)
  if (env.NODE_ENV === 'development' && process.env.ENABLE_IN_PROCESS_WORKERS !== 'false') {
    startAnalysisWorker();
    startRenderWorker('preview');
    startRenderWorker('render');
    console.log('[Workers] In-process BullMQ analysis and render workers started.');
  } else {
    console.log('[Workers] In-process workers disabled (standalone worker architecture active).');
  }

  const server = app.listen(env.PORT, () => {
    console.log(`[API Server] Running on http://localhost:${env.PORT}`);
    console.log(`[API Server] Base endpoint: http://localhost:${env.PORT}/api`);
  });

  // 6. Start scheduled background maintenance (cleans abandoned S3 multipart uploads)
  MaintenanceService.startMaintenanceScheduler();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[API Server] Shutting down gracefully...');
    MaintenanceService.stopMaintenanceScheduler();
    server.close();
    await disconnectDatabase();
    redisConnection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Fatal Error] Failed to bootstrap application:', err);
  process.exit(1);
});

