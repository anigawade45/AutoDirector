import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

async function listBucket() {
  const client = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  console.log(`\n📦 S3 Bucket: '${env.S3_BUCKET_NAME}' (LocalStack @ ${env.S3_ENDPOINT})`);
  console.log('='.repeat(70));

  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: env.S3_BUCKET_NAME,
    })
  );

  if (!res.Contents || res.Contents.length === 0) {
    console.log('  (Bucket is empty)');
    return;
  }

  res.Contents.forEach((item, idx) => {
    const sizeMb = ((item.Size || 0) / (1024 * 1024)).toFixed(2);
    const date = item.LastModified?.toLocaleTimeString() || '';
    console.log(`  [${idx + 1}] ${item.Key} (${sizeMb} MB) - ${date}`);
  });

  console.log('='.repeat(70));
  console.log(`Total objects: ${res.Contents.length}\n`);
}

listBucket().catch(console.error);
