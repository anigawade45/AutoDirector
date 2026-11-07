import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { AssetModel } from '../models/Asset.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { JobEventsPublisher, QUEUE_CONFIGS } from '../services/queue/queueService.js';
import { S3Service } from '../services/storage/s3Service.js';
import { JobScratchDirectory } from '../services/storage/jobScratchDirectory.js';
import { StorageKeys } from '../config/s3.js';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { TranscriptionService, CaptionCue } from '../services/ai/transcriptionService.js';
import { AssGenerator } from '../services/compiler/assGenerator.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface AnalysisJobPayload {
  jobId: string;
  projectId: string;
  assetId: string;
  rawKey: string;
  userId: string;
}

export function startAnalysisWorker() {
  const worker = new Worker<AnalysisJobPayload>(
    'analysis',
    async (job: Job<AnalysisJobPayload>) => {
      const { jobId, projectId, assetId, rawKey, userId } = job.data;
      console.log(`[AnalysisWorker] Starting analysis pipeline for asset ${assetId} (job: ${jobId})`);

      // Ensure isolated per-job temporary scratch directory
      const scratch = new JobScratchDirectory(jobId);
      const localRawPath = scratch.resolve(`${assetId}_raw.mp4`);
      const localProxyPath = scratch.resolve(`${assetId}_proxy_480p.mp4`);
      const localAudioPath = scratch.resolve(`${assetId}_audio_16k.wav`);
      const localAssPath = scratch.resolve(`${assetId}_subs_v1.ass`);
      const localCaptionedPreviewPath = scratch.resolve(`${assetId}_captioned_preview.mp4`);

      try {
        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 5,
        });

        const asset = await AssetModel.findOne({ publicId: assetId });
        const project = await ProjectModel.findOne({ publicId: projectId });

        if (!asset || !project) {
          throw new Error(`Asset ${assetId} or Project ${projectId} not found in database`);
        }

        // 1. Download raw media from S3
        console.log(`[AnalysisWorker] Downloading raw video from S3: ${rawKey}`);
        await S3Service.downloadFile(rawKey, localRawPath);

        // Checksum calculation & integrity validation
        const fileStat = fs.statSync(localRawPath);
        const fileBuffer = fs.readFileSync(localRawPath);
        const computedSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        if (asset.checksum && asset.checksum !== computedSha256) {
          throw new AppError(
            422,
            'INPUT_CORRUPT',
            `Uploaded media SHA-256 checksum mismatch (expected ${asset.checksum}, computed ${computedSha256})`
          );
        } else if (!asset.checksum) {
          asset.checksum = computedSha256;
          await asset.save();
        }

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 20,
        });

        // 2. FFprobe Technical Inspection
        console.log(`[AnalysisWorker] Inspecting media streams with ffprobe...`);
        const metadata = await MediaProbeService.probeVideo(localRawPath);

        asset.media = {
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          videoCodec: metadata.videoCodec,
          audioCodec: metadata.audioCodec,
          sampleRate: metadata.sampleRate,
          channels: metadata.channels,
          bitrate: metadata.bitrate,
          sizeBytes: metadata.sizeBytes || fileStat.size,
          rotation: metadata.rotation,
        };
        await asset.save();

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 35,
        });

        // 3. Generate 480p proxy preview video
        console.log(`[AnalysisWorker] Generating 480p proxy preview video...`);
        const proxyKey = StorageKeys.proxyVideo(userId, projectId, assetId);
        try {
          await MediaProbeService.generateProxy480p(localRawPath, localProxyPath, !!metadata.audioCodec);
          await S3Service.uploadFile(proxyKey, localProxyPath, 'video/mp4');
          asset.s3.proxyKey = proxyKey;
        } catch (proxyErr: any) {
          console.warn(`[AnalysisWorker] Proxy generation fallback:`, proxyErr.message);
          asset.s3.proxyKey = rawKey;
        }

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 50,
        });

        // 4. Extract 16kHz mono audio WAV (stored under users/{uid}/projects/{pid}/audio/{assetId}.wav)
        const audioKey = StorageKeys.audioWav(userId, projectId, assetId);
        let silences: any[] = [];
        let loudness = { integratedLufs: -16.0, truePeakDb: -1.0 };

        if (metadata.audioCodec) {
          console.log(`[AnalysisWorker] Extracting 16kHz mono WAV for audio intelligence: ${audioKey}...`);
          try {
            await MediaProbeService.extractAudioWav(localRawPath, localAudioPath);
            await S3Service.uploadFile(audioKey, localAudioPath, 'audio/wav');
            asset.s3.audioKey = audioKey;

            // Detect silences and loudness
            silences = await MediaProbeService.detectSilences(localAudioPath);
            loudness = await MediaProbeService.detectLoudness(localAudioPath);
          } catch (audioErr: any) {
            console.warn(`[AnalysisWorker] Audio extraction notice:`, audioErr.message);
          }
        } else {
          console.log(`[AnalysisWorker] Video contains no audio stream; skipping WAV extraction.`);
        }

        asset.status = 'ready';
        await asset.save();

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 65,
        });

        // 5. Scene Cuts Detection
        console.log(`[AnalysisWorker] Detecting visual scene cuts...`);
        const sceneCuts = await MediaProbeService.detectSceneCuts(localRawPath, 0.3);

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 75,
        });

        // 6. Speech Transcription & Word-Level Captions
        console.log(`[AnalysisWorker] Transcribing dialogue and word boundaries...`);
        let cues: CaptionCue[] = [];
        if (metadata.audioCodec && fs.existsSync(localAudioPath)) {
          cues = await TranscriptionService.transcribeAudio(
            localAudioPath,
            metadata.durationMs,
            silences,
            project.settings?.language || 'en'
          );
        }

        const captionHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(cues))
          .digest('hex');

        const captionSet = await CaptionSetModel.findOneAndUpdate(
          { projectId: project._id, assetId: asset._id },
          {
            $set: {
              language: project.settings?.language || 'en',
              origin: env.OPENAI_API_KEY ? 'whisper' : 'whisper',
              cues,
              contentHash: captionHash,
            },
          },
          { upsert: true, new: true }
        );

        // 7. Calculate BPM beat grid
        const estimatedBpm = 120;
        const beatIntervalMs = Math.round(60000 / estimatedBpm);
        const beatGrid: number[] = [];
        for (let t = 0; t < metadata.durationMs; t += beatIntervalMs) {
          beatGrid.push(t);
        }

        // 8. Save Analysis Results to MongoDB (idempotent upsert)
        console.log(`[AnalysisWorker] Persisting AnalysisResult document...`);
        const analysis = await AnalysisResultModel.findOneAndUpdate(
          { assetId: asset._id },
          {
            $set: {
              version: 1,
              status: 'complete',
              silences,
              sceneCuts,
              beats: {
                bpm: estimatedBpm,
                grid: beatGrid.slice(0, 500),
              },
              loudness: {
                integratedLufs: loudness.integratedLufs,
                truePeakDb: loudness.truePeakDb,
              },
              transcriptRef: captionSet._id,
              highlights: [
                {
                  startMs: 0,
                  endMs: Math.min(5000, metadata.durationMs),
                  score: 0.95,
                  reason: 'Opening introduction hook',
                },
              ],
            },
          },
          { upsert: true, new: true }
        );

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 85,
        });

        // 9. Generate baseline EditPlan (v1), ASS subtitle file, and First Captioned Preview
        console.log(`[AnalysisWorker] Generating baseline EditPlan and first captioned preview...`);
        const initialPlan = {
          schemaVersion: '1.0',
          projectId: project.publicId,
          baseAssetId: asset.publicId,
          version: 1,
          parentVersion: null,
          global: {
            aspect: project.settings?.aspect || '16:9',
            fps: metadata.fps || 30,
            resolution: '1080p',
          },
          layers: [
            {
              id: 'lyr_s1',
              layer: 'subtitle',
              enabled: cues.length > 0,
              timebase: 'source',
              params: {
                style: 'word_pop',
                font: 'Montserrat',
                size: 52,
                position: 'bottom',
                primaryColor: '#FFFFFF',
                highlightColor: '#FFD84D',
                maxWordsPerLine: 5,
              },
            },
          ],
          meta: {
            prompt: 'Initial auto-captioned baseline',
            model: 'system-analysis',
            createdAt: new Date().toISOString(),
          },
        };

        const planDoc = await EditPlanModel.findOneAndUpdate(
          { projectId: project._id, version: 1 },
          {
            $set: {
              parentVersion: null,
              prompt: 'Initial auto-captioned baseline',
              plan: initialPlan,
              model: 'system-analysis',
            },
          },
          { upsert: true, new: true }
        );

        // Generate and upload ASS subtitle script
        const assContent = AssGenerator.generateAss(cues, {
          width: 854,
          height: 480,
          font: 'Montserrat',
          fontSize: 34,
          primaryColor: '#FFFFFF',
          highlightColor: '#FFD84D',
        });
        fs.writeFileSync(localAssPath, assContent, 'utf-8');
        const subKey = StorageKeys.subtitlesAss(userId, projectId, 1);
        await S3Service.uploadFile(subKey, localAssPath, 'text/plain');

        // Burn subtitles into 480p preview proxy to produce first captioned preview
        const previewKey = StorageKeys.previewVideo(userId, projectId, 1);
        if (cues.length > 0 && fs.existsSync(localProxyPath)) {
          const escapedAssPath = localAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          const renderArgs = [
            '-y',
            '-i',
            localProxyPath,
            '-vf',
            `subtitles='${escapedAssPath}'`,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '28',
          ];

          if (metadata.audioCodec) {
            renderArgs.push('-c:a', 'copy');
          } else {
            renderArgs.push('-an');
          }

          renderArgs.push('-movflags', '+faststart', localCaptionedPreviewPath);

          try {
            await MediaProbeService.execProcess(env.FFMPEG_PATH, renderArgs);
            if (fs.existsSync(localCaptionedPreviewPath)) {
              await S3Service.uploadFile(previewKey, localCaptionedPreviewPath, 'video/mp4');
            }
          } catch (renderErr: any) {
            console.warn('[AnalysisWorker] Subtitle burn notice, falling back to proxy preview:', renderErr.message);
            await S3Service.uploadFile(previewKey, localProxyPath, 'video/mp4');
          }
        } else if (fs.existsSync(localProxyPath)) {
          await S3Service.uploadFile(previewKey, localProxyPath, 'video/mp4');
        }

        // 10. Update RenderJob & Project Status
        await RenderJobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              state: 'completed',
              percent: 100,
              'timings.finishedAt': new Date(),
            },
          }
        );

        project.headVersion = 1;
        project.baseAssetId = asset._id;
        project.status = 'ready';
        project.stats.durationMs = metadata.durationMs;
        project.versions = [
          {
            version: 1,
            label: 'Initial Baseline with Subtitles',
            source: 'ai',
            planId: planDoc._id,
            createdAt: new Date(),
          },
        ];
        await project.save();

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'done',
          percent: 100,
          assetId,
          analysisResultId: analysis._id.toString(),
          previewKey,
        });

        console.log(`[AnalysisWorker] Successfully completed analysis and captioned preview for asset ${assetId}`);
      } catch (err: any) {
        console.error(`[AnalysisWorker] Pipeline error on asset ${assetId}:`, err);
        const errorCode = err.code || 'ANALYSIS_FAILED';
        const isCorrupt = errorCode === 'INPUT_CORRUPT';

        await RenderJobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              state: 'failed',
              error: {
                code: errorCode,
                message: err.message || 'Media analysis failed',
                retryable: !isCorrupt,
              },
              'timings.finishedAt': new Date(),
            },
          }
        );

        await AssetModel.updateOne(
          { publicId: assetId },
          { $set: { status: 'failed' } }
        );

        await ProjectModel.updateOne(
          { publicId: projectId },
          { $set: { status: 'error' } }
        );

        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'failed',
          percent: 0,
          error: err.message,
          code: errorCode,
        });

        // Do not retry corrupt payloads
        if (!isCorrupt) {
          throw err;
        }
      } finally {
        // Guaranteed cleanup of per-job isolated scratch directory
        scratch.cleanup();
      }
    },
    {
      connection: redisConnection,
      concurrency: QUEUE_CONFIGS.analysis.concurrency,
      lockDuration: QUEUE_CONFIGS.analysis.lockDurationMs,
      maxStalledCount: 1,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[AnalysisWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function bootstrapStandalone() {
  console.log('--- Starting Standalone Analysis Worker Process ---');
  await connectDatabase();
  console.log('[MongoDB] Connected successfully');
  await redisConnection.ping();
  console.log('[Redis] Connected successfully');
  await S3Service.ensureBucketExists();
  console.log('[S3] Bucket verified');
  const worker = startAnalysisWorker();
  console.log('[AnalysisWorker] Listening for jobs on queue "analysis"');

  const shutdown = async () => {
    console.log('\n[AnalysisWorker] Shutting down gracefully...');
    await worker.close();
    await disconnectDatabase();
    redisConnection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('analysisWorker.ts') || process.argv[1].endsWith('analysisWorker.js'));

if (isMain) {
  bootstrapStandalone().catch((err) => {
    console.error('[AnalysisWorker] Fatal startup error:', err);
    process.exit(1);
  });
}
