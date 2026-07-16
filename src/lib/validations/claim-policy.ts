import type { FieldComparison } from "@/types/portal";
import type { ValidationRowData } from "@/lib/intelligence/validation-builders";
import { detectHospital } from "@/lib/reference/sg-hospitals";

/**
 * Global claims-adjudication policy checks, shared by the detail worker and the
 * recompare route so an item yields identical verdicts regardless of path.
 *
 *  Rule 1 — Claimant not in supporting document → "pending document" (REQUIRE_DOC).
 *  Rule 2 — Flex Polyclinic claim whose document is a hospital bill → wrong claim
 *           type (should be an Insurance Claim).
 */

// Field-name patterns. "claimant" is preferred; the others are fallbacks for
// portals that label the insured party differently.
const CLAIMANT_FIELD_RE = /claimant|life\s*assured|\binsured\b|\bpatient\b/i;
// Claim-type value indicating a polyclinic submission (abbreviated wording).
const POLYCLINIC_RE = /poly\s*clinic|\bpcn\b/i;
// Claim-type field labels (used alongside grouping fields to gather candidates).
const CLAIM_TYPE_FIELD_RE = /claim\s*type|claim\s*category|benefit\s*type|visit\s*type/i;
// Billing-document families whose provider IS "where the claim is from".
const BILLING_FAMILIES = new Set(["Hospital Bill / Tax Invoice", "Receipt"]);
// Field labels that carry the billing provider / facility name.
const PROVIDER_FIELD_RE = /provider|hospital|clinic|facility|institution|billed\s*by|payee|attending|merchant|vendor/i;

/** A flex claim is identified by "flex" in the portal name or base URL. */
export function isFlexClaim(portalName?: string | null, baseUrl?: string | null): boolean {
  return /\bflex/i.test(`${portalName ?? ""} ${baseUrl ?? ""}`);
}

/**
 * Locate the claimant field among the compared fields and return it when the
 * claimant was NOT found in any document (status MISSING_IN_PDF). Prefers a field
 * literally named "Claimant".
 */
export function findMissingClaimant(fieldComparisons: FieldComparison[]): FieldComparison | null {
  const candidates = fieldComparisons.filter((fc) => CLAIMANT_FIELD_RE.test(fc.fieldName));
  const claimant = candidates.find((fc) => /claimant/i.test(fc.fieldName)) ?? candidates[0];
  if (!claimant) return null;
  return claimant.status === "MISSING_IN_PDF" ? claimant : null;
}

/**
 * Collect ALL candidate claim-type values — every configured grouping field plus
 * any claim-type-labelled field. Grouping fields can be multiple and in any order
 * (e.g. ["Payer", "Claim Type"]), so returning only the first would evaluate the
 * polyclinic signal against the wrong field.
 */
export function resolveClaimTypeValues(
  pageData: Record<string, string>,
  groupingFields: string[]
): string[] {
  const values: string[] = [];
  for (const f of groupingFields) {
    const v = pageData[f]?.trim();
    if (v) values.push(v);
  }
  for (const [label, value] of Object.entries(pageData)) {
    if (CLAIM_TYPE_FIELD_RE.test(label) && value?.trim()) values.push(value.trim());
  }
  return values;
}

export function isPolyclinicClaim(claimType: string | null): boolean {
  return !!claimType && POLYCLINIC_RE.test(claimType);
}

/**
 * Build the text searched for a hospital name, scoped to the actual bill/receipt
 * documents' provider — NOT all document text. This prevents a referral letter or
 * an incidental hospital mention (address, doctor affiliation) from falsely
 * triggering the wrong-claim-type rule. Prefers provider-labelled field values;
 * falls back to a bill's full text only when it has no provider field (letterhead
 * case). Returns "" when no bill/receipt document is present.
 */
export function buildHospitalSearchText(
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[],
  recognizedDocs: { fileName: string; families: string[] }[]
): string {
  const familiesByFile = new Map(recognizedDocs.map((d) => [d.fileName, d.families ?? []]));
  const isBilling = (fileName: string) =>
    (familiesByFile.get(fileName) ?? []).some((f) => BILLING_FAMILIES.has(f));

  const billing = fileExtractions.filter((e) => isBilling(e.fileName));
  if (billing.length === 0) return "";

  const parts: string[] = [];
  for (const e of billing) {
    if (e.documentType) parts.push(e.documentType);
    const providerVals = e.fields.filter((f) => PROVIDER_FIELD_RE.test(f.label)).map((f) => f.value);
    if (providerVals.length > 0) {
      parts.push(...providerVals);
    } else {
      // No provider field on this bill — fall back to its full text so a
      // letterhead-only hospital name is still detected (still scoped to the bill).
      parts.push(...e.fields.flatMap((f) => [f.label, f.value]));
    }
  }
  return parts.filter(Boolean).join(" \n ");
}

export interface ClaimPolicyResult {
  rows: ValidationRowData[];
  /** Claimant not found in any document → REQUIRE_DOC ("pending document"). */
  claimantMissing: boolean;
  /** Flex Polyclinic claim backed by a hospital bill → FLAGGED. */
  wrongClaimType: boolean;
}

/**
 * Evaluate the global claim policies against a completed comparison. Pure and
 * deterministic; never throws.
 */
export function buildClaimPolicyValidations(input: {
  fieldComparisons: FieldComparison[];
  flexClaim: boolean;
  pageData: Record<string, string>;
  groupingFields: string[];
  documentText: string;
}): ClaimPolicyResult {
  const { fieldComparisons, flexClaim, pageData, groupingFields, documentText } = input;
  const rows: ValidationRowData[] = [];

  // ── Rule 1: claimant not in supporting document ──
  const missing = findMissingClaimant(fieldComparisons);
  const claimantMissing = !!missing;
  if (missing) {
    const claimant = missing.pageValue?.trim();
    rows.push({
      ruleType: "CLAIMANT_MATCH",
      status: "FAIL",
      message: `Claimant${claimant ? ` "${claimant}"` : ""} was not found in any supporting document — pending document.`,
      metadata: { severity: "critical", fieldName: missing.fieldName, claimant: claimant ?? null },
    });
  }

  // ── Rule 2: flex Polyclinic claim with a hospital document ──
  let wrongClaimType = false;
  if (flexClaim) {
    const claimType = resolveClaimTypeValues(pageData, groupingFields).find((v) => isPolyclinicClaim(v));
    if (claimType) {
      const hospital = detectHospital(documentText);
      if (hospital) {
        wrongClaimType = true;
        const kindLabel = hospital.kind === "govt" ? "government hospital" : "private hospital";
        rows.push({
          ruleType: "WRONG_CLAIM_TYPE",
          status: "FAIL",
          message: `Submitted as a Polyclinic claim, but the document is from ${hospital.name} (${kindLabel}) — should be an Insurance Claim.`,
          metadata: {
            severity: "critical",
            claimType,
            hospital: hospital.name,
            hospitalKind: hospital.kind,
            correctClaimType: "Insurance Claim",
          },
        });
      }
    }
  }

  return { rows, claimantMissing, wrongClaimType };
}
