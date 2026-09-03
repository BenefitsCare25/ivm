import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreservedComparisonStatus } from "@/lib/comparison-status";

test("preserves a successful status when every rerun extraction is rejected", () => {
  assert.equal(resolvePreservedComparisonStatus(true, "VERIFIED"), "VERIFIED");
  assert.equal(resolvePreservedComparisonStatus(true, "FLAGGED"), "FLAGGED");
});

test("does not preserve an error or an ordinary non-preserved run", () => {
  assert.equal(resolvePreservedComparisonStatus(true, "ERROR"), null);
  assert.equal(resolvePreservedComparisonStatus(false, "COMPARED"), null);
});
