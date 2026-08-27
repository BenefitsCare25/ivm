import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequiredDocValidations,
  hasUnsatisfiedRequiredDocuments,
} from "@/lib/intelligence/validation-builders";
import type { RequiredDocument, RequiredDocumentCheck } from "@/types/portal";

const requirements: RequiredDocument[] = [
  { documentTypeName: "Tax Invoice", rule: "one_of", group: "billing" },
  { documentTypeName: "Official Receipt", rule: "one_of", group: "billing" },
  { documentTypeName: "Medical Memo", rule: "required" },
];

test("a one-of document group is satisfied when any alternative is found", () => {
  const checks: RequiredDocumentCheck[] = [
    { documentTypeName: "Tax Invoice", found: true },
    { documentTypeName: "Official Receipt", found: false },
    { documentTypeName: "Medical Memo", found: true },
  ];

  assert.equal(hasUnsatisfiedRequiredDocuments(checks, requirements), false);
  assert.deepEqual(buildRequiredDocValidations(checks, requirements), []);
});

test("an unsatisfied one-of group produces one aggregated validation", () => {
  const checks: RequiredDocumentCheck[] = [
    { documentTypeName: "Tax Invoice", found: false },
    { documentTypeName: "Official Receipt", found: false },
    { documentTypeName: "Medical Memo", found: true },
  ];

  const rows = buildRequiredDocValidations(checks, requirements);
  assert.equal(hasUnsatisfiedRequiredDocuments(checks, requirements), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].message, /Tax Invoice.*Official Receipt/);
});

test("uncertain one-of evidence requests review instead of asserting missing", () => {
  const checks: RequiredDocumentCheck[] = [
    { documentTypeName: "Tax Invoice", found: false, uncertain: true, confidence: 0.6 },
    { documentTypeName: "Official Receipt", found: false },
    { documentTypeName: "Medical Memo", found: true },
  ];

  const rows = buildRequiredDocValidations(checks, requirements);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "WARNING");
  assert.equal(rows[0].metadata.group, "billing");
});
