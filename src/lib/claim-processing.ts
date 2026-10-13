import type { ItemEventSummary, TrackedItemStatus } from "@/types/portal";

export const ACTIVE_CLAIM_STATUSES = ["DISCOVERED", "PROCESSING", "RETRYING"] as const;
export const QUEUED_CLAIM_STATUSES = ["DISCOVERED", "RETRYING"] as const;

export function isActiveClaimStatus(status: string): boolean {
  return ACTIVE_CLAIM_STATUSES.some((active) => active === status);
}

export function getClaimActivity(events: ItemEventSummary[], status: TrackedItemStatus) {
  const attemptStart = events.findLastIndex((event) => event.eventType === "AI_ATTEMPT_START");
  const current = attemptStart < 0 ? events : events.slice(attemptStart);
  const started = new Set(current.filter((event) => event.eventType === "AI_EXTRACT_START").map((event) => event.payload.fileName ?? event.id));
  const done = new Set(current.filter((event) => event.eventType === "AI_EXTRACT_DONE").map((event) => event.payload.fileName ?? event.id));
  const failed = current.filter((event) => event.eventType === "AI_EXTRACT_FAIL" || event.eventType === "AI_RETRY_EXHAUSTED").length;
  const truncated = current.filter((event) => event.eventType === "AI_EXTRACT_TRUNCATED").length;
  return { started: started.size, done: done.size, failed, truncated,
    retrying: status === "RETRYING", attempt: current[0]?.eventType === "AI_ATTEMPT_START" ? Number(current[0].payload.attempt) : undefined };
}
