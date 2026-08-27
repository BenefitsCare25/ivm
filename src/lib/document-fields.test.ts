import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeDocumentFields,
  parseDocumentExtractions,
  resolveDocumentExtractions,
} from "@/lib/document-fields";

test("preserves repeated fields from multiple invoices with source provenance", () => {
  const merged = mergeDocumentFields([
    {
      fileName: "invoice-61.pdf",
      fields: [
        { label: "Invoice Number", value: "FQM2600020118B" },
        { label: "Total Amount", value: "$61.00", rawText: "TOTAL $61.00" },
      ],
    },
    {
      fileName: "invoice-18.50.pdf",
      fields: [
        { label: "Invoice Number", value: "FQM2600024382E" },
        { label: "Total Amount", value: "$18.50", rawText: "TOTAL $18.50" },
      ],
    },
  ]);

  assert.deepEqual(merged.fields, {
    "Invoice Number [Document 1]": "FQM2600020118B",
    "Total Amount [Document 1]": "$61.00",
    "Invoice Number [Document 2]": "FQM2600024382E",
    "Total Amount [Document 2]": "$18.50",
  });
  assert.equal(merged.rawFields["Total Amount [Document 1]"], "TOTAL $61.00");
  assert.equal(merged.sources["Invoice Number [Document 2]"], "invoice-18.50.pdf");
});

test("validates persisted extraction snapshots and preserves every document", () => {
  const parsed = parseDocumentExtractions([
    {
      fileName: "invoice-61.pdf",
      documentType: "Tax Invoice",
      fields: [{ label: "Total Amount", value: "$61.00" }],
    },
    {
      fileName: "invoice-18.50.pdf",
      documentType: "Tax Invoice",
      fields: [{ label: "Total Amount", value: "$18.50" }],
    },
  ]);

  assert.equal(parsed?.length, 2);
  assert.equal(parsed?.[1].fields[0].value, "$18.50");
  assert.equal(parseDocumentExtractions([{ fileName: "bad.pdf", fields: "nope" }]), null);
});

test("legacy reconstruction retains files that had no mapped comparison field", () => {
  const documents = resolveDocumentExtractions(
    null,
    { "invoice-1.pdf": "Tax Invoice", "invoice-2.pdf": "Tax Invoice" },
    [{ fieldName: "Receipt Amount", pdfValue: "$61.00", sourceFile: "invoice-1.pdf" }]
  );

  assert.equal(documents.length, 2);
  assert.equal(documents.find((doc) => doc.fileName === "invoice-2.pdf")?.fields.length, 0);
});
