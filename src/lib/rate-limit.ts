import { getRedisClient } from "./redis";

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createInMemoryStore() {
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);

  if (cleanupInterval.unref) cleanupInterval.unref();

  return {
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const now = Date.now();

      if (store.size > 10_000) {
        for (const [k, e] of store) {
          if (e.resetAt <= now) store.delete(k);
        }
      }

      const entry = store.get(key);

      if (!entry || entry.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs };
      }

      entry.count += 1;
      return {
        allowed: entry.count <= limit,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: entry.resetAt,
      };
    },
  };
}

const inMemoryStore = createInMemoryStore();

const redisStore = {
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redis = getRedisClient();
    if (!redis) {
      return inMemoryStore.check(key, limit, windowMs);
    }

    const now = Date.now();
    const windowKey = `rl:${key}:${Math.floor(now / windowMs)}`;
    const windowExpirySec = Math.ceil(windowMs / 1000) + 1;

    try {
      const count = await redis.incr(windowKey);
      if (count === 1) {
        await redis.expire(windowKey, windowExpirySec);
      }

      const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;

      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    } catch {
      return inMemoryStore.check(key, limit, windowMs);
    }
  },
};

export function createRateLimiter(config: RateLimitConfig) {
  return function check(key: string): Promise<RateLimitResult> {
    const redis = getRedisClient();
    const store = redis ? redisStore : inMemoryStore;
    return store.check(key, config.limit, config.windowMs);
  };
}

/** 100 req/min per IP for all API routes */
export const globalLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 });

/** 10 req/min per IP for auth routes (login, register) */
export const authLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** 5 req/min per user for AI routes (extract, mapping) */
export const aiLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
