import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { redisConnection } from '../config/redis.js';
import { S3Service } from '../services/storage/s3Service.js';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { analysisQueue, previewQueue } from '../services/queue/queueService.js';
import { startAnalysisWorker } from '../workers/analysisWorker.js';
import { startRenderWorker } from '../workers/renderWorker.js';
import { nanoid } from 'nanoid';
import mongoose from 'mongoose';

async function runEndToEndWorkerVerification() {
  console.log('\n=============================================================');
  console.log('🧪 VERIFYING STANDALONE DECOUPLED WORKER ARCHITECTURE');
  console.log('=============================================================\n');

  // Step 1: Connect dependencies
  console.log('[Step 1] Connecting to MongoDB, Redis and S3...');
  await connectDatabase();
  await redisConnection.ping();
  await S3Service.ensureBucketExists();
  console.log('✓ All infrastructure dependencies connected.\n');

  // Step 2: Start Standalone Workers Independently
  console.log('[Step 2] Launching Standalone Analysis & Render Workers...');
  const analysisWorker = startAnalysisWorker();
  const previewWorker = startRenderWorker('preview');
  console.log('✓ Standalone AnalysisWorker initialized on queue "analysis"');
  console.log('✓ Standalone PreviewWorker initialized on queue "preview"\n');

  // Step 3: Create real test project and asset using an existing S3 video
  console.log('[Step 3] Creating test project & asset in MongoDB...');
  const testUserId = new mongoose.Types.ObjectId();
  const testProject = await ProjectModel.create({
    publicId: `prj_test_${nanoid(6)}`,
    userId: testUserId,
    title: 'Decoupled Worker Verification Project',
    status: 'draft',
    headVersion: 0,
    settings: { aspect: '16:9', fps: 30, width: 1920, height: 1080 },
  });

  // Use the verified S3 video uploaded earlier
  const existingS3Key = 'users/6aebf86cd37ab6c48f44c3c7/projects/prj_1qeXwqsG/raw/ast_Yj57e4ETQa.mp4';
  const testAsset = await AssetModel.create({
    publicId: `ast_test_${nanoid(6)}`,
    projectId: testProject._id,
    userId: testUserId,
    kind: 'video',
    source: 'upload',
    s3: {
      bucket: 'ai-video-editing-platform',
      rawKey: existingS3Key,
    },
    status: 'processing',
  });

  testProject.baseAssetId = testAsset._id as any;
  await testProject.save();
  console.log(`✓ Test project '${testProject.publicId}' created with asset '${testAsset.publicId}'\n`);

  // Step 4: Submit real Analysis Job to BullMQ
  console.log('[Step 4] Enqueueing real BullMQ analysis job...');
  const analysisJobDoc = await RenderJobModel.create({
    projectId: testProject._id,
    userId: testUserId,
    timelineVersion: 0,
    type: 'analysis',
    profile: 'preview_480p',
    state: 'queued',
    percent: 0,
    timings: { queuedAt: new Date() },
  });

  const bullAnalysisJob = await analysisQueue.add('analyze', {
    jobId: analysisJobDoc._id.toString(),
    projectId: testProject.publicId,
    assetId: testAsset.publicId,
    rawKey: existingS3Key,
    userId: testUserId.toString(),
  });
  console.log(`✓ Job enqueued to BullMQ (BullId: ${bullAnalysisJob.id}, JobDocId: ${analysisJobDoc._id})`);
  console.log('  Waiting for standalone AnalysisWorker to consume and complete pipeline...');

  // Poll for completion (timeout: 45s)
  const startTime = Date.now();
  let analysisCompleted = false;

  while (Date.now() - startTime < 45000) {
    await new Promise((r) => setTimeout(r, 1500));
    const currentJob = await RenderJobModel.findById(analysisJobDoc._id);
    if (currentJob?.state === 'processing') {
      console.log(`  [AnalysisWorker] Processing: ${currentJob.percent}%`);
    } else if (currentJob?.state === 'completed') {
      console.log(`  [AnalysisWorker] Completed: 100%!`);
      analysisCompleted = true;
      break;
    } else if (currentJob?.state === 'failed') {
      throw new Error(`Analysis worker reported failure: ${JSON.stringify(currentJob.error)}`);
    }
  }

  if (!analysisCompleted) {
    throw new Error('Timeout waiting for AnalysisWorker to complete job');
  }

  // Step 5: Verify MongoDB persistence & S3 proxy creation
  console.log('\n[Step 5] Verifying MongoDB persistence & generated assets...');
  const updatedAsset = await AssetModel.findById(testAsset._id);
  const analysisResult = await AnalysisResultModel.findOne({ assetId: testAsset._id });
  const updatedProject = await ProjectModel.findById(testProject._id);

  console.log(`✓ Asset Media Duration: ${updatedAsset?.media?.durationMs}ms`);
  console.log(`✓ Asset Resolution: ${updatedAsset?.media?.width}x${updatedAsset?.media?.height} @ ${updatedAsset?.media?.fps}fps`);
  console.log(`✓ Proxy Key generated: ${updatedAsset?.s3?.proxyKey}`);
  console.log(`✓ Audio Key generated: ${updatedAsset?.s3?.audioKey}`);
  console.log(`✓ Silence Intervals detected: ${analysisResult?.silences?.length}`);
  console.log(`✓ Scene Cuts detected: ${analysisResult?.sceneCuts?.length}`);
  console.log(`✓ Project Status updated to: '${updatedProject?.status}'`);

  if (!updatedAsset?.s3?.proxyKey || !analysisResult || updatedProject?.status !== 'ready') {
    throw new Error('Analysis persistence assertion failed');
  }

  // Step 6: Submit real Preview Render Job to BullMQ
  console.log('\n[Step 6] Enqueueing real BullMQ preview render job...');
  const samplePlanDoc = await EditPlanModel.create({
    projectId: testProject._id,
    version: 1,
    prompt: 'Worker test',
    model: 'test',
    plan: {
      schemaVersion: '1.0',
      projectId: testProject.publicId,
      baseAssetId: testAsset.publicId,
      version: 1,
      parentVersion: null,
      global: { aspect: '16:9', fps: 30, resolution: '1080p' },
      layers: [
        {
          id: 'lyr_c1',
          layer: 'color',
          enabled: true,
          timebase: 'global',
          params: { preset: 'cinematic', contrast: 1.15, saturation: 0.95 },
        },
      ],
      meta: { prompt: 'Worker test', model: 'test', createdAt: new Date().toISOString() },
    },
  });

  const renderJobDoc = await RenderJobModel.create({
    projectId: testProject._id,
    userId: testUserId,
    timelineVersion: 1,
    type: 'preview',
    profile: 'preview_480p',
    state: 'queued',
    percent: 0,
    timings: { queuedAt: new Date() },
  });

  const bullRenderJob = await previewQueue.add('preview', {
    jobId: renderJobDoc._id.toString(),
    projectId: testProject.publicId,
    planVersion: 1,
    type: 'preview',
    profile: 'preview_480p',
  });
  console.log(`✓ Job enqueued to BullMQ previewQueue (BullId: ${bullRenderJob.id})`);
  console.log('  Waiting for standalone PreviewWorker to consume and render...');

  const renderStartTime = Date.now();
  let renderCompleted = false;

  while (Date.now() - renderStartTime < 45000) {
    await new Promise((r) => setTimeout(r, 1500));
    const currentJob = await RenderJobModel.findById(renderJobDoc._id);
    if (currentJob?.state === 'processing') {
      console.log(`  [RenderWorker:preview] Processing: ${currentJob.percent}%`);
    } else if (currentJob?.state === 'completed') {
      console.log(`  [RenderWorker:preview] Completed: 100%! Output key: ${currentJob.output?.key}`);
      renderCompleted = true;
      break;
    } else if (currentJob?.state === 'failed') {
      throw new Error(`Render worker reported failure: ${JSON.stringify(currentJob.error)}`);
    }
  }

  if (!renderCompleted) {
    throw new Error('Timeout waiting for RenderWorker to complete job');
  }

  // Step 7: Verify Graceful Shutdown
  console.log('\n[Step 7] Testing Graceful Shutdown of Standalone Workers...');
  await analysisWorker.close();
  console.log('✓ AnalysisWorker closed cleanly');
  await previewWorker.close();
  console.log('✓ PreviewWorker closed cleanly');
  await disconnectDatabase();
  console.log('✓ MongoDB disconnected cleanly');
  redisConnection.disconnect();
  console.log('✓ Redis disconnected cleanly');

  console.log('\n=============================================================');
  console.log('🎉 STANDALONE DECOUPLED WORKER VERIFICATION: 100% SUCCESSFUL!');
  console.log('=============================================================\n');
}

runEndToEndWorkerVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
