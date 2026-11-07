import { describe, it, expect, vi } from 'vitest';
import { MediaProbeService } from '../services/media/mediaProbeService.js';

describe('MediaProbeService - Container & Stream Validation', () => {
  it('throws INPUT_CORRUPT when file contains no video streams (e.g. audio only or corrupt container)', async () => {
    // Mock execProcess to return ffprobe output with no video stream
    const mockOutput = JSON.stringify({
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '44100',
          channels: 2,
        },
      ],
      format: {
        duration: '10.5',
        size: '102400',
      },
    });

    vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockOutput);

    await expect(MediaProbeService.probeVideo('audio_only.mp4')).rejects.toThrowError(
      expect.objectContaining({
        code: 'INPUT_CORRUPT',
        statusCode: 422,
      })
    );
  });

  it('throws INPUT_CORRUPT when container duration is zero or invalid', async () => {
    const mockOutput = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1',
        },
      ],
      format: {
        duration: '0',
        size: '500',
      },
    });

    vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockOutput);

    await expect(MediaProbeService.probeVideo('corrupt_header.mp4')).rejects.toThrowError(
      expect.objectContaining({
        code: 'INPUT_CORRUPT',
        statusCode: 422,
      })
    );
  });

  it('successfully extracts video metadata for valid video container', async () => {
    const mockOutput = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '48000',
          channels: 2,
        },
      ],
      format: {
        duration: '12.45',
        size: '15000000',
        bit_rate: '9600000',
      },
    });

    vi.spyOn(MediaProbeService, 'execProcess').mockResolvedValue(mockOutput);

    const result = await MediaProbeService.probeVideo('valid_video.mp4');

    expect(result.durationMs).toBe(12450);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBe(30);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
  });
});
