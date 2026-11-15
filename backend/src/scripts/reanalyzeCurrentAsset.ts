import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { S3Service } from '../services/storage/s3Service.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { CaptionSetModel } from '../models/CaptionSet.js';
import { AnalysisResultModel } from '../models/AnalysisResult.js';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { TranscriptionService } from '../services/ai/transcriptionService.js';
import { JobScratchDirectory } from '../services/storage/jobScratchDirectory.js';
import crypto from 'crypto';

async function main() {
  await connectDatabase();
  await S3Service.ensureBucketExists();

  const asset = await AssetModel.findOne({ publicId: 'ast_u_baqT3RvZ' });
  if (!asset) {
    console.error('Asset ast_u_baqT3RvZ not found in DB');
    await disconnectDatabase();
    process.exit(1);
  }

  const project = await ProjectModel.findById(asset.projectId) || await ProjectModel.findOne({ publicId: 'prj_nAXduOXD' });
  console.log(`Processing Asset ${asset.publicId} for Project ${project?.publicId || asset.projectId}...`);

  const scratch = new JobScratchDirectory('manual_reanalyze');
  const localAudioPath = scratch.resolve('audio_16k.wav');

  // Download audio WAV from S3
  const audioKey = asset.s3?.audioKey || `users/${asset.userId}/projects/${project?.publicId || 'prj_nAXduOXD'}/audio/${asset.publicId}.wav`;
  console.log(`Downloading audio from S3: ${audioKey}...`);
  await S3Service.downloadFile(audioKey, localAudioPath);

  // 1. Detect loudness with the fixed regex!
  const loudness = await MediaProbeService.detectLoudness(localAudioPath);
  console.log('✓ Measured Loudness:', loudness);

  // 2. Detect silences
  const silences = await MediaProbeService.detectSilences(localAudioPath);
  console.log(`✓ Detected ${silences.length} silence regions`);

  // 3. Transcribe audio with Whisper / Gemini / acoustic alignment
  const durationMs = asset.media?.durationMs || 263900;
  console.log(`✓ Transcribing audio (${Math.round(durationMs / 1000)}s)...`);
  const cues = await TranscriptionService.transcribeAudio(
    localAudioPath,
    durationMs,
    silences,
    project?.settings?.language || 'en',
    loudness.integratedLufs
  );
  console.log(`✓ Generated ${cues.length} speech dialogue cues!`);
  if (cues.length > 0) {
    console.log('Sample cue 1:', cues[0].text);
    if (cues.length > 1) console.log('Sample cue 2:', cues[1].text);
  }

  // 4. Update CaptionSet
  const captionHash = crypto.createHash('sha256').update(JSON.stringify(cues)).digest('hex');
  const captionSet = await CaptionSetModel.findOneAndUpdate(
    { assetId: asset._id },
    {
      $set: {
        projectId: project?._id || asset.projectId,
        language: project?.settings?.language || 'en',
        origin: 'whisper',
        cues,
        contentHash: captionHash,
      },
    },
    { upsert: true, new: true }
  );

  // 5. Update AnalysisResult
  await AnalysisResultModel.findOneAndUpdate(
    { assetId: asset._id },
    {
      $set: {
        silences,
        loudness: {
          integratedLufs: loudness.integratedLufs,
          truePeakDb: loudness.truePeakDb,
        },
        transcriptRef: captionSet._id,
        transcriptExcerpt: cues.slice(0, 50).map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
          words: c.words.map((w: any) => ({
            word: w.w || w.word,
            startMs: w.s !== undefined ? w.s : w.startMs,
            endMs: w.e !== undefined ? w.e : w.endMs,
            score: w.conf || 0.95,
          })),
        })),
      },
    },
    { upsert: true, new: true }
  );

  scratch.cleanup();
  console.log('✓ Successfully updated database with real speech cues & calibrated loudness!');
  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('Re-analysis error:', err);
  process.exit(1);
});

