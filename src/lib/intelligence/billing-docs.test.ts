import assert from "node:assert/strict";
import test from "node:test";

import { recognizeDocuments, resolveRequiredDocument } from "@/lib/intelligence/billing-docs";

test("accepts a provider-issued treatment claim form as receipt evidence", () => {
  const docs = recognizeDocuments([
    {
      fileName: "IMG_3898.jpg",
      documentType: "medical treatment claim form",
      fields: [
        { label: "Provider", value: "KLINIK SHARIFAH FADZILON SDN. BHD." },
        { label: "Patient Name", value: "WONG WAI SHIN" },
        { label: "Treatment Date", value: "11/8/2026" },
        { label: "Claim Reference Number", value: "278464" },
        { label: "Medicine Charge / Total Amount", value: "RM 85.00" },
      ],
    },
  ], []);

  const result = resolveRequiredDocument(
    { documentTypeName: "Invoice or Receipt", rule: "required" },
    docs
  );

  assert.equal(result.found, true);
  assert.equal(result.matchedVia, "evidence");
  assert.equal(result.matchedFile, "IMG_3898.jpg");
});

test("does not treat an unsupported medical form as receipt evidence", () => {
  const docs = recognizeDocuments([
    {
      fileName: "memo.pdf",
      documentType: "medical memo",
      fields: [
        { label: "Patient Name", value: "LIU AIPING" },
        { label: "Visit Date", value: "6 Aug 2026" },
        { label: "Estimated Treatment Cost", value: "$80.00" },
      ],
    },
  ], []);

  const result = resolveRequiredDocument(
    { documentTypeName: "Invoice or Receipt", rule: "required" },
    docs
  );

  assert.equal(result.found, false);
});

test("requires an explicit provider anchor before treating a claim form as a receipt", () => {
  const docs = recognizeDocuments([
    {
      fileName: "self-declared-form.pdf",
      documentType: "medical treatment claim form",
      fields: [
        { label: "Patient Name", value: "LIU AIPING" },
        { label: "Treatment Date", value: "6 Aug 2026" },
        { label: "Claim Reference Number", value: "FQM2600020118B" },
        { label: "Total Amount", value: "$61.00" },
      ],
    },
  ], []);

  const result = resolveRequiredDocument(
    { documentTypeName: "Invoice or Receipt", rule: "required" },
    docs
  );

  assert.equal(result.found, false);
});

test("includes every recognised family in document types found", async () => {
  const { buildDocumentTypesFound } = await import("@/lib/intelligence/billing-docs");
  const labels = buildDocumentTypesFound(recognizeDocuments([
    {
      fileName: "invoice-receipt.pdf",
      documentType: "Tax Invoice / Official Receipt",
      fields: [],
    },
  ], []));

  assert.ok(labels.includes("Hospital Bill / Tax Invoice"));
  assert.ok(labels.includes("Receipt"));
});
