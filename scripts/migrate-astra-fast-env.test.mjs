import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateAstraFastEnv } from "./migrate-astra-fast-env.mjs";

const runtimePath = process.platform === "win32" ? "C:/ivm/node_modules/.bin/codex.cmd" : "/var/www/ivm/node_modules/.bin/codex";

test("the migration preserves secrets, unrelated settings and CRLF", () => {
  const protectedLines = 'DATABASE_URL="postgresql://private/db"\r\nNEXTAUTH_SECRET="a-private-test-value"\r\nIVM_CODEX_HOME="/var/lib/ivm/codex"\r\n';
  const original = protectedLines + 'CODEX_REVIEW_MODEL="gpt-5.6-terra"\r\nCODEX_REVIEW_EFFORT="medium"\r\n';
  const updated = migrateAstraFastEnv(original, runtimePath);
  assert.ok(updated.startsWith(protectedLines));
  assert.match(updated, /^CODEX_REVIEW_MODEL="gpt-6-astra"\r$/m);
  assert.match(updated, /^CODEX_SERVICE_TIER="fast"\r$/m);
  assert.equal(updated.replace(/\r\n/g, "").includes("\n"), false);
});

test("later deployments preserve an administrator's subsequent AI settings", () => {
  const migrated = migrateAstraFastEnv('CODEX_REVIEW_MODEL="gpt-5.6-terra"\n', runtimePath);
  const customized = migrated.replace('CODEX_REVIEW_EFFORT="medium"', 'CODEX_REVIEW_EFFORT="high"').replace('CODEX_SERVICE_TIER="fast"', 'CODEX_SERVICE_TIER="default"');
  assert.equal(migrateAstraFastEnv(customized, runtimePath), customized);
});

test("duplicate legacy settings cannot leave a conflicting effective model", () => {
  const original = 'export CODEX_REVIEW_MODEL="gpt-5.6-terra"\nCODEX_REVIEW_MODEL=gpt-5.6-sol\n';
  const updated = migrateAstraFastEnv(original, runtimePath);
  assert.equal(updated.match(/^CODEX_REVIEW_MODEL="gpt-6-astra"$/gm)?.length, 2);
  assert.equal(updated.includes("gpt-5.6-terra"), false);
  assert.equal(updated.includes("gpt-5.6-sol"), false);
});

test("the CLI preserves a protected backup and can resume after a saved backup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ivm-astra-env-test-"));
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("ivm-astra-env-test-"));
  try {
    const envPath = path.join(directory, ".env");
    const original = 'PRIVATE_TEST_SECRET="keep-this-private"\nCODEX_REVIEW_MODEL="gpt-5.6-terra"\n';
    await writeFile(envPath, original, { mode: 0o600 });
    await writeFile(`${envPath}.before-astra-fast`, original, { mode: 0o600 });
    const script = fileURLToPath(new URL("./migrate-astra-fast-env.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, envPath, runtimePath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(`${envPath}.before-astra-fast`, "utf8"), original);
    assert.match(await readFile(envPath, "utf8"), /^CODEX_REVIEW_MODEL="gpt-6-astra"$/m);
    assert.equal(result.stdout.includes("keep-this-private"), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(envPath)).mode & 0o777, 0o600);
      assert.equal((await stat(`${envPath}.before-astra-fast`)).mode & 0o777, 0o600);
    }
    const repeated = spawnSync(process.execPath, [script, envPath, runtimePath], { encoding: "utf8" });
    assert.equal(repeated.status, 0, repeated.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
