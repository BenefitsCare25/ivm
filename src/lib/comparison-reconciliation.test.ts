import assert from "node:assert/strict";
import test from "node:test";

import { buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import {
  applyCurrencyConversionEvidence,
  groupTemplateFields,
  reconcileFieldComparisons,
} from "@/lib/comparison-reconciliation";
import { selectVisionSourceFile } from "@/lib/ai/vision-source-selection";
import type { FieldComparison, TemplateField } from "@/types/portal";

const fields: TemplateField[] = [
  {
    portalFieldName: "Invoice Number",
    documentFieldName: "Invoice Number",
    mode: "exact",
  },
  {
    portalFieldName: "Incurred Date",
    documentFieldName: "Invoice Date",
    mode: "fuzzy",
  },
  {
    portalFieldName: "Receipt Amount",
    documentFieldName: "Total Amount (After Govt Subsidy)",
    documentFieldAliases: ["Final Amount Payable", "Total Hospital Charges"],
    mode: "numeric",
    tolerance: 0.01,
  },
  {
    portalFieldName: "Incurred Date",
    documentFieldName: "Admission Date",
    mode: "fuzzy",
  },
  {
    portalFieldName: "Invoice Number",
    documentFieldName: "Case No. / Bill Ref. No.",
    mode: "exact",
  },
];

test("groups repeated portal mappings into document-label alternatives", () => {
  const grouped = groupTemplateFields(fields);

  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped.find((field) => field.portalFieldName === "Invoice Number")?.documentFieldNames,
    ["Invoice Number", "Case No. / Bill Ref. No."]
  );
  assert.deepEqual(
    grouped.find((field) => field.portalFieldName === "Incurred Date")?.documentFieldNames,
    ["Invoice Date", "Admission Date"]
  );
});

test("full prompt requests one result per portal field", () => {
  const prompt = buildFullComparisonUserPrompt({
    fields,
    businessRules: [],
    requiredDocuments: [],
    pageFields: {},
    pdfFields: {},
    documentTypesFound: [],
  });

  assert.match(prompt, /exactly ONE fieldComparisons row per portal field/i);
  assert.equal(prompt.match(/Portal "Invoice Number"/g)?.length, 1);
  assert.match(prompt, /Document ONE OF \["Invoice Number","Case No\. \/ Bill Ref\. No\."\]/);
});

test("keeps a matching alias and removes contradictory duplicate rows", () => {
  const comparisons: FieldComparison[] = [
    {
      fieldName: "Invoice Number",
      pageValue: "7726161416D0001",
      pdfValue: null,
      status: "MISSING_IN_PDF",
      confidence: 0.9,
    },
    {
      fieldName: "Incurred Date",
      pageValue: "21 Jul 2026",
      pdfValue: "21 Jul 2026",
      status: "MATCH",
      confidence: 0.98,
    },
    {
      fieldName: "Invoice Number",
      pageValue: "7726161416D0001",
      pdfValue: "7726161416D0001",
      status: "MATCH",
      confidence: 0.99,
    },
  ];

  const reconciled = reconcileFieldComparisons(comparisons, fields);
  const invoiceRows = reconciled.filter((row) => row.fieldName === "Invoice Number");

  assert.equal(invoiceRows.length, 1);
  assert.equal(invoiceRows[0].status, "MATCH");
  assert.equal(invoiceRows[0].pdfValue, "7726161416D0001");
});

test("recovers a missing numeric amount from a differently-labelled PDF field", () => {
  const comparisons: FieldComparison[] = [
    {
      fieldName: "Receipt Amount",
      pageValue: "384.46",
      pdfValue: null,
      status: "MISSING_IN_PDF",
      confidence: 0.8,
    },
  ];

  const reconciled = reconcileFieldComparisons(comparisons, fields, {
    "TOTAL AMOUNT (AFTER GOVT SUBSIDY)": "$384.46",
  });

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].status, "MATCH");
  assert.equal(reconciled[0].pdfValue, "$384.46");
  assert.equal(reconciled[0].documentLineMatches?.[0]?.label, "TOTAL AMOUNT (AFTER GOVT SUBSIDY)");
});

test("promotes fallback line evidence when a matched PDF value is blank", () => {
  const comparisons: FieldComparison[] = [
    {
      fieldName: "Incurred Date",
      pageValue: "5 Jul 2026",
      pdfValue: "",
      status: "MATCH",
      confidence: 0.96,
      documentLineMatches: [{ label: "Discharged Date", value: "07/05/2026" }],
    },
  ];

  const reconciled = reconcileFieldComparisons(comparisons, fields);

  assert.equal(reconciled[0].status, "MATCH");
  assert.equal(reconciled[0].pdfValue, "07/05/2026");
});

test("rejects a match that has neither a document value nor fallback evidence", () => {
  const comparisons: FieldComparison[] = [
    {
      fieldName: "Incurred Date",
      pageValue: "5 Jul 2026",
      pdfValue: " ",
      status: "MATCH",
      confidence: 0.95,
    },
  ];

  const reconciled = reconcileFieldComparisons(comparisons, fields);

  assert.equal(reconciled[0].status, "MISSING_IN_PDF");
  assert.equal(reconciled[0].pdfValue, null);
});

test("uses converted document currency as amount evidence", () => {
  const comparisons: FieldComparison[] = [
    {
      fieldName: "Receipt Amount",
      pageValue: "215.00",
      pdfValue: null,
      status: "MISSING_IN_PDF",
      confidence: 0.8,
    },
  ];

  const reconciled = applyCurrencyConversionEvidence(comparisons, fields, [{
    fieldLabel: "Amount Payable",
    origin: "document",
    originalCurrency: "PHP",
    originalAmount: 10282.63,
    sgdAmount: 215.94,
    rate: 0.021,
    rateDate: "2026-07-03",
    raw: "10,282.63",
  }]);

  assert.equal(reconciled[0].status, "MISMATCH");
  assert.equal(reconciled[0].pdfValue, "PHP 10282.63 (SGD 215.94)");
  assert.equal(reconciled[0].documentLineMatches?.[0]?.label, "Amount Payable");
});

test("selects a billing image for amount vision instead of the first attachment", () => {
  const files = [
    { originalName: "instructions.jpg", storagePath: "instructions", mimeType: "image/jpeg" },
    { originalName: "bill.jpg", storagePath: "bill", mimeType: "image/jpeg" },
  ];
  const receiptField = fields.find((field) => field.portalFieldName === "Receipt Amount")!;

  const selected = selectVisionSourceFile({
    files,
    fieldName: "Receipt Amount",
    templateField: receiptField,
    pdfFieldSources: { "Amount Payable": "bill.jpg" },
    documentTypesByFile: {
      "instructions.jpg": "Discharge Instructions",
      "bill.jpg": "Hospital Bill / Tax Invoice",
    },
  });

  assert.equal(selected.originalName, "bill.jpg");
});
