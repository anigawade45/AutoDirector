import { S3Service } from '../services/storage/s3Service.js';
import { env } from '../config/env.js';

async function main() {
  console.log(`[CORS] Configuring hardened CORS rules on S3 bucket '${env.S3_BUCKET_NAME}'...`);
  const success = await S3Service.configureBucketCors();
  if (success) {
    console.log('[CORS] S3 bucket CORS configured successfully!');
  } else {
    console.warn('[CORS] S3 bucket CORS configuration completed with notes.');
  }
}

main().catch(console.error);
