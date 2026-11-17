import { Redis } from 'ioredis';
import { env } from './env.js';

export function createRedisConnection(): Redis {
  const isTls = env.REDIS_TLS || env.REDIS_HOST.includes('upstash.io');
  const cleanPassword = env.REDIS_PASSWORD
    ? env.REDIS_PASSWORD.trim().replace(/@$/, '')
    : undefined;

  const client = new Redis({
    host: env.REDIS_HOST.trim(),
    port: env.REDIS_PORT,
    password: cleanPassword,
    tls: isTls ? {} : undefined,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy(times) {
      // Backoff strategy (1s, 2s... max 10s) to prevent spamming Upstash command quota on failures
      return Math.min(times * 1000, 10000);
    },
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  return client;
}

export const redisConnection = createRedisConnection();
