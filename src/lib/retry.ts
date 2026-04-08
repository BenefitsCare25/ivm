import { logger } from "@/lib/logger";

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  operation?: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes("fetch failed") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")) {
      return true;
    }
    if (err.name === "AbortError" || err.message.includes("timed out")) {
      return false;
    }
  }
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return RETRYABLE_STATUS_CODES.has(status);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 1000, operation = "operation" } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(
        { attempt: attempt + 1, maxRetries, delayMs: delay, operation, error: (err as Error).message },
        `Retrying ${operation} after transient failure`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
