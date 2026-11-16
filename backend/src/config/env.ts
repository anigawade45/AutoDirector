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
  PORT: z.string().optional().default('4000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  API_BASE_URL: z.string().optional().default('http://localhost:4000/api'),
  CORS_ORIGIN: z.string().optional().default('*'),
  S3_ALLOWED_ORIGINS: z.string().optional().default(''),

  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  INTERNAL_WORKER_SECRET: z.string().min(1, 'INTERNAL_WORKER_SECRET is required'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  REDIS_HOST: z.string().optional().default('redis'),
  REDIS_PORT: z.string().optional().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_TLS: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),

  LOCALSTACK_AUTH_TOKEN: z.string().optional().default(''),
  AWS_REGION: z.string().optional().default('ap-southeast-2'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),

  AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  AI_MODEL: z.string().default('gemini-1.5-flash'),
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),

  WHISPER_PATH: z.string().optional().default(''),
  WHISPER_MODEL: z.string().optional().default('base'),

  ENABLE_IN_PROCESS_WORKERS: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),

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
  TEMP_MEDIA_DIR: z.string().optional().default('/tmp/renders'),
});

let parsedEnv: z.infer<typeof envSchema>;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err: any) {
  console.error('\n======================================================');
  console.error('❌ FATAL: Environment variable validation failed!');
  if (err instanceof z.ZodError) {
    err.errors.forEach((e) => {
      console.error(`   - Missing or invalid: ${e.path.join('.')} (${e.message})`);
    });
  } else {
    console.error('   ', err);
  }
  console.error('======================================================\n');
  process.exit(1);
}

export const env = parsedEnv;
