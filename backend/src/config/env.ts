import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
// @ts-ignore
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
// @ts-ignore
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

dotenv.config();

function resolveBinary(envValue: string | undefined, installerValue: string | undefined, binaryName: string): string {
  // If user provided a specific valid file path on disk, use it
  if (envValue && envValue !== binaryName && fs.existsSync(envValue)) {
    return envValue;
  }
  // If static installed bundle exists on disk, prefer it over missing PATH binary
  if (installerValue && fs.existsSync(installerValue)) {
    return installerValue;
  }
  return envValue || binaryName;
}

const defaultFfmpeg = resolveBinary(process.env.FFMPEG_PATH, ffmpegInstaller?.path, 'ffmpeg');
const defaultFfprobe = resolveBinary(process.env.FFPROBE_PATH, ffprobeInstaller?.path, 'ffprobe');

const envSchema = z.object({
  PORT: z.string().default('4000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_BASE_URL: z.string().default('http://localhost:4000/api'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  JWT_SECRET: z.string().default('dev-jwt-secret-replace-in-production'),
  INTERNAL_WORKER_SECRET: z.string().default('dev-worker-hmac-shared-secret-key-32-chars'),

  MONGODB_URI: z
    .string()
    .default('mongodb://localhost:27017/ai_video_editor?replicaSet=rs0&directConnection=true'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional().default(''),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  S3_BUCKET_NAME: z.string().default('ai-video-editing-platform'),
  S3_ENDPOINT: z.string().default('http://127.0.0.1:4566'),
  S3_FORCE_PATH_STYLE: z.string().default('true').transform((val) => val === 'true'),

  AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  AI_MODEL: z.string().default('gemini-1.5-pro'),
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),

  FFMPEG_PATH: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim() && val !== 'ffmpeg' && fs.existsSync(val)) return val;
      if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path)) return ffmpegInstaller.path;
      return val && val.trim() ? val : (ffmpegInstaller?.path || 'ffmpeg');
    }),
  FFPROBE_PATH: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim() && val !== 'ffprobe' && fs.existsSync(val)) return val;
      if (ffprobeInstaller?.path && fs.existsSync(ffprobeInstaller.path)) return ffprobeInstaller.path;
      return val && val.trim() ? val : (ffprobeInstaller?.path || 'ffprobe');
    }),
  TEMP_MEDIA_DIR: z.string().default('./tmp/media'),
});

export const env = envSchema.parse(process.env);

