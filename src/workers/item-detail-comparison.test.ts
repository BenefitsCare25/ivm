import assert from "node:assert/strict";
import test from "node:test";

import { runComparison } from "@/workers/item-detail-comparison";

test("an all-failed rerun retains the preserved successful item status", async () => {
  const result = await runComparison({
    trackedItemId: "preserved-item",
    portalId: "portal",
    listData: {},
    effectiveDetailData: {},
    pdfFields: {},
    fileExtractions: [],
    failedFiles: ["truncated.pdf"],
    preservePrior: true,
    priorStatus: "VERIFIED",
    provider: "openai",
    apiKey: "test",
    textModel: "test",
    visionModel: "test",
    displayProvider: "test",
    comparisonModel: null,
  });

  assert.equal(result.extractionFailed, true);
  assert.equal(result.finalStatus, "VERIFIED");
  assert.match(result.reviewMessage ?? "", /previous comparison result/i);
});
