import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCanvas } from "canvas";
import { env } from "../src/lib/env";
import { listCodexModels, runCodexTurn, withCodexClaim } from "../src/lib/ai/codex-app-server";

async function main() {
  assert.equal(env.CODEX_REVIEW_MODEL, "gpt-6-astra");
  assert.equal(env.CODEX_REVIEW_EFFORT, "medium");
  assert.equal(env.CODEX_SERVICE_TIER, "fast");
  const version = execFileSync(env.CODEX_CLI_PATH || "codex", ["--version"], { encoding: "utf8" }).trim();
  assert.equal(version, "codex-cli 0.162.1", "Use the project-pinned Codex runtime");
  const model = (await listCodexModels()).find((entry) => entry.id === env.CODEX_REVIEW_MODEL);
  assert.ok(model, "Astra must be offered by the production account");
  assert.ok(model.inputModalities.includes("image"), "Astra must support document images");
  assert.ok(model.supportedReasoningEfforts.includes("medium"), "Medium reasoning must be supported");

  // Synthetic data only: verify the same image and JSON contract used by claims.
  const canvas = createCanvas(1400, 650);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "38px monospace";
  [
    "FINAL TAX INVOICE",
    "INVOICE NO: INV-O0-I1-1001",
    "INVOICE DATE: 13/10/2026",
    "TOTAL (SGD): 128.40",
    "THIS IS THE FINAL BILL",
  ].forEach((line, index) => context.fillText(line, 60, 100 + index * 100));

  const startedAt = Date.now();
  const result = await withCodexClaim(AbortSignal.timeout(60_000), () => runCodexTurn({
    systemPrompt: 'Read the supplied synthetic invoice. Return only JSON with invoiceNumber, invoiceDate, totalAmount, and billStatus. Preserve the identifier character-for-character. Use YYYY-MM-DD for the date, a string with two decimals for the amount, and final/interim/unknown for billStatus. Never use tools.',
    userPrompt: "Extract the four requested fields from this synthetic tax invoice.",
    images: [{ data: canvas.toBuffer("image/png"), mimeType: "image/png" }],
  }));
  assert.deepEqual(JSON.parse(result.text), {
    invoiceNumber: "INV-O0-I1-1001",
    invoiceDate: "2026-10-13",
    totalAmount: "128.40",
    billStatus: "final",
  }, "Astra must read the invoice and return the required JSON");
  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.reasoningEffort, "medium");
  assert.equal(result.serviceTier, "fast");
  console.log(JSON.stringify({
    status: "passed", version, model: result.model, reasoningEffort: result.reasoningEffort,
    serviceTier: result.serviceTier, reasoningMode: "standard", durationMs: Date.now() - startedAt,
  }));
}

main().catch((error: unknown) => {
  console.error("Astra/Fast preflight failed", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
});
