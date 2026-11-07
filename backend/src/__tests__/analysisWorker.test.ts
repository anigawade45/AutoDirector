import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaProbeService } from '../services/media/mediaProbeService.js';
import { AssetModel } from '../models/Asset.js';
import { ProjectModel } from '../models/Project.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { S3Service } from '../services/storage/s3Service.js';
import { JobEventsPublisher } from '../services/queue/queueService.js';
import fs from 'fs';

vi.mock('../models/Asset.js', () => ({
  AssetModel: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/RenderJob.js', () => ({
  RenderJobModel: {
    updateOne: vi.fn(),
  },
}));

vi.mock('../services/queue/queueService.js', () => ({
  JobEventsPublisher: {
    publishProgress: vi.fn().mockResolvedValue(true),
  },
  analysisQueue: {
    add: vi.fn(),
  },
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
  },
}));

describe('Analysis Worker - Media Probe & Asset Metadata Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('runs ffprobe and records duration, dimensions, fps, codecs and audio metadata', async () => {
    const mockAsset: any = {
      publicId: 'ast_probe_test',
      s3: { rawKey: 'users/u1/projects/p1/raw/ast_probe_test.mp4' },
      status: 'processing',
      checksum: undefined,
      save: vi.fn().mockResolvedValue(true),
    };

    const mockProject: any = {
      publicId: 'prj_probe_test',
      status: 'analyzing',
      save: vi.fn().mockResolvedValue(true),
    };

    (AssetModel.findOne as any).mockResolvedValue(mockAsset);
    (ProjectModel.findOne as any).mockResolvedValue(mockProject);
    (S3Service.downloadFile as any).mockResolvedValue(undefined);

    // Mock probe output
    const mockProbeOutput = {
      durationMs: 8733,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitrate: 12500000,
      sizeBytes: 13645000,
      rotation: 0,
    };

    vi.spyOn(MediaProbeService, 'probeVideo').mockResolvedValue(mockProbeOutput);

    // Verify probe output matches all specification fields
    const metadata = await MediaProbeService.probeVideo('mock/path/test.mp4');

    expect(metadata.durationMs).toBe(8733);
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(metadata.fps).toBe(30);
    expect(metadata.videoCodec).toBe('h264');
    expect(metadata.audioCodec).toBe('aac');
    expect(metadata.sampleRate).toBe(48000);
    expect(metadata.channels).toBe(2);
    expect(metadata.bitrate).toBe(12500000);

    // Simulate saving into Asset document
    mockAsset.media = {
      durationMs: metadata.durationMs,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      videoCodec: metadata.videoCodec,
      audioCodec: metadata.audioCodec,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      bitrate: metadata.bitrate,
      sizeBytes: metadata.sizeBytes,
      rotation: metadata.rotation,
    };
    await mockAsset.save();

    expect(mockAsset.save).toHaveBeenCalled();
    expect(mockAsset.media.videoCodec).toBe('h264');
    expect(mockAsset.media.audioCodec).toBe('aac');
    expect(mockAsset.media.channels).toBe(2);
    expect(mockAsset.media.sampleRate).toBe(48000);
  });

  it('correctly extracts silent video metadata without crashing (audioCodec: undefined)', async () => {
    const mockOutput = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 3840,
          height: 2160,
          r_frame_rate: '60/1',
        },
      ],
      format: {
        duration: '15.0',
        size: '50000000',
        bit_rate: '26666666',
      },
    });

    vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockOutput);

    const result = await MediaProbeService.probeVideo('silent_4k.mp4');

    expect(result.durationMs).toBe(15000);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
    expect(result.fps).toBe(60);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBeUndefined();
    expect(result.channels).toBe(0);
    expect(result.sampleRate).toBe(0);
  });

  it('compiles correct FFmpeg arguments for 480p proxy generation and 16kHz mono WAV extraction', async () => {
    const execSpy = vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue('');

    // Test proxy with audio
    await MediaProbeService.generateProxy480p('input.mp4', 'output_480p.mp4', true);
    expect(execSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining([
        '-vf',
        'scale=-2:480',
        '-c:v',
        'libx264',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '+faststart',
      ])
    );

    // Test proxy without audio
    await MediaProbeService.generateProxy480p('silent.mp4', 'output_480p.mp4', false);
    expect(execSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining(['-vf', 'scale=-2:480', '-an', '+faststart'])
    );

    // Test 16kHz mono WAV extraction
    await MediaProbeService.extractAudioWav('input.mp4', 'audio_16k.wav');
    expect(execSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining([
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        'audio_16k.wav',
      ])
    );
  });
});
