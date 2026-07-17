import type { FieldComparison } from "@/types/portal";
import type { ValidationRowData } from "@/lib/intelligence/validation-builders";
import { detectHospital } from "@/lib/reference/sg-hospitals";
import {
  detectSubsidyDeduction,
  detectGiroCdaPayment,
  detectPossibleDuplicate,
  detectSpecialistIndication,
} from "@/lib/reference/claim-signals";

/**
 * Global claims-adjudication policy checks, shared by the detail worker and the
 * recompare route so an item yields identical verdicts regardless of path.
 *
 *  Claimant     — Claimant not in supporting document → "pending document" (REQUIRE_DOC).
 *  Rule 1       — Government subsidy/deduction (CPF/MediSave, CHAS, CDC voucher) → flag.
 *  Rule 2       — Flex claim with a specialist-treatment indication → flag for review.
 *  Rule 3       — Payment via GIRO from a Child Development Account (CDA) → flag (not claimable).
 *  Rule 4       — Portal-flagged "possible duplicate" claim → flag.
 *  Rule 6       — Polyclinic claim whose supporting document is from a hospital (not a
 *                 polyclinic) → wrong claim type. For flex portals the verdict names the
 *                 correct claim type (Insurance Claim).
 *
 *  (Rule 5, foreign currency, is handled deterministically in
 *  `src/lib/validations/currency.ts`; its flag is threaded into the item status
 *  by the worker/recompare paths.)
 */

// Field-name patterns. "claimant" is preferred; the others are fallbacks for
// portals that label the insured party differently.
const CLAIMANT_FIELD_RE = /claimant|life\s*assured|\binsured\b|\bpatient\b/i;
// Claim-type value indicating a polyclinic submission (abbreviated wording).
const POLYCLINIC_RE = /poly\s*clinic|\bpcn\b/i;
// A billing document whose provider text itself names a polyclinic is a genuine
// polyclinic document — never flag rule 6 for it, even if a hospital name is
// mentioned incidentally elsewhere.
const POLYCLINIC_PROVIDER_RE = /poly\s*clinic/i;
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
  /** Polyclinic claim backed by a hospital bill → FLAGGED (rule 6). */
  wrongClaimType: boolean;
  /** Government subsidy/deduction (CPF/MediSave, CHAS, CDC voucher) → FLAGGED (rule 1). */
  subsidyDeduction: boolean;
  /** GIRO payment from a Child Development Account → FLAGGED (rule 3). */
  nonClaimablePayment: boolean;
  /** Portal-flagged possible duplicate → FLAGGED (rule 4). */
  possibleDuplicate: boolean;
  /** Flex specialist-treatment indication → FLAGGED for review (rule 2). */
  specialistReview: boolean;
}

type FieldPair = { label: string; value: string };

/** Concatenate field pairs into searchable "label value" text. */
function pairsToText(pairs: FieldPair[]): string {
  return pairs.map((p) => `${p.label} ${p.value}`).join(" \n ");
}

/** Concatenate field VALUES only — used where matching a field label would
 *  over-trigger (e.g. a portal column literally named "Specialist Clinic Code"). */
function valuesToText(pairs: FieldPair[]): string {
  return pairs.map((p) => p.value).join(" \n ");
}

/** Field map → pairs. */
function mapToPairs(fields: Record<string, string>): FieldPair[] {
  return Object.entries(fields).map(([label, value]) => ({ label, value }));
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
  /** Provider-scoped billing text — used for hospital detection (rule 6). */
  documentText: string;
  /** All extracted document fields — used for subsidy/GIRO/specialist detection + amounts. */
  documentFields: { label: string; value: string }[];
}): ClaimPolicyResult {
  const { fieldComparisons, flexClaim, pageData, groupingFields, documentText, documentFields } = input;
  const rows: ValidationRowData[] = [];

  const pagePairs = mapToPairs(pageData);
  // Subsidy/GIRO signals may sit in a field label ("CHAS Subsidy") or value, so
  // scan labels+values. The duplicate marker is portal-side only.
  const documentSignalText = pairsToText(documentFields);
  const pageText = pairsToText(pagePairs);
  // Specialist detection scans VALUES only (a portal column merely LABELLED
  // "Specialist …" must not flag every claim).
  const specialistText = `${valuesToText(documentFields)} \n ${valuesToText(pagePairs)}`;

  // ── Claimant not in supporting document → pending document (REQUIRE_DOC) ──
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

  // ── Rule 1: government subsidy / deduction (CPF/MediSave, CHAS, CDC voucher) ──
  const subsidy = detectSubsidyDeduction(documentSignalText);
  const subsidyDeduction = !!subsidy;
  if (subsidy) {
    rows.push({
      ruleType: "SUBSIDY_DEDUCTION",
      status: "FAIL",
      message: `Government subsidy/deduction detected (${subsidy.kind}) — the subsidised/deducted portion is not claimable.`,
      metadata: { severity: "critical", subsidyKind: subsidy.kind, evidence: subsidy.evidence },
    });
  }

  // ── Rule 3: GIRO payment from a Child Development Account (CDA) ──
  const cda = detectGiroCdaPayment(documentSignalText);
  const nonClaimablePayment = !!cda;
  if (cda) {
    rows.push({
      ruleType: "NON_CLAIMABLE_PAYMENT",
      status: "FAIL",
      message: `Non-claimable payment detected — ${cda.evidence}. Amounts paid from a CDA are not claimable.`,
      metadata: { severity: "critical", evidence: cda.evidence },
    });
  }

  // ── Rule 4: portal-flagged possible duplicate ──
  // Read only from the portal page data — this is a marker the portal surfaces.
  const duplicate = detectPossibleDuplicate(pageText);
  const possibleDuplicate = !!duplicate;
  if (duplicate) {
    rows.push({
      ruleType: "POSSIBLE_DUPLICATE",
      status: "FAIL",
      message: `Portal flagged a possible duplicate claim ("${duplicate.evidence}") — review for potential duplicate.`,
      metadata: { severity: "critical", evidence: duplicate.evidence },
    });
  }

  // ── Rule 2: flex specialist consultation → flag for review ──
  // Fires only on an explicit specialist-treatment indication in the document /
  // portal values. (The former "receipt amount > $100" threshold was removed — a
  // dollar figure alone doesn't imply a specialist consultation.)
  let specialistReview = false;
  if (flexClaim && detectSpecialistIndication(specialistText)) {
    specialistReview = true;
    rows.push({
      ruleType: "SPECIALIST_REVIEW",
      status: "WARNING",
      message: `Possible specialist consultation (SP) — specialist treatment indicated. Manual review recommended.`,
      metadata: { severity: "review", specialistSignal: true },
    });
  }

  // ── Rule 6: Polyclinic claim whose document is from a hospital (not a polyclinic) ──
  // Applies to all portals. When the provider text itself names a polyclinic it is
  // a genuine polyclinic document and is never flagged. For flex portals the verdict
  // names the correct claim type (Insurance Claim).
  let wrongClaimType = false;
  const claimType = resolveClaimTypeValues(pageData, groupingFields).find((v) => isPolyclinicClaim(v));
  if (claimType && !POLYCLINIC_PROVIDER_RE.test(documentText)) {
    const hospital = detectHospital(documentText);
    if (hospital) {
      wrongClaimType = true;
      const kindLabel = hospital.kind === "govt" ? "government hospital" : "private hospital";
      rows.push({
        ruleType: "WRONG_CLAIM_TYPE",
        status: "FAIL",
        message: flexClaim
          ? `Submitted as a Polyclinic claim, but the document is from ${hospital.name} (${kindLabel}) — should be an Insurance Claim.`
          : `Submitted as a Polyclinic claim, but the supporting document is from ${hospital.name} (${kindLabel}) — not a polyclinic document.`,
        metadata: {
          severity: "critical",
          claimType,
          hospital: hospital.name,
          hospitalKind: hospital.kind,
          ...(flexClaim ? { correctClaimType: "Insurance Claim" } : {}),
        },
      });
    }
  }

  return {
    rows,
    claimantMissing,
    wrongClaimType,
    subsidyDeduction,
    nonClaimablePayment,
    possibleDuplicate,
    specialistReview,
  };
}
