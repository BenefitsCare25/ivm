import { constants } from "node:fs";
import { chown, copyFile, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function migrateClaimReliabilityEnv(contents) {
  if (/^[ \t]*(?:export[ \t]+)?IVM_CLAIM_RELIABILITY_MIGRATED[ \t]*=[ \t]*(?:"1"|'1'|1)[ \t]*\r?$/m.test(contents)) return contents;
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  function existingNumber(key) {
    const matches = [...contents.matchAll(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*["']?(\\d+)["']?[ \\t]*\\r?$`, "gm"))];
    return Math.max(0, ...matches.map((match) => Number(match[1])));
  }
  const aiTimeout = Math.max(600_000, existingNumber("CODEX_AI_TIMEOUT_MS"));
  const settings = {
    CODEX_AI_TIMEOUT_MS: aiTimeout,
    ITEM_DETAIL_JOB_TIMEOUT_MS: Math.max(1_200_000, aiTimeout + 60_000, existingNumber("ITEM_DETAIL_JOB_TIMEOUT_MS")),
    IVM_CLAIM_RELIABILITY_MIGRATED: 1,
  };
  let updated = contents;
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, "gm");
    const line = `${key}="${value}"`;
    if (pattern.test(updated)) updated = updated.replace(pattern, () => line);
    else updated += `${updated.endsWith("\n") ? "" : newline}${line}${newline}`;
  }
  return updated;
}

async function main() {
  const [envPath] = process.argv.slice(2);
  if (!envPath || !path.isAbsolute(envPath)) throw new Error("Usage: migrate-claim-reliability-env.mjs ABSOLUTE_ENV_PATH");
  const original = await readFile(envPath, "utf8");
  const updated = migrateClaimReliabilityEnv(original);
  if (updated === original) { console.log("Claim reliability configuration already migrated"); return; }
  const metadata = await stat(envPath);
  const backupPath = `${envPath}.before-claim-reliability`;
  try {
    await copyFile(envPath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST" || await readFile(backupPath, "utf8") !== original) throw error;
  }
  const directory = await mkdtemp(path.join(path.dirname(envPath), ".ivm-claim-"));
  if (path.dirname(directory) !== path.dirname(envPath) || !path.basename(directory).startsWith(".ivm-claim-")) throw new Error("Invalid temporary configuration directory");
  try {
    const temporaryPath = path.join(directory, "env");
    await writeFile(temporaryPath, updated, { mode: metadata.mode & 0o777 });
    if (process.platform !== "win32") await chown(temporaryPath, metadata.uid, metadata.gid);
    await rename(temporaryPath, envPath);
    console.log("Extended AI-call timeout to at least 10 minutes and claim timeout to at least 20 minutes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
