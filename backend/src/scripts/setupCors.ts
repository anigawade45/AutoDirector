import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/s3.js';
import { env } from '../config/env.js';

async function main() {
  console.log(`[CORS] Configuring CORS rules on S3 bucket '${env.S3_BUCKET_NAME}'...`);
  await s3Client.send(
    new PutBucketCorsCommand({
      Bucket: env.S3_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: ['*'],
            ExposeHeaders: ['ETag', 'x-amz-request-id', 'x-amz-id-2'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    })
  );
  console.log('[CORS] S3 bucket CORS configured successfully!');
}

main().catch(console.error);
