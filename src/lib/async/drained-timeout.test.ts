import assert from "node:assert/strict";
import test from "node:test";
import { runWithDrainedTimeout } from "./drained-timeout";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("timeout aborts work but does not settle until cleanup finishes", async () => {
  let releaseCleanup!: () => void;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  let aborted = false;

  const run = runWithDrainedTimeout(
    async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      await cleanupGate;
      return "finished";
    },
    10,
    "test-task",
  );

  await delay(30);
  assert.equal(aborted, true);

  const stateBeforeCleanup = await Promise.race([
    run.then(() => "settled", () => "settled"),
    delay(20).then(() => "pending"),
  ]);
  assert.equal(stateBeforeCleanup, "pending");

  releaseCleanup();
  await assert.rejects(run, /Timed out after/);
});

test("upstream cancellation is propagated and drained", async () => {
  const upstream = new AbortController();
  let releaseCleanup!: () => void;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });

  const run = runWithDrainedTimeout(
    async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await cleanupGate;
    },
    1_000,
    "test-task",
    upstream.signal,
  );

  upstream.abort(new Error("lease lost"));
  await delay(10);
  releaseCleanup();
  await assert.rejects(run, /lease lost/);
});
