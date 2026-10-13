import assert from "node:assert/strict";
import test from "node:test";
import { DelayedError } from "bullmq";
import { AppError } from "@/lib/errors";
import { scheduleClaimAiRetry, type ClaimRetryState } from "./item-detail-ai-retry";
import type { ItemDetailJobData } from "./item-detail-queue";

function fixture(previousAttempts = 0, saveAllowed = true) {
  const calls: string[] = [];
  let state: ClaimRetryState | undefined;
  let event: { type: string; payload: Record<string, unknown> } | undefined;
  let delayedAt: number | undefined;
  const job = {
    data: { trackedItemId: "claim", portalId: "portal", scrapeSessionId: "session", userId: "user", aiRecoveryAttempts: previousAttempts } as ItemDetailJobData,
    token: "owned-lock",
    updateData: async (data: ItemDetailJobData) => { calls.push("job-data"); job.data = data; },
    moveToDelayed: async (at: number, token?: string) => { assert.equal(token, "owned-lock"); calls.push("delayed"); delayedAt = at; },
  };
  const dependencies = {
    timeoutMs: 600_000,
    now: () => 1_000_000,
    pauseAdmission: async () => { calls.push("pause"); },
    save: async (value: ClaimRetryState) => { calls.push("save"); state = value; return saveAllowed; },
    emit: async (type: string, payload: Record<string, unknown>) => { calls.push("event"); event = { type, payload }; },
    syncProgress: async () => { calls.push("progress"); },
  };
  return { job, dependencies, calls, get state() { return state; }, get event() { return event; }, get delayedAt() { return delayedAt; } };
}
const timeout = new AppError("provider details must stay private", 504, "CODEX_TURN_TIMEOUT");

test("a timeout persists a visible retry, preserved documents and a bounded attempt before delaying", async () => {
  const f = fixture();
  await assert.rejects(scheduleClaimAiRetry(f.job, timeout, f.dependencies), DelayedError);
  assert.deepEqual(f.calls, ["pause", "job-data", "save", "event", "progress", "delayed"]);
  assert.equal(f.state?.status, "RETRYING");
  assert.equal(f.state?.aiRecoveryAttempts, 1);
  assert.equal(f.state?.retryAt?.getTime(), 1_030_000);
  assert.match(f.state?.errorMessage ?? "", /10 minutes.*Automatic retry queued/);
  assert.equal(f.state?.errorMessage.includes("provider details"), false);
  assert.equal(f.job.data.aiRecoveryAttempts, 1);
  assert.equal((f.job.data as { resumeDownloaded?: boolean }).resumeDownloaded, true);
  assert.equal(f.event?.type, "AI_RETRY_SCHEDULED");
  assert.equal(f.event?.payload.attempt, 2);
  assert.equal(f.delayedAt, 1_030_000);
});

test("the second retry backs off and the third actual failure becomes a terminal result", async () => {
  const second = fixture(1);
  await assert.rejects(scheduleClaimAiRetry(second.job, timeout, second.dependencies), DelayedError);
  assert.equal(second.delayedAt, 1_060_000);
  const third = fixture(2);
  const result = await scheduleClaimAiRetry(third.job, timeout, third.dependencies);
  assert.equal(result.status, "FAILED");
  assert.equal(third.state?.status, "ERROR");
  assert.equal(third.state?.aiRecoveryAttempts, 3);
  assert.equal(third.state?.retryAt, null);
  assert.equal(third.event?.type, "AI_RETRY_EXHAUSTED");
  assert.deepEqual(third.calls, ["pause", "save", "event", "progress"]);
});

test("a deleted or cancelled claim is not revived by a late failure", async () => {
  const f = fixture(0, false);
  await scheduleClaimAiRetry(f.job, timeout, f.dependencies);
  assert.equal(f.delayedAt, undefined);
  assert.equal(f.event, undefined);
  assert.equal(f.calls.includes("progress"), false);
});

test("a persistence failure cannot masquerade as a successful queued retry", async () => {
  const f = fixture();
  f.dependencies.save = async () => { throw new Error("database unavailable"); };
  await assert.rejects(scheduleClaimAiRetry(f.job, timeout, f.dependencies), /database unavailable/);
  assert.equal(f.delayedAt, undefined);
  assert.equal(f.event, undefined);
});
