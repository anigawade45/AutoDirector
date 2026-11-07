import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

export const s3Client = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export const StorageKeys = {
  rawVideo: (userId: string, projectId: string, assetId: string) =>
    `users/${userId}/projects/${projectId}/raw/${assetId}.mp4`,

  proxyVideo: (userId: string, projectId: string, assetId: string) =>
    `users/${userId}/projects/${projectId}/proxy/${assetId}_480p.mp4`,

  audioWav: (userId: string, projectId: string, assetId: string) =>
    `users/${userId}/projects/${projectId}/audio/${assetId}.wav`,

  subtitlesAss: (userId: string, projectId: string, planVersion: number) =>
    `users/${userId}/projects/${projectId}/subs/${planVersion}.ass`,

  previewVideo: (userId: string, projectId: string, planVersion: number) =>
    `users/${userId}/projects/${projectId}/previews/${planVersion}.mp4`,

  finalRender: (userId: string, projectId: string, jobId: string) =>
    `users/${userId}/projects/${projectId}/renders/${jobId}.mp4`,

  catalogItem: (kind: 'music' | 'luts' | 'templates' | 'fonts', filename: string) =>
    `library/${kind}/${filename}`,
};
