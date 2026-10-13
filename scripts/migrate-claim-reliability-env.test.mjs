import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateClaimReliabilityEnv } from "./migrate-claim-reliability-env.mjs";

test("raises existing production deadlines and preserves unrelated settings and CRLF", () => {
  const protectedLines = 'PRIVATE_SECRET="unchanged"\r\nCODEX_REVIEW_MODEL="gpt-6-astra"\r\n';
  const result = migrateClaimReliabilityEnv(protectedLines + 'CODEX_AI_TIMEOUT_MS="300000"\r\n');
  assert.ok(result.startsWith(protectedLines));
  assert.match(result, /^CODEX_AI_TIMEOUT_MS="600000"\r$/m);
  assert.match(result, /^ITEM_DETAIL_JOB_TIMEOUT_MS="1200000"\r$/m);
  assert.equal(result.replaceAll("\r\n", "").includes("\n"), false);
});

test("preserves larger custom deadlines and subsequent administrator changes", () => {
  const result = migrateClaimReliabilityEnv('CODEX_AI_TIMEOUT_MS=1800000\nITEM_DETAIL_JOB_TIMEOUT_MS=2400000\n');
  assert.match(result, /^CODEX_AI_TIMEOUT_MS="1800000"$/m);
  assert.match(result, /^ITEM_DETAIL_JOB_TIMEOUT_MS="2400000"$/m);
  const customized = result.replace('"1800000"', '"1500000"');
  assert.equal(migrateClaimReliabilityEnv(customized), customized);
  const longTurn = migrateClaimReliabilityEnv('CODEX_AI_TIMEOUT_MS=1800000\n');
  assert.match(longTurn, /^ITEM_DETAIL_JOB_TIMEOUT_MS="1860000"$/m);
});

test("atomic CLI migration preserves the protected backup and resumes safely", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ivm-claim-env-test-"));
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("ivm-claim-env-test-"));
  try {
    const envPath = path.join(directory, ".env");
    const original = 'PRIVATE_SECRET="never-log-me"\nCODEX_AI_TIMEOUT_MS=300000\n';
    await writeFile(envPath, original, { mode: 0o600 });
    await writeFile(`${envPath}.before-claim-reliability`, original, { mode: 0o600 });
    const script = fileURLToPath(new URL("./migrate-claim-reliability-env.mjs", import.meta.url));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [script, envPath], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.includes("never-log-me"), false);
    }
    assert.equal(await readFile(`${envPath}.before-claim-reliability`, "utf8"), original);
    assert.match(await readFile(envPath, "utf8"), /^CODEX_AI_TIMEOUT_MS="600000"$/m);
    if (process.platform !== "win32") {
      assert.equal((await stat(envPath)).mode & 0o777, 0o600);
      assert.equal((await stat(`${envPath}.before-claim-reliability`)).mode & 0o777, 0o600);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
