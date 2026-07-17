/**
 * Deterministic claim-adjudication signal detectors, shared by the global claim
 * policy layer (`src/lib/validations/claim-policy.ts`). Pure regex/string checks
 * over extracted document + portal text — no I/O, never throw. Each detector is
 * scoped tightly to keep false positives low, since a positive result flags the
 * claim for a human reviewer.
 */

// ── Rule 1: government subsidy / deduction (CPF/MediSave, CHAS, CDC voucher) ──
// The subsidised/deducted portion of a bill is not claimable, so the presence of
// any of these mechanisms flags the claim.
const MEDISAVE_RE = /\bmedisave\b/i;
const CHAS_RE = /\bchas\b|community\s+health\s+assist/i;
// CDC = Community Development Council voucher (distinct from CDA in rule 3).
const CDC_VOUCHER_RE = /community\s+development\s+council|\bcdc\s+vouchers?\b/i;
// Plain "CPF" only counts alongside a deduction/subsidy/payment context so a
// stray CPF mention (e.g. an employer or NRIC reference) doesn't false-flag.
const CPF_RE = /\bcpf\b/i;
const SUBSIDY_CONTEXT_RE = /deduct|subsid|paid\s*by|payment|contribution/i;

export type SubsidyKind = "CPF/MediSave" | "CHAS" | "CDC Voucher";

export function detectSubsidyDeduction(
  text: string
): { kind: SubsidyKind; evidence: string } | null {
  if (!text) return null;
  if (MEDISAVE_RE.test(text)) return { kind: "CPF/MediSave", evidence: "MediSave" };
  if (CHAS_RE.test(text)) return { kind: "CHAS", evidence: "CHAS" };
  const cdc = text.match(CDC_VOUCHER_RE);
  if (cdc) return { kind: "CDC Voucher", evidence: cdc[0].trim() };
  if (CPF_RE.test(text) && SUBSIDY_CONTEXT_RE.test(text)) {
    return { kind: "CPF/MediSave", evidence: "CPF" };
  }
  return null;
}

// ── Rule 3: GIRO payment from a Child Development Account (CDA) ──
// CDA / Baby Bonus funds are not claimable. Detected on the CDA signal itself
// (the "not claimable" driver); a corroborating GIRO mention is noted in the
// evidence when present.
const CDA_STRONG_RE = /child\s+development\s+account|baby\s+bonus/i;
const CDA_ABBR_RE = /\bcda\b/i;
const GIRO_RE = /\bgiro\b/i;

export function detectGiroCdaPayment(text: string): { evidence: string } | null {
  if (!text) return null;
  const giro = GIRO_RE.test(text);
  const strong = CDA_STRONG_RE.test(text);
  // The bare "CDA" abbreviation is only trusted alongside a GIRO mention, so an
  // unrelated three-letter token can't trigger the rule on its own.
  if (strong || (CDA_ABBR_RE.test(text) && giro)) {
    return {
      evidence: giro
        ? "GIRO payment from a Child Development Account (CDA)"
        : "payment from a Child Development Account (CDA)",
    };
  }
  return null;
}

// ── Rule 4: portal-flagged possible duplicate ──
// Reads a duplicate marker the PORTAL itself surfaces on the claim detail page.
const POSSIBLE_DUPLICATE_RE =
  /possible\s+duplicate|potential\s+duplicate|suspected\s+duplicate|duplicate\s+claim/i;

export function detectPossibleDuplicate(text: string): { evidence: string } | null {
  if (!text) return null;
  const m = text.match(POSSIBLE_DUPLICATE_RE);
  return m ? { evidence: m[0].trim() } : null;
}

// ── Rule 2: specialist consultation indication (flex claims) ──
const SPECIALIST_RE =
  /\bspecialist\b|specialist\s+(consultation|clinic|centre|center|outpatient)/i;

export function detectSpecialistIndication(text: string): boolean {
  return !!text && SPECIALIST_RE.test(text);
}
