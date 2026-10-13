import assert from "node:assert/strict";
import test from "node:test";
import { getClaimActivity, isActiveClaimStatus } from "./claim-processing";
import { summarizePortalSession } from "./portal-session-summary";
import type { ItemEventSummary } from "@/types/portal";

function event(id: string, eventType: string, payload = {}): ItemEventSummary {
  return { id, eventType, payload, screenshotPath: null, durationMs: null, createdAt: new Date(0).toISOString() } as ItemEventSummary;
}

test("retry-only sessions stay active and never count as completed reviews", () => {
  const result = summarizePortalSession({ FLAGGED: 2, RETRYING: 1 });
  assert.equal(result.active, 1);
  assert.equal(result.finished, 2);
  assert.equal(result.isComplete, false);
  assert.equal(result.total, 3);
  assert.equal(isActiveClaimStatus("RETRYING"), true);
  assert.equal(isActiveClaimStatus("FLAGGED"), false);
});

test("extraction progress belongs to the current attempt, not accumulated retries", () => {
  const events = [
    event("1", "AI_ATTEMPT_START", { attempt: 1 }),
    event("2", "AI_EXTRACT_START", { fileName: "document.pdf" }),
    event("3", "AI_EXTRACT_DONE", { fileName: "document.pdf" }),
    event("4", "AI_EXTRACT_FAIL"),
    event("5", "AI_RETRY_SCHEDULED"),
    event("6", "AI_ATTEMPT_START", { attempt: 2 }),
    event("7", "AI_EXTRACT_START", { fileName: "document.pdf" }),
  ];
  const result = getClaimActivity(events, "PROCESSING");
  assert.equal(result.attempt, 2);
  assert.equal(result.started, 1);
  assert.equal(result.done, 0);
  assert.equal(result.failed, 0);
  assert.equal(getClaimActivity(events.slice(0, 5), "RETRYING").retrying, true);
});
