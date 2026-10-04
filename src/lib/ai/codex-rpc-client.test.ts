import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { CodexRpcClient, isCodexInfrastructureError } from "./codex-rpc-client";

const fixture = path.resolve("src/lib/ai/test-fixtures/codex-server.cjs");
function client(mode = "ok", extra: Record<string, string> = {}) {
  return new CodexRpcClient({ command: process.execPath, args: [fixture], environment: { ...process.env, IVM_TEST_SCENARIO: mode, ...extra }, requestTimeoutMs: 500, turnTimeoutMs: 150, shutdownGraceMs: 80 });
}
function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("concurrent cold requests wait for one initialization", async () => {
  const rpc = client("slow-init");
  try {
    const accounts = await Promise.all(Array.from({ length: 8 }, () => rpc.request<{ account: { type: string } }>("account/read")));
    assert.ok(accounts.every((a) => a.account.type === "chatgpt"));
  } finally { await rpc.close(); }
  assert.equal(alive(rpc.pid), false);
});

for (const mode of ["hang-init", "hang-account", "crash-account"]) {
  test(`${mode} rejects all pending requests and closes the process`, async () => {
    const rpc = client(mode);
    const outcomes = await Promise.allSettled([rpc.request("account/read"), rpc.request("account/read")]);
    assert.ok(outcomes.every((outcome) => outcome.status === "rejected" && isCodexInfrastructureError(outcome.reason)));
    await rpc.close();
    assert.equal(alive(rpc.pid), false);
    await assert.rejects(rpc.request("account/read"));
  });
}

test("a timed-out turn is interrupted and its process exits before close resolves", async () => {
  const rpc = client("hang-turn");
  await rpc.request("account/read");
  await assert.rejects(rpc.runTurn("thread", {}), /timed out/);
  await rpc.close();
  assert.equal(alive(rpc.pid), false);
});

test("late events cannot complete a cancelled turn", async () => {
  const rpc = client();
  await rpc.request("account/read");
  const turn = rpc.runTurn("thread", {});
  void turn.catch(() => undefined);
  await rpc.interruptAndClose(new Error("claim cancelled"));
  await assert.rejects(turn, /claim cancelled/);
  assert.equal(alive(rpc.pid), false);
});

test("successful turns return text and release their process", async () => {
  const rpc = client();
  try {
    await rpc.request("account/read");
    assert.equal((await rpc.runTurn("thread", {})).text, "OK");
  } finally { await rpc.close(); }
  assert.equal(alive(rpc.pid), false);
});

test("Linux process-group cleanup kills a descendant that ignores SIGTERM", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ivm-tree-test-"));
  const logPath = path.join(directory, "events.jsonl");
  const rpc = client("stubborn-descendant", { IVM_TEST_LOG: logPath });
  try {
    await assert.rejects(rpc.request("account/read"));
    await rpc.close();
    const entries = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const pid = entries.find((entry) => entry.event === "descendant").childPid;
    // An orphan may briefly remain as a zombie until init reaps it; it cannot execute.
    let status = "";
    try { status = await readFile(`/proc/${pid}/status`, "utf8"); } catch { /* reaped */ }
    assert.ok(!status || /^State:\s+Z/m.test(status));
  } finally { await rpc.close(); await rm(directory, { recursive: true, force: true }); }
});
