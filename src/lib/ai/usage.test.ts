import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAIUsageEvents } from "./usage";

test("aggregates Vertex usage by model and applies regional Gemini 3.5 Flash pricing", () => {
  const summary = summarizeAIUsageEvents([
    { payload: { provider: "vertex", model: "gemini-3.5-flash", inputTokens: 600_000, outputTokens: 100_000 } },
    { payload: { provider: "vertex", model: "gemini-3.5-flash", inputTokens: 400_000, outputTokens: 900_000 } },
  ]);

  assert.equal(summary?.inputTokens, 1_000_000);
  assert.equal(summary?.outputTokens, 1_000_000);
  assert.equal(summary?.estimatedCostUsd, 11.55);
  assert.deepEqual(summary?.models.map((entry) => entry.model), ["gemini-3.5-flash"]);
});

test("returns no summary for legacy events without usage metadata", () => {
  assert.equal(summarizeAIUsageEvents([{ payload: { operation: "comparison" } }]), null);
});

test("keeps token totals but omits a misleading cost for an unpriced model", () => {
  const summary = summarizeAIUsageEvents([
    { payload: { provider: "vertex", model: "future-model", inputTokens: 10, outputTokens: 20 } },
  ]);

  assert.equal(summary?.inputTokens, 10);
  assert.equal(summary?.outputTokens, 20);
  assert.equal(summary?.estimatedCostUsd, null);
});
