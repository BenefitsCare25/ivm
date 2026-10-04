import assert from "node:assert/strict";
import test from "node:test";
import { getAIConnectionState } from "./ai-connection-status";
import type { ChatGptStatus } from "@/components/settings/use-chatgpt-status";

const connected: ChatGptStatus = { configured: true, connected: true, model: "test", reasoningEffort: "low", selectedModelAvailable: true, message: null, workerReady: true, workerState: "ready" };
test("a connected web account cannot hide an unavailable processing worker", () => {
  for (const workerState of ["starting", "recovering", "offline"] as const) {
    const state = getAIConnectionState(null, { ...connected, workerState, workerReady: false }, false);
    assert.equal(state.blocked, true);
    assert.equal(state.label, "Waiting for AI recovery");
  }
  assert.equal(getAIConnectionState(null, { ...connected, workerReady: undefined }, false).blocked, true);
  assert.equal(getAIConnectionState(null, connected, false).blocked, false);
});
test("explicit API selections remain independent of ChatGPT recovery", () => {
  assert.equal(getAIConnectionState("vertex:test", { ...connected, workerReady: false }, false).blocked, false);
});
