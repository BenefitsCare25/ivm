import Redis from "ioredis";
import { logger } from "@/lib/logger";

let cachedClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (cachedClient) return cachedClient;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  cachedClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  cachedClient.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });

  cachedClient.on("connect", () => {
    logger.info("Redis connected");
  });

  return cachedClient;
}

export async function disconnectRedis(): Promise<void> {
  if (cachedClient) {
    await cachedClient.quit();
    cachedClient = null;
  }
}
