import assert from "node:assert/strict";
import test from "node:test";
import { aiRecoveryDecision, validWorkerHealth } from "./codex-recovery-policy";

const now = 1_000_000;
const ready = { state: "ready", updatedAt: now, lastVerifiedAt: now, lastInferenceAt: now - 500, retryAt: now + 60_000 };
test("worker readiness requires a fresh heartbeat and successful worker checks", () => {
  assert.equal(validWorkerHealth(ready, now).state, "ready");
  assert.equal(validWorkerHealth(ready, now + 45_001).state, "offline");
  assert.equal(validWorkerHealth({ ...ready, updatedAt: now + 10_000 }, now).state, "offline");
  assert.equal(validWorkerHealth({ ...ready, lastVerifiedAt: now - 120_001 }, now).state, "offline");
  assert.equal(validWorkerHealth({ ...ready, lastInferenceAt: null }, now).state, "offline");
  for (const invalid of [null, {}, "ready", { connected: true }]) assert.equal(validWorkerHealth(invalid, now).state, "offline");
});
test("recovery and reconnection stay distinct even when the web account is connected", () => {
  for (const state of ["recovering", "reconnect", "starting"]) assert.equal(validWorkerHealth({ ...ready, state }, now).state, state);
});
test("AI infrastructure retries use bounded backoff and stop after three attempts", () => {
  assert.deepEqual(aiRecoveryDecision(), { attempts: 1, exhausted: false, delayMs: 30_000 });
  assert.deepEqual(aiRecoveryDecision(1), { attempts: 2, exhausted: false, delayMs: 60_000 });
  assert.equal(aiRecoveryDecision(2).exhausted, true);
  assert.equal(aiRecoveryDecision(100).delayMs, 300_000);
});
