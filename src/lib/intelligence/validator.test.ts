import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateRequiredFieldChecks,
  buildDocTypeMatchChecks,
  validateRequiredFieldsSync,
} from "@/lib/intelligence/validator";

test("acceptable document types use any-file semantics", () => {
  const checks = buildDocTypeMatchChecks(
    [
      { documentTypeId: "memo", documentTypeName: "Medical Memo", fileName: "memo.pdf" },
      { documentTypeId: "invoice", documentTypeName: "Tax Invoice", fileName: "invoice.pdf" },
    ],
    ["invoice"],
    ["Tax Invoice"]
  );

  assert.deepEqual(checks, []);
});

test("wrong document type reports every recognised upload", () => {
  const checks = buildDocTypeMatchChecks(
    [
      { documentTypeId: "memo", documentTypeName: "Medical Memo", fileName: "memo.pdf" },
      { documentTypeId: "referral", documentTypeName: "Referral Letter", fileName: "referral.pdf" },
    ],
    ["invoice"],
    ["Tax Invoice"]
  );

  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "FAIL");
  assert.deepEqual(checks[0].metadata.files, ["memo.pdf", "referral.pdf"]);
});

test("required-field validations aggregate duplicate misses with file provenance", () => {
  const first = validateRequiredFieldsSync(
    { name: "Tax Invoice", requiredFields: ["Admission Date"] },
    [],
    "invoice-1.pdf"
  );
  const second = validateRequiredFieldsSync(
    { name: "Tax Invoice", requiredFields: ["Admission Date"] },
    [],
    "invoice-2.pdf"
  );
  const aggregated = aggregateRequiredFieldChecks([...first, ...second]);

  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].status, "FAIL");
  assert.match(aggregated[0].message, /2 Tax Invoice documents/);
  assert.deepEqual(aggregated[0].metadata.files, ["invoice-1.pdf", "invoice-2.pdf"]);
});
