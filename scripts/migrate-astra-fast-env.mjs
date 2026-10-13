import { constants } from "node:fs";
import { chown, copyFile, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const marker = "IVM_ASTRA_FAST_MIGRATED";

export function migrateAstraFastEnv(contents, runtimePath) {
  if (!path.isAbsolute(runtimePath) || /[\r\n"\0]/.test(runtimePath)) {
    throw new Error("The pinned runtime needs a valid absolute path");
  }
  if (/^[ \t]*(?:export[ \t]+)?IVM_ASTRA_FAST_MIGRATED[ \t]*=[ \t]*(?:"1"|'1'|1)[ \t]*\r?$/m.test(contents)) {
    return contents;
  }
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  let updated = contents;
  const settings = {
    CODEX_CLI_PATH: runtimePath,
    CODEX_REVIEW_MODEL: "gpt-6-astra",
    CODEX_REVIEW_EFFORT: "medium",
    CODEX_SERVICE_TIER: "fast",
    [marker]: "1",
  };
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, "gm");
    const line = `${key}="${value}"`;
    if (pattern.test(updated)) updated = updated.replace(pattern, () => line);
    else updated += `${updated.endsWith("\n") ? "" : newline}${line}${newline}`;
  }
  return updated;
}

async function main() {
  const [envPath, runtimePath] = process.argv.slice(2);
  if (!envPath || !runtimePath || !path.isAbsolute(envPath)) {
    throw new Error("Usage: migrate-astra-fast-env.mjs ABSOLUTE_ENV_PATH ABSOLUTE_RUNTIME_PATH");
  }
  const original = await readFile(envPath, "utf8");
  const updated = migrateAstraFastEnv(original, runtimePath);
  if (updated === original) {
    console.log("Astra/Fast configuration migration already applied");
    return;
  }
  const metadata = await stat(envPath);
  const backupPath = `${envPath}.before-astra-fast`;
  try {
    await copyFile(envPath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    // A failed attempt may have saved its backup before the atomic rename.
    if (error.code !== "EEXIST" || await readFile(backupPath, "utf8") !== original) throw error;
  }
  const directory = await mkdtemp(path.join(path.dirname(envPath), ".ivm-astra-"));
  const relative = path.relative(path.dirname(envPath), directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Temporary configuration path escaped its directory");
  try {
    const temporaryPath = path.join(directory, "env");
    await writeFile(temporaryPath, updated, { mode: metadata.mode & 0o777 });
    if (process.platform !== "win32") await chown(temporaryPath, metadata.uid, metadata.gid);
    await rename(temporaryPath, envPath);
    console.log("Applied GPT-6 Astra, medium reasoning, Fast mode and the pinned runtime");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
