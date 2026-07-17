/**
 * Deterministic claim-adjudication signal detectors, shared by the global claim
 * policy layer (`src/lib/validations/claim-policy.ts`). Pure regex/string checks
 * over extracted document + portal text — no I/O, never throw. Each detector is
 * scoped tightly to keep false positives low, since a positive result flags the
 * claim for a human reviewer.
 */

// ── Rule 1: government subsidy / deduction (CPF/MediSave, CHAS, CDC voucher) ──
// The subsidised/deducted portion of a bill is not claimable. BUT a mere textual
// MENTION of MediSave/CPF is NOT evidence the subsidy was actually applied to this
// bill: virtually every Singapore medical/dental invoice prints CPF instructional
// boilerplate ("VIEW YOUR MEDISAVE… CLAIM DETAILS ONLINE", "REIMBURSEMENT
// INFORMATION FOR EMPLOYERS…"). We therefore only flag when the subsidy keyword
// sits in a genuine deduction/payment context (or beside a dollar amount) AND is
// not inside that boilerplate.
const MEDISAVE_RE = /\bmedisave\b/i;
const CHAS_RE = /\bchas\b|community\s+health\s+assist/i;
// CDC = Community Development Council voucher (distinct from CDA in rule 3).
const CDC_VOUCHER_RE = /community\s+development\s+council|\bcdc\s+vouchers?\b/i;
const CPF_RE = /\bcpf\b/i;

// Instructional CPF/MediSave/MediShield footer boilerplate printed on most SG
// bills — informational, never a deduction on THIS claim. A segment matching any
// of these markers is skipped before subsidy detection.
const CPF_BOILERPLATE_RE =
  /view\s+your\s+medisave|claim\s+details?\s+online|my\s?cpf|cpf\.gov\.sg|reimbursement\s+information|medishield\s+life\s+reimbursement|integrated\s+shield\s+plan|for\s+more\s+information|submit\s+through\s+(the\s+)?internet|proceed\s+to\s+(my\s+statement|employers)/i;

// A genuine subsidy line applied to the bill: an actual deduction/payment context…
const DEDUCTION_CONTEXT_RE =
  /deduct|\bless\b|subsid|paid\s*(by|from|via)|payment\s*(by|mode|method|via)|\butilis|\butiliz|\bclaimed\b|contribution/i;
// …or a dollar amount printed alongside the keyword in the same segment.
const AMOUNT_NEARBY_RE = /\$\s?\d|\bsgd\s?\d|\d+\.\d{2}/i;

export type SubsidyKind = "CPF/MediSave" | "CHAS" | "CDC Voucher";

/** Split field text into per-line / per-sentence segments for scoped matching. */
function toSegments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectSubsidyDeduction(
  text: string
): { kind: SubsidyKind; evidence: string } | null {
  if (!text) return null;
  for (const seg of toSegments(text)) {
    // Skip CPF instructional boilerplate — a mention there is not a deduction.
    if (CPF_BOILERPLATE_RE.test(seg)) continue;
    // Require the subsidy to actually apply here: a deduction/payment context or a
    // dollar amount in the same segment.
    if (!DEDUCTION_CONTEXT_RE.test(seg) && !AMOUNT_NEARBY_RE.test(seg)) continue;

    if (MEDISAVE_RE.test(seg)) return { kind: "CPF/MediSave", evidence: "MediSave" };
    if (CHAS_RE.test(seg)) return { kind: "CHAS", evidence: "CHAS" };
    const cdc = seg.match(CDC_VOUCHER_RE);
    if (cdc) return { kind: "CDC Voucher", evidence: cdc[0].trim() };
    if (CPF_RE.test(seg)) return { kind: "CPF/MediSave", evidence: "CPF" };
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
