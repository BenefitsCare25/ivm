import IORedis from "ioredis";
import { logger } from "@/lib/logger";

let cachedConnection: IORedis | null = null;

/**
 * Returns a shared IORedis connection for BullMQ, or null if REDIS_URL is not configured.
 * BullMQ requires its own connection instance (separate from the rate-limiter client)
 * because it sets a custom error handler and maxRetriesPerRequest = null.
 */
export function getQueueConnection(): IORedis | null {
  if (cachedConnection) return cachedConnection;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  cachedConnection = new IORedis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  cachedConnection.on("error", (err: Error) => {
    // Non-fatal: queue will fall back to inline execution
    logger.error({ err }, "[queue] Redis connection error");
  });

  return cachedConnection;
}
