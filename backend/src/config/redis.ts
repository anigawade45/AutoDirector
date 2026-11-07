import { Redis } from 'ioredis';
import { env } from './env.js';

export function createRedisConnection(): Redis {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  return client;
}

export const redisConnection = createRedisConnection();

