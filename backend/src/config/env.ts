import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
// @ts-ignore
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
// @ts-ignore
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

const candidatePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../../.env') : '',
];

const foundPath = candidatePaths.find((p) => p && fs.existsSync(p));
if (foundPath) {
  dotenv.config({ path: foundPath });
} else {
  dotenv.config();
}

const envSchema = z.object({
  PORT: z.string().transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  API_BASE_URL: z.string(),
  CORS_ORIGIN: z.string(),

  JWT_SECRET: z.string(),
  INTERNAL_WORKER_SECRET: z.string(),

  MONGODB_URI: z.string(),

  REDIS_HOST: z.string(),
  REDIS_PORT: z.string().transform(Number),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_TLS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  LOCALSTACK_AUTH_TOKEN: z.string().optional().default(''),
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET_NAME: z.string(),
  S3_ENDPOINT: z.string(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .transform((val) => val === 'true'),

  AI_PROVIDER: z.enum(['gemini', 'openai']),
  AI_MODEL: z.string(),
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),

  WHISPER_PATH: z.string().optional().default(''),
  WHISPER_MODEL: z.string(),

  ENABLE_IN_PROCESS_WORKERS: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),

  FFMPEG_PATH: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim() && val !== 'ffmpeg' && fs.existsSync(val)) return val;
      if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path)) return ffmpegInstaller.path;
      return val && val.trim() ? val : ffmpegInstaller?.path || 'ffmpeg';
    }),
  FFPROBE_PATH: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim() && val !== 'ffprobe' && fs.existsSync(val)) return val;
      if (ffprobeInstaller?.path && fs.existsSync(ffprobeInstaller.path))
        return ffprobeInstaller.path;
      return val && val.trim() ? val : ffprobeInstaller?.path || 'ffprobe';
    }),
  TEMP_MEDIA_DIR: z.string(),
});

export const env = envSchema.parse(process.env);
