import type { TrackedItemStatus } from "@/types/portal";

export type PortalSessionCounts = Partial<Record<TrackedItemStatus, number>>;

export function summarizePortalSession(counts: PortalSessionCounts) {
  const reviewed = (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0) + (counts.VERIFIED ?? 0);
  const needsDocuments = counts.REQUIRE_DOC ?? 0;
  const failed = counts.ERROR ?? 0;
  const skipped = counts.SKIPPED ?? 0;
  const filtered = counts.FILTERED ?? 0;
  const active = (counts.PROCESSING ?? 0) + (counts.DISCOVERED ?? 0);
  const finished = reviewed + needsDocuments + failed + skipped + filtered;
  const total = finished + active;

  return {
    total,
    reviewed,
    needsDocuments,
    failed,
    skipped,
    filtered,
    active,
    finished,
    isComplete: total > 0 && active === 0,
    percent: total > 0 ? Math.round((finished / total) * 100) : 0,
  };
}
