import type { TrackedItemStatus } from "@/types/portal";

const PRESERVABLE_COMPARISON_STATUSES = new Set<TrackedItemStatus>([
  "COMPARED",
  "FLAGGED",
  "VERIFIED",
  "REQUIRE_DOC",
]);

/** Keep the last successful terminal status when a rerun is intentionally non-destructive. */
export function resolvePreservedComparisonStatus(
  preservePrior: boolean,
  priorStatus: TrackedItemStatus | undefined
): TrackedItemStatus | null {
  if (!preservePrior || !priorStatus || !PRESERVABLE_COMPARISON_STATUSES.has(priorStatus)) {
    return null;
  }
  return priorStatus;
}
