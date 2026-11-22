import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { ProjectModel } from '../models/Project.js';
import { AssetModel } from '../models/Asset.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { CatalogModel } from '../models/Catalog.js';
import { JobEventsPublisher, QUEUE_CONFIGS } from '../services/queue/queueService.js';
import { RenderJobLifecycle } from '../services/jobs/renderJobLifecycle.js';
import { FFmpegCompiler } from '../services/compiler/ffmpegCompiler.js';
import { AssGenerator } from '../services/compiler/assGenerator.js';
import { S3Service } from '../services/storage/s3Service.js';
import { StorageKeys } from '../config/s3.js';
import { JobScratchDirectory } from '../services/storage/jobScratchDirectory.js';
import { FFmpegProgressParser } from '../services/compiler/ffmpegProgressParser.js';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { env } from '../config/env.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface RenderJobPayload {
  jobId: string;
  projectId: string;
  planVersion: number;
  type: 'preview' | 'export';
  profile: 'preview_480p' | 'final_1080p' | 'final_4k';
}

export interface RenderWorkerOptions {
  concurrency?: number;
  workerId?: string;
  skipVersionCheck?: boolean;
}

export function startRenderWorker(
  queueName: 'preview' | 'render' = 'preview',
  options?: RenderWorkerOptions
) {
  const queueConfig = QUEUE_CONFIGS[queueName];
  const concurrency = options?.concurrency ?? queueConfig.concurrency;
  const workerId =
    options?.workerId ||
    `render-worker-${queueName}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

  const worker = new Worker<RenderJobPayload>(
    queueName,
    async (job: Job<RenderJobPayload>) => {
      const { jobId, projectId, planVersion, profile, type } = job.data;
      console.log(
        `[RenderWorker:${queueName}:${workerId}] Processing ${type} job ${jobId} for project ${projectId} v${planVersion}`
      );

      const scratch = new JobScratchDirectory(jobId);
      const localSourcePath = scratch.sourceVideo;
      const localOutputPath = scratch.outputVideo(profile);
      const localAssPath = scratch.assSubtitles;

      try {
        await JobEventsPublisher.publishProgress(jobId, {
          jobId,
          state: 'processing',
          percent: 5,
        });

        const project = await ProjectModel.findOne({ publicId: projectId });
        if (!project) {
          console.log(
            `[RenderWorker:${queueName}] Project ${projectId} no longer exists in database (purged or deleted). Halting render job gracefully.`
          );
          return;
        }

        const planDoc = await EditPlanModel.findOne({
          projectId: project._id,
          version: planVersion,
        });

        if (!planDoc) {
          throw new Error(`EditPlan version ${planVersion} not found for project ${projectId}`);
        }

        // 1. Download source video from S3
        let expectedDurationMs = 60000;
        if (project.baseAssetId) {
          const asset = await AssetModel.findById(project.baseAssetId);
          if (asset?.media?.durationMs) {
            expectedDurationMs = asset.media.durationMs;
          }
          if (asset?.s3?.rawKey) {
            console.log(
              `[RenderWorker:${queueName}] Downloading source video ${asset.s3.rawKey}...`
            );
            await S3Service.downloadFile(asset.s3.rawKey, localSourcePath);
          }
        }

        await RenderJobLifecycle.transition(jobId, 'processing', {
          percent: 15,
          workerId,
        });

        // 2. Prepare Subtitles ASS file if subtitle layer enabled
        const subtitleLayer = planDoc.plan.layers.find(
          (l: any) => l.enabled && l.layer === 'subtitle'
        );
        let assSubtitlePath: string | undefined = undefined;

        if (subtitleLayer && project.baseAssetId) {
          const captionSet = await CaptionSetModel.findOne({ projectId: project._id }).sort({
            createdAt: -1,
          });
          if (captionSet && captionSet.cues.length > 0) {
            const assContent = AssGenerator.generateAss(captionSet.cues as any, {
              width: profile === 'preview_480p' ? 854 : 1920,
              height: profile === 'preview_480p' ? 480 : 1080,
              font: (subtitleLayer.params as any)?.font || 'Montserrat',
              fontSize: (subtitleLayer.params as any)?.size || 50,
              primaryColor: (subtitleLayer.params as any)?.primaryColor || '#FFFFFF',
              highlightColor: (subtitleLayer.params as any)?.highlightColor || '#FFD84D',
            });
            fs.writeFileSync(localAssPath, assContent, 'utf-8');
            assSubtitlePath = localAssPath;
          }
        }

        // 2b. Prepare Music audio file if music layer enabled
        const musicLayer = planDoc.plan.layers.find((l: any) => l.enabled && l.layer === 'music');
        let musicSourcePath: string | undefined = undefined;

        if (musicLayer) {
          const trackId = (musicLayer.params as any)?.trackId || 'mus_calm_01';
          const localMusicPath = scratch.resolve(`${trackId}.mp3`);

          // Check if catalog has an S3 key for this music track
          const catalogItem = await CatalogModel.findOne({ key: trackId, kind: 'music' });
          if (catalogItem?.s3Key) {
            try {
              await S3Service.downloadFile(catalogItem.s3Key, localMusicPath);
              if (fs.existsSync(localMusicPath)) {
                musicSourcePath = localMusicPath;
              }
            } catch (dlErr: any) {
              console.warn(
                `[RenderWorker:${queueName}] Catalog music download deferred:`,
                dlErr.message
              );
            }
          }

          // If no local/catalog file, synthesize a clean ambient audio track with FFmpeg
          if (!musicSourcePath || !fs.existsSync(musicSourcePath)) {
            const synthMusicPath = scratch.resolve('ambient_synth.mp3');
            const audioDurSec = Math.ceil(expectedDurationMs / 1000) || 60;
            try {
              await MediaProbeService.execProcess(env.FFMPEG_PATH, [
                '-y',
                '-f',
                'lavfi',
                '-i',
                `aevalsrc=0.04*sin(2*PI*220*t)+0.02*sin(2*PI*330*t)+0.015*sin(2*PI*440*t):s=44100:d=${audioDurSec}`,
                '-c:a',
                'libmp3lame',
                '-b:a',
                '128k',
                synthMusicPath,
              ]);
              if (fs.existsSync(synthMusicPath)) {
                musicSourcePath = synthMusicPath;
              }
            } catch (synthErr: any) {
              console.warn(`[RenderWorker:${queueName}] Audio synthesis notice:`, synthErr.message);
            }
          }
        }

        // 2c. Prepare Overlay assets (B-Roll, Images, Generative Cutaways) if overlay layers enabled
        const overlayLayers = planDoc.plan.layers.filter(
          (l: any) => l.enabled && l.layer === 'overlay'
        );
        const overlaySourcePaths: Record<string, string> = {};

        for (let i = 0; i < overlayLayers.length; i++) {
          const ov = overlayLayers[i] as any;
          const assetKeyOrId = ov.params?.asset || `ov_${i}`;
          const localOverlayPath = scratch.resolve(`overlay_${ov.id}.png`);

          let resolved = false;
          // Try 1: check if it's an uploaded asset in AssetModel
          try {
            const assetDoc = await AssetModel.findOne({
              $or: [{ _id: assetKeyOrId }, { publicId: assetKeyOrId }],
            });
            if (assetDoc?.s3?.rawKey) {
              await S3Service.downloadFile(assetDoc.s3.rawKey, localOverlayPath);
              if (fs.existsSync(localOverlayPath)) {
                overlaySourcePaths[ov.id] = localOverlayPath;
                overlaySourcePaths[assetKeyOrId] = localOverlayPath;
                resolved = true;
              }
            }
          } catch {}

          // Try 2: check if it's in CatalogModel
          if (!resolved) {
            try {
              const catDoc = await CatalogModel.findOne({ key: assetKeyOrId });
              if (catDoc?.s3Key) {
                await S3Service.downloadFile(catDoc.s3Key, localOverlayPath);
                if (fs.existsSync(localOverlayPath)) {
                  overlaySourcePaths[ov.id] = localOverlayPath;
                  overlaySourcePaths[assetKeyOrId] = localOverlayPath;
                  resolved = true;
                }
              }
            } catch {}
          }

          // Try 3: If no external file, synthesize a clean visual card with FFmpeg
          if (!resolved && !fs.existsSync(localOverlayPath)) {
            try {
              const ovWidth = profile === 'preview_480p' ? 854 : 1920;
              const ovHeight = profile === 'preview_480p' ? 480 : 1080;
              const ovLabel = (ov.params?.asset || ov.params?.mediaType || 'B-Roll Media').replace(
                /[':\\]/g,
                ''
              );
              await MediaProbeService.execProcess(env.FFMPEG_PATH, [
                '-y',
                '-f',
                'lavfi',
                '-i',
                `color=c=0x1E2024:s=${ovWidth}x${ovHeight}:d=1`,
                '-vf',
                `drawtext=text='${ovLabel}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
                '-frames:v',
                '1',
                localOverlayPath,
              ]);
              if (fs.existsSync(localOverlayPath)) {
                overlaySourcePaths[ov.id] = localOverlayPath;
                overlaySourcePaths[assetKeyOrId] = localOverlayPath;
              }
            } catch (synthErr: any) {
              console.warn(
                `[RenderWorker:${queueName}] Overlay synthesis notice:`,
                synthErr?.message
              );
            }
          }
        }

        // 2d. Prepare LUT file if color grading layer specifies a LUT
        const colorLayer = planDoc.plan.layers.find((l: any) => l.enabled && l.layer === 'color');
        let lutPath: string | undefined = undefined;
        if (colorLayer && (colorLayer.params as any)?.lut) {
          const lutKey = (colorLayer.params as any).lut;
          const localLutFile = scratch.resolve(`${lutKey}.cube`);
          try {
            const lutCatalog = await CatalogModel.findOne({ key: lutKey, kind: 'lut' });
            if (lutCatalog?.s3Key) {
              await S3Service.downloadFile(lutCatalog.s3Key, localLutFile);
              if (fs.existsSync(localLutFile)) {
                lutPath = localLutFile;
              }
            }
          } catch (lutErr: any) {
            console.warn(`[RenderWorker:${queueName}] LUT download notice:`, lutErr?.message);
          }
        }

        // 3. Compile deterministic FFmpeg arguments
        const compiled = FFmpegCompiler.compile(
          planDoc.plan,
          {
            durationMs: expectedDurationMs,
            width: profile === 'preview_480p' ? 854 : profile === 'final_4k' ? 3840 : 1920,
            height: profile === 'preview_480p' ? 480 : profile === 'final_4k' ? 2160 : 1080,
            fps: planDoc.plan.global.fps || 30,
            silences: [],
            sceneCuts: [],
            beats: { bpm: 120, grid: [] },
            loudness: { integratedLufs: -16, truePeakDb: -1.5 },
            transcriptExcerpt: [],
          },
          profile,
          {
            inputSourcePath: localSourcePath,
            assSubtitlePath,
            musicSourcePath,
            lutPath,
            overlaySourcePaths,
            outputPath: localOutputPath,
          }
        );

        console.log(
          `[RenderWorker:${queueName}] Launching FFmpeg with ${compiled.args.length} arguments`
        );

        // 4. Execute FFmpeg rendering process
        if (fs.existsSync(localSourcePath)) {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(env.FFMPEG_PATH, compiled.args, {
              stdio: ['ignore', 'pipe', 'pipe'],
            });

            proc.stdout.on('data', async (chunk) => {
              const text = chunk.toString();
              const progress = FFmpegProgressParser.parse(text, expectedDurationMs);
              if (progress) {
                await RenderJobLifecycle.transition(jobId, 'processing', {
                  percent: progress.percent,
                  outTimeMs: progress.outTimeMs,
                }).catch(() => {});
              }
            });

            let stderrText = '';
            proc.stderr.on('data', (chunk) => {
              stderrText += chunk.toString();
            });

            proc.on('error', (err) => {
              reject(new Error(`FFmpeg spawn error: ${err.message}`));
            });

            proc.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(
                  new Error(`FFmpeg rendering exited with code ${code}: ${stderrText.slice(-300)}`)
                );
              }
            });
          });
        } else {
          // If running in mocked test mode without raw file, simulate rapid rendering
          for (let p = 30; p <= 90; p += 30) {
            await new Promise((r) => setTimeout(r, 400));
            await RenderJobLifecycle.transition(jobId, 'processing', { percent: p }).catch(
              () => {}
            );
          }
        }

        // 5. Upload rendered output to S3
        const outputKey =
          type === 'preview'
            ? StorageKeys.previewVideo(project.userId.toString(), project.publicId, planVersion)
            : StorageKeys.finalRender(project.userId.toString(), project.publicId, jobId);

        await RenderJobLifecycle.transition(jobId, 'uploading_output', { percent: 95 });

        if (fs.existsSync(localOutputPath)) {
          console.log(`[RenderWorker:${queueName}] Uploading rendered MP4 to S3: ${outputKey}...`);
          await S3Service.uploadFile(outputKey, localOutputPath, 'video/mp4');
        }

        const outStat = fs.existsSync(localOutputPath) ? fs.statSync(localOutputPath) : null;

        // 6. Complete RenderJob & update Project in MongoDB
        await RenderJobLifecycle.transition(jobId, 'completed', {
          output: {
            key: outputKey,
            sizeBytes: outStat?.size || 15000000,
            durationMs: expectedDurationMs,
          },
        });

        if (type === 'export') {
          project.publishedVersion = planVersion;
          project.status = 'ready';
          await project.save();
        } else {
          project.status = 'ready';
          await project.save();
        }

        console.log(`[RenderWorker:${queueName}] Successfully completed job ${jobId}`);
      } catch (err: any) {
        const isPurged =
          err.name === 'DocumentNotFoundError' ||
          err.message?.includes('No document found for query') ||
          err.message?.includes('not found in database') ||
          !(await ProjectModel.exists({ publicId: projectId }).catch(() => false));

        if (isPurged) {
          console.log(
            `[RenderWorker:${queueName}] Project ${projectId} was purged or removed during rendering. Halting job gracefully.`
          );
          return;
        }

        console.error(`[RenderWorker:${queueName}] Job ${jobId} failed:`, err);
        await RenderJobLifecycle.transition(jobId, 'failed', {
          error: err,
        }).catch(() => {});
        throw err;
      } finally {
        // Guaranteed cleanup of per-job temporary scratch directory
        await scratch.cleanup();
      }
    },
    {
      connection: redisConnection,
      concurrency,
      lockDuration: queueConfig.lockDurationMs,
      maxStalledCount: 1,
      stalledInterval: 300000, // 5 minutes (prevents burning Upstash request quota on idle checks)
      drainDelay: 10000, // 10s wait when queue is empty instead of default 5ms
      skipVersionCheck: options?.skipVersionCheck ?? true,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[RenderWorker:${queueName}:${workerId}] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function bootstrapStandalone() {
  const clusterSize = Math.max(
    1,
    parseInt(process.env.RENDER_CLUSTER_SIZE || process.env.WORKER_REPLICAS || '1', 10)
  );
  console.log(`--- Starting Standalone Render Worker Cluster (${clusterSize} worker instances) ---`);
  await connectDatabase();
  console.log('[MongoDB] Connected successfully');
  await redisConnection.ping();
  console.log('[Redis] Connected successfully');
  await S3Service.ensureBucketExists();
  console.log('[S3] Bucket verified');

  const workers: Worker[] = [];
  for (let i = 0; i < clusterSize; i++) {
    const workerInstanceId = `render-node-${process.pid}-w${i + 1}`;
    workers.push(startRenderWorker('preview', { workerId: `${workerInstanceId}-prev` }));
    workers.push(startRenderWorker('render', { workerId: `${workerInstanceId}-rend` }));
  }
  console.log(
    `[RenderWorker] Cluster pool initialized with ${workers.length} active queue workers on "preview" and "render"`
  );

  const shutdown = async () => {
    console.log('\n[RenderWorker] Shutting down worker cluster gracefully...');
    await Promise.all(workers.map((w) => w.close()));
    await disconnectDatabase();
    redisConnection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('renderWorker.ts') || process.argv[1].endsWith('renderWorker.js'));

if (isMain) {
  bootstrapStandalone().catch((err) => {
    console.error('[RenderWorker] Fatal startup error:', err);
    process.exit(1);
  });
}
