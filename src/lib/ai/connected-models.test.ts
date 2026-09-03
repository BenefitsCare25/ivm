import assert from "node:assert/strict";
import test from "node:test";
import {
  getConnectedAIModelOptions,
  parsePortalAISelection,
  serializePortalAISelection,
} from "./connected-models";

test("lists models only for connected providers", () => {
  const options = getConnectedAIModelOptions(["vertex"], null);
  assert.deepEqual(options.map((option) => option.value), ["vertex:gemini-3.5-flash"]);
});

test("round trips a provider-qualified portal selection", () => {
  const value = serializePortalAISelection("vertex", "gemini-3.5-flash");
  assert.deepEqual(parsePortalAISelection(value), {
    provider: "vertex",
    model: "gemini-3.5-flash",
  });
  assert.equal(parsePortalAISelection("claude-sonnet-4-6"), null);
});

test("includes a validated freeform model for a connected local provider", () => {
  const options = getConnectedAIModelOptions(["local"], {
    local: { visionModel: "custom-vision-model", textModel: "custom-text-model" },
  });
  assert.ok(options.some((option) => option.value === "local:custom-vision-model"));
  assert.ok(options.some((option) => option.value === "local:custom-text-model"));
});
