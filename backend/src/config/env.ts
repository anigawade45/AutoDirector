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

/**
 * Validates CORS_ORIGIN for production safety.
 * Rejects wildcards, empty strings, and malformed origins when running in production.
 */
export function validateCorsOrigin(
  corsOrigin: string | undefined,
  nodeEnv: string
): { valid: boolean; reason?: string } {
  if (nodeEnv !== 'production') {
    return { valid: true };
  }

  if (!corsOrigin || !corsOrigin.trim()) {
    return {
      valid: false,
      reason: 'CORS_ORIGIN is required in production and cannot be empty',
    };
  }

  const origins = corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return {
      valid: false,
      reason: 'CORS_ORIGIN must contain at least one valid origin in production',
    };
  }

  if (origins.includes('*') || origins.some((o) => o === '*')) {
    return {
      valid: false,
      reason:
        'Wildcard CORS_ORIGIN ("*") is prohibited in production when credentialed authentication is enabled',
    };
  }

  for (const origin of origins) {
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      return {
        valid: false,
        reason: `CORS_ORIGIN entry '${origin}' is invalid; must start with http:// or https://`,
      };
    }
  }

  return { valid: true };
}

export const envSchema = z
  .object({
    PORT: z.string().optional().default('4000').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    API_BASE_URL: z.string().optional().default('http://localhost:4000/api'),
    CORS_ORIGIN: z
      .string()
      .optional()
      .default(process.env.NODE_ENV === 'production' ? '' : '*'),
    S3_ALLOWED_ORIGINS: z.string().optional().default(''),
    ALLOW_DEGRADED_BOOT: z
      .string()
      .optional()
      .default('false')
      .transform((val) => val === 'true'),

    JWT_SECRET: z
      .string()
      .min(1, 'JWT_SECRET is required')
      .refine((val) => val.trim().length > 0, 'JWT_SECRET cannot be whitespace only'),
    INTERNAL_WORKER_SECRET: z
      .string()
      .min(1, 'INTERNAL_WORKER_SECRET is required')
      .refine((val) => val.trim().length > 0, 'INTERNAL_WORKER_SECRET cannot be whitespace only'),

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
    ALLOW_HEURISTIC_FALLBACK: z
      .string()
      .optional()
      .default('true')
      .transform((val) => val === 'true'),

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
        if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path))
          return ffmpegInstaller.path;
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
  })
  .superRefine((data, ctx) => {
    const corsCheck = validateCorsOrigin(data.CORS_ORIGIN, data.NODE_ENV);
    if (!corsCheck.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: corsCheck.reason,
        path: ['CORS_ORIGIN'],
      });
    }

    // Production datastore security & credentials hygiene (SEC-006)
    if (data.NODE_ENV === 'production') {
      if (data.REDIS_PASSWORD) {
        const weakRedisPasswords = [
          'prod_redis_pass_change_me',
          '__inject_redis_password__',
          'password',
          'admin',
          '123456',
          'redis',
          'change_me',
        ];
        if (
          weakRedisPasswords.includes(data.REDIS_PASSWORD.toLowerCase()) ||
          data.REDIS_PASSWORD.includes('__INJECT_')
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'REDIS_PASSWORD is weak or uses a default placeholder in production. Must supply a secure secret.',
            path: ['REDIS_PASSWORD'],
          });
        }
      }

      if (data.MONGODB_URI) {
        if (
          data.MONGODB_URI.includes('__INJECT_') ||
          data.MONGODB_URI.includes(':password@') ||
          data.MONGODB_URI.includes(':admin@') ||
          data.MONGODB_URI.includes(':change_me@')
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'MONGODB_URI contains placeholder or weak default credentials in production. Must supply verified production credentials.',
            path: ['MONGODB_URI'],
          });
        }
      }

      // Production JWT & Worker Secret Hardening (SEC-007)
      const weakSecretPlaceholders = [
        'ai-video-studio-jwt-secret-key-2026',
        'change_me',
        '__inject_',
        'default_secret',
        'password',
        '123456',
        'admin',
      ];

      const jwtSecretLower = data.JWT_SECRET.toLowerCase();
      if (
        data.JWT_SECRET.length < 32 ||
        weakSecretPlaceholders.some((p) => jwtSecretLower.includes(p))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'JWT_SECRET is insecure for production. Must be at least 32 characters and cannot use default placeholders or weak patterns.',
          path: ['JWT_SECRET'],
        });
      }

      if (data.INTERNAL_WORKER_SECRET) {
        const workerSecretLower = data.INTERNAL_WORKER_SECRET.toLowerCase();
        if (
          data.INTERNAL_WORKER_SECRET.length < 32 ||
          weakSecretPlaceholders.some((p) => workerSecretLower.includes(p))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'INTERNAL_WORKER_SECRET is insecure for production. Must be at least 32 characters and cannot use default placeholders or weak patterns.',
            path: ['INTERNAL_WORKER_SECRET'],
          });
        }
      }
    }
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
