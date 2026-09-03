export const MIN_CLAIM_CONCURRENCY = 1;
export const DEFAULT_CLAIM_CONCURRENCY = 3;
export const MAX_CLAIM_CONCURRENCY = 3;

export function normalizeClaimConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CLAIM_CONCURRENCY;
  }

  return Math.min(
    MAX_CLAIM_CONCURRENCY,
    Math.max(
      MIN_CLAIM_CONCURRENCY,
      Math.floor(value),
    ),
  );
}
