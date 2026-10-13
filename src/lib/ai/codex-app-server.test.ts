import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

test("claim-scoped clients serialize fan-out, avoid forced refresh, and exit after every claim", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ivm-claim-test-"));
  const command = path.join(directory, process.platform === "win32" ? "fake-codex.cmd" : "fake-codex");
  const fixture = path.resolve("src/lib/ai/test-fixtures/codex-server.cjs");
  const logPath = path.join(directory, "events.jsonl");
  await writeFile(command, process.platform === "win32" ? `@"${process.execPath}" "${fixture}"\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${fixture}'\n`, { mode: 0o700 });
  Object.assign(process.env, { CODEX_CLI_PATH: command, CODEX_REVIEW_MODEL: "gpt-6-astra", CODEX_SERVICE_TIER: "fast", CODEX_REVIEW_EFFORT: "medium", IVM_TEST_LOG: logPath, IVM_TEST_SCENARIO: "ok", NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test", NEXTAUTH_URL: "http://localhost:3000", NEXTAUTH_SECRET: "test-secret-for-codex-lifecycle-000", ENCRYPTION_KEY: "0".repeat(64) });
  const { withCodexClaim, runCodexTurn, assertCodexClaimHealthy } = await import("./codex-app-server");
  try {
    for (let i = 0; i < 20; i++) {
      await withCodexClaim(new AbortController().signal, async () => {
        const values = await Promise.all(Array.from({ length: 3 }, () => runCodexTurn({ systemPrompt: "test", userPrompt: "test" })));
        assert.ok(values.every((value) => value.text === "OK" && value.model === "gpt-6-astra" && value.reasoningEffort === "medium" && value.serviceTier === "fast"));
      });
      const currentEntries = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const currentPid = currentEntries.at(-1).pid;
      // Check immediately. Windows can reuse an earlier PID while subsequent
      // claims (or a concurrent build) start new processes.
      assert.throws(() => process.kill(currentPid, 0), `claim ${i} left process ${currentPid} alive`);
    }
    const entries = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.filter((entry) => entry.event === "process-start").length, 20);
    let active = 0;
    for (const entry of entries) {
      if (entry.event === "turn/start") {
        active++;
        assert.equal(active, 1);
        assert.equal(entry.model, "gpt-6-astra");
        assert.equal(entry.effort, "medium");
        assert.equal(entry.serviceTier, "fast");
      }
      if (entry.event === "turn-finished") active--;
      if (entry.event === "account/read") assert.equal(entry.refreshToken, false);
    }
    assert.equal(active, 0);

    process.env.IVM_TEST_SCENARIO = "hang-turn";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("claim cancelled")), 250);
    await assert.rejects(withCodexClaim(controller.signal, () => runCodexTurn({ systemPrompt: "test", userPrompt: "test" })), /claim cancelled/);
    clearTimeout(timer);

    process.env.IVM_TEST_SCENARIO = "fail-turn";
    await assert.rejects(withCodexClaim(new AbortController().signal, async () => {
      await runCodexTurn({ systemPrompt: "test", userPrompt: "test" }).catch(() => undefined);
      assertCodexClaimHealthy();
    }), /did not complete/);

    for (const [scenario, code] of [["wrong-model", "CODEX_MODEL_UNAVAILABLE"], ["fast-unavailable", "CODEX_SERVICE_TIER_UNAVAILABLE"]]) {
      process.env.IVM_TEST_SCENARIO = scenario;
      await assert.rejects(
        withCodexClaim(new AbortController().signal, () => runCodexTurn({ systemPrompt: "test", userPrompt: "test" })),
        (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === code,
      );
      const failures = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const pid = failures.at(-1).pid;
      assert.throws(() => process.kill(pid, 0), `${scenario} left process ${pid} alive`);
      assert.equal(failures.filter((entry) => entry.pid === pid && entry.event === "turn/start").length, 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
