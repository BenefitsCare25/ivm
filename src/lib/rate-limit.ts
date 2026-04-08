interface RateLimitEntry {
  count: number;
  resetAt: number;
}

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

export function createRateLimiter(config: RateLimitConfig) {
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);

  if (cleanupInterval.unref) cleanupInterval.unref();

  return function check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + config.windowMs });
      return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt: now + config.windowMs };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= config.limit,
      limit: config.limit,
      remaining: Math.max(0, config.limit - entry.count),
      resetAt: entry.resetAt,
    };
  };
}

/** 100 req/min per IP for all API routes */
export const globalLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 });

/** 10 req/min per IP for auth routes (login, register) */
export const authLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** 5 req/min per user for AI routes (extract, mapping) */
export const aiLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
