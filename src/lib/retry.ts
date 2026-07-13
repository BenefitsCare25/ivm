import { logger } from "@/lib/logger";

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  operation?: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// Transient network/connection failures worth a retry. Notably includes the
// undici "terminated" / "other side closed" errors seen when a self-hosted model
// server drops a connection mid-request under load.
const RETRYABLE_MESSAGE_PATTERNS = [
  "fetch failed",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "terminated",
  "other side closed",
  "socket hang up",
  "Connection error",
];

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Never retry timeouts/aborts — a retry would just burn another full timeout.
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message.includes("timed out") ||
      err.message.includes("operation was aborted")
    ) {
      return false;
    }
    const msg = err.message;
    if (RETRYABLE_MESSAGE_PATTERNS.some((p) => msg.includes(p))) return true;
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
