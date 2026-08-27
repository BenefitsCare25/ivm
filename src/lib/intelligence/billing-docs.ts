import { classifyDocumentTypeFromCache, normalize, type DocTypeRecord } from "./classifier";
import type {
  RequiredDocument,
  RequiredDocumentCheck,
  BillStatus,
  BillStatusSignal,
} from "@/types/portal";

/**
 * Deterministic hospital-billing-document recognition.
 *
 * Background: the required-documents check used to rely entirely on the
 * comparison LLM semantically matching one free-text document-type label per
 * file against a required name (e.g. "Summary Tax Invoice"). Different hospitals
 * label the same document very differently ("Final Bill", "Summary Bill",
 * "Discharge Invoice", "Hospital Statement", "Statement of Account", interim
 * bills, …), so the LLM frequently failed to connect them and produced false
 * "Required document not found" flags.
 *
 * This module encodes that domain knowledge deterministically so a hospital bill
 * is recognised regardless of its exact title, and so genuinely-uncertain cases
 * are surfaced for manual review rather than hard-failed.
 */

// ── Document-family synonyms ──────────────────────────────────────
// A "family" is a set of document titles that should satisfy the same
// requirement. Patterns are matched against a document's TYPE LABEL only (its
// title / extracted documentType), never against arbitrary field text — a bill
// having an "Invoice No" field must not make a receipt look like an invoice.
interface DocFamily {
  /** Canonical family name (for evidence / matchedVia reporting). */
  canonical: string;
  /** Regexes; any match identifies a document name as belonging to this family. */
  patterns: RegExp[];
}

const DOC_FAMILIES: DocFamily[] = [
  {
    canonical: "Hospital Bill / Tax Invoice",
    patterns: [
      /\b(tax\s*)?invoice\b/i,
      /\bfinal\s*bill/i,
      /\bsummary\s*(tax\s*)?(bill|invoice|statement)/i,
      /\binterim\s*bill/i,
      /\bdischarge\s*(bill|invoice|summary\s*bill)/i,
      /\b(hospital|medical)\s*(bill|statement|invoice|charges?)/i,
      /\bstatement\s*of\s*account/i,
      /\baccount\s*summary/i,
      /\binpatient\s*(bill|statement|charges?)/i,
      /\bbill(ing)?\s*(summary|statement)?/i,
      /\bconsolidated\s*bill/i,
      /\bhospital\s*charges?/i,
    ],
  },
  {
    canonical: "Receipt",
    patterns: [/\breceipt\b/i, /\bofficial\s*receipt/i, /\bpayment\s*(receipt|advice)/i],
  },
  {
    canonical: "Discharge Summary",
    patterns: [/\bdischarge\s*summary/i, /\bmedical\s*report/i, /\bclinical\s*summary/i],
  },
  {
    canonical: "Referral Letter",
    patterns: [/\breferral\s*(letter|note|form|memo)/i],
  },
  {
    canonical: "Settlement Letter",
    patterns: [/\bsettlement\s*(letter|advice)/i, /\bletter\s*of\s*guarantee/i, /\bLOG\b/],
  },
];

/**
 * Returns ALL canonical family names a document title belongs to. A compound
 * title (e.g. "Invoice/Receipt") legitimately spans multiple families and must
 * be satisfiable by any of them — returning only the first would miss a receipt
 * for an "Invoice/Receipt" requirement (or vice versa).
 */
export function matchDocFamilies(name: string): string[] {
  if (!name?.trim()) return [];
  const out: string[] = [];
  for (const fam of DOC_FAMILIES) {
    if (fam.patterns.some((p) => p.test(name))) out.push(fam.canonical);
  }
  return out;
}

/** Returns the primary (first-matched) family name for a document title, or null. */
export function matchDocFamily(name: string): string | null {
  return matchDocFamilies(name)[0] ?? null;
}

// ── Bill status (interim vs final) ────────────────────────────────
const INTERIM_PATTERNS: RegExp[] = [
  /this\s+is\s+not\s+(the\s+)?(a\s+)?final\s+bill/i,
  /not\s+(the\s+)?final\s+bill/i,
  /\binterim\b/i,
  /\bprovisional\s+bill/i,
  /\bestimate(d)?\s+bill/i,
  /\bdeposit\b/i,
  /subject\s+to\s+(final|adjustment)/i,
];

const FINAL_PATTERNS: RegExp[] = [
  /\bfinal\s*bill/i,
  /\bfinal\s*invoice/i,
  /\bfinal\s*statement/i,
  /\bfully\s*settled/i,
  /\bbill\s*(is\s*)?final/i,
];

const BALANCE_LABEL = /outstanding|amount\s*due|balance\s*(due|payable|outstanding|c\/?f)|unpaid|payable\s*amount/i;

/**
 * Classify a document as interim / final / unknown from its full text.
 * Interim signals win over final signals, since the phrase
 * "this is not the final bill" literally contains "final bill".
 */
export function detectBillStatus(text: string): { status: BillStatus; evidence: string } {
  if (!text) return { status: "unknown", evidence: "" };
  for (const p of INTERIM_PATTERNS) {
    const m = text.match(p);
    if (m) return { status: "interim", evidence: m[0].trim() };
  }
  for (const p of FINAL_PATTERNS) {
    const m = text.match(p);
    if (m) return { status: "final", evidence: m[0].trim() };
  }
  return { status: "unknown", evidence: "" };
}

/** Find an outstanding-balance field among extracted fields. */
export function extractOutstandingBalance(
  fields: { label: string; value: string }[]
): { label: string; value: string } | null {
  for (const f of fields) {
    if (BALANCE_LABEL.test(f.label) && f.value?.trim()) {
      return { label: f.label, value: f.value.trim() };
    }
  }
  return null;
}

// ── Per-file recognition ──────────────────────────────────────────
export interface RecognizedDoc {
  fileName: string;
  /** Raw document-type label the extraction model assigned. */
  rawType: string;
  /** Canonical name from the user's Document Type library, if classified. */
  canonicalName: string | null;
  /** Classifier confidence (alias/fuzzy), 0 when no library match. */
  classifyConfidence: number;
  /** Primary document family the TYPE LABEL belongs to (deterministic). */
  family: string | null;
  /** All document families the TYPE LABEL / canonical name belong to. */
  families: string[];
  /** All searchable text for the file (type + field labels + values). */
  text: string;
  billStatus: BillStatus;
  billEvidence: string;
  outstandingBalance?: { label: string; value: string };
  /** Strong structured evidence that a provider-issued form serves as a receipt. */
  receiptEvidence?: { confidence: number; notes: string };
}

export function isBillingDocument(doc: RecognizedDoc): boolean {
  return doc.families.some(
    (family) => family === "Hospital Bill / Tax Invoice" || family === "Receipt"
  );
}

function buildDocText(rawType: string, fields: { label: string; value: string }[]): string {
  const parts = [rawType, ...fields.flatMap((f) => [f.label, f.value])];
  return parts.filter(Boolean).join(" \n ");
}

const CLAIM_FORM_RE = /\b(?:claim|treatment|patient|outpatient|medical|clinic)(?:[\s/-]+\w+){0,4}[\s/-]+form\b|\bclaim\s*form\b/i;
const RECEIPT_AMOUNT_RE = /\b(?:grand\s+total|total\s+amount|amount\s+(?:paid|charged)|receipt\s+amount|medicine\s+(?:amount|charge|cost)|medication\s+(?:amount|charge|cost)|consultation\s+(?:fee|charge)|total\s+charges?)\b/i;
const ESTIMATE_RE = /\b(?:estimate|estimated|quotation|quote|limit|maximum|projected)\b/i;
const PAYMENT_PROOF_RE = /\b(?:paid|payment\s+(?:method|mode|reference)|cash|nets|credit\s*card|official\s+receipt|receipt\s*(?:no|number))\b/i;
const PROVIDER_EVIDENCE_RE = /\b(?:provider|clinic|hospital|facility|practitioner|doctor|physician)\b/i;
const PATIENT_EVIDENCE_RE = /\b(?:patient|claimant|employee|member)\b/i;
const DATE_EVIDENCE_RE = /\b(?:treatment|visit|service|invoice|receipt|transaction)\s*date\b/i;
const REFERENCE_EVIDENCE_RE = /\b(?:claim|form|invoice|receipt|transaction|reference)\s*(?:no|number|ref)?\b/i;

/**
 * Recognise receipt evidence when the issuer's document title is a treatment
 * claim form rather than "Receipt". Amount evidence is mandatory and must be
 * supported by provider/patient/date/reference structure; estimates never count.
 */
function inferReceiptEvidence(
  rawType: string,
  fields: { label: string; value: string }[]
): { confidence: number; notes: string } | null {
  const pairs = fields.map((field) => `${field.label} ${field.value}`);
  const hasAmount = fields.some(
    (field) =>
      RECEIPT_AMOUNT_RE.test(field.label) &&
      !ESTIMATE_RE.test(`${field.label} ${field.value}`) &&
      /\d/.test(field.value)
  );
  if (!hasAmount) return null;

  const text = pairs.join(" \n ");
  const hasProvider = PROVIDER_EVIDENCE_RE.test(text);
  const supportingAnchors = [
    PATIENT_EVIDENCE_RE.test(text),
    DATE_EVIDENCE_RE.test(text),
    REFERENCE_EVIDENCE_RE.test(text),
  ].filter(Boolean).length;
  const claimForm = CLAIM_FORM_RE.test(rawType);
  const paymentProof = PAYMENT_PROOF_RE.test(text);

  if (hasProvider && ((claimForm && supportingAnchors >= 2) || (paymentProof && supportingAnchors >= 1))) {
    return {
      confidence: paymentProof ? 0.9 : 0.84,
      notes:
        "Provider-issued treatment form contains a billed total plus patient, provider, date, and reference evidence.",
    };
  }
  return null;
}

/** Recognise every submitted file (type classification + family + bill status). */
export function recognizeDocuments(
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[],
  docTypes: DocTypeRecord[]
): RecognizedDoc[] {
  return fileExtractions.map((e) => {
    const text = buildDocText(e.documentType, e.fields);
    const classification = classifyDocumentTypeFromCache(e.documentType, docTypes);
    const { status, evidence } = detectBillStatus(text);
    const balance = extractOutstandingBalance(e.fields);
    // Primary families come from the type label / canonical library name. A
    // separate guarded fallback may add Receipt only when structured billing
    // evidence passes inferReceiptEvidence; a lone "Invoice No." never suffices.
    const labelFamilies = Array.from(
      new Set([
        ...matchDocFamilies(e.documentType),
        ...matchDocFamilies(classification.documentTypeName ?? ""),
      ])
    );
    const receiptEvidence = inferReceiptEvidence(e.documentType, e.fields);
    const families = receiptEvidence && !labelFamilies.includes("Receipt")
      ? [...labelFamilies, "Receipt"]
      : labelFamilies;
    return {
      fileName: e.fileName,
      rawType: e.documentType,
      canonicalName: classification.documentTypeName,
      classifyConfidence: classification.confidence,
      family: families[0] ?? null,
      families,
      text,
      billStatus: status,
      billEvidence: evidence,
      ...(receiptEvidence ? { receiptEvidence } : {}),
      ...(balance ? { outstandingBalance: balance } : {}),
    };
  });
}

/** Build the bill-status signal for the item. A detected FINAL bill wins over
 *  an interim one (a final bill being present is the more relevant fact). */
export function buildBillStatusSignal(docs: RecognizedDoc[]): BillStatusSignal | null {
  const final = docs.find((d) => d.billStatus === "final");
  const target = final ?? docs.find((d) => d.billStatus === "interim");
  if (!target) return null;
  return {
    status: target.billStatus,
    fileName: target.fileName,
    evidence: target.billEvidence,
    ...(target.outstandingBalance ? { outstandingBalance: target.outstandingBalance } : {}),
  };
}

/**
 * Build the "Documents found" label list passed to the comparison LLM. Includes
 * the raw type, alias-resolved canonical name, billing family and bill-status
 * hint per file so the model can match required documents even when titles
 * differ. Shared by the worker and recompare so both prompt the model identically.
 */
export function buildDocumentTypesFound(docs: RecognizedDoc[]): string[] {
  return Array.from(
    new Set(
      docs.flatMap((d) => {
        const labels: string[] = [];
        if (d.rawType.trim()) labels.push(d.rawType);
        if (d.canonicalName) labels.push(d.canonicalName);
        labels.push(...d.families);
        if (d.billStatus !== "unknown") labels.push(`${d.billStatus} bill`);
        return labels;
      })
    )
  ).filter(Boolean);
}

/**
 * Build per-document provenance groups for the comparison prompt: each file
 * tagged with its recognised family (falling back to its raw document type),
 * plus its extracted fields as a flat map. Lets the model source provider /
 * facility / bill-amount from the billing document rather than a referral
 * letter's letterhead. Shared by the worker and the recompare route so both
 * prompt the model identically.
 */
export function buildDocumentGroups(
  docs: RecognizedDoc[],
  extractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[]
): { fileName: string; label: string; fields: Record<string, string> }[] {
  const familyByFile = new Map(docs.map((d) => [d.fileName, d.family]));
  return extractions.map((e) => ({
    fileName: e.fileName,
    label: familyByFile.get(e.fileName) ?? e.documentType ?? "Document",
    fields: Object.fromEntries(e.fields.map((f) => [f.label, f.value])),
  }));
}

// ── Required-document reconciliation ──────────────────────────────
// An unfound candidate with SOME positive evidence below this confidence is
// treated as "uncertain" (manual review) rather than a hard "not found".
const UNCERTAIN_THRESHOLD = 0.75;

/** Significant tokens (drop common filler words) for keyword matching. */
function tokens(name: string): string[] {
  const stop = new Set(["the", "of", "and", "or", "a", "an", "for", "summary", "copy"]);
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

function miss(req: RequiredDocument): RequiredDocumentCheck {
  return { documentTypeName: req.documentTypeName, found: false, confidence: 0, matchedVia: "none" };
}

/**
 * Resolve one required document against the recognised submission set.
 * Pure + deterministic. Never throws.
 *
 * Evidence tiers: canonical/alias library match and billing-family match
 * CONFIRM presence (found:true). Keyword overlap is weak evidence and can only
 * produce an "uncertain" (manual-review) result — never a confident found —
 * because a token like "discharge" appears in many unrelated documents.
 */
export function resolveRequiredDocument(
  req: RequiredDocument,
  docs: RecognizedDoc[]
): RequiredDocumentCheck {
  const reqNorm = normalize(req.documentTypeName);
  const reqFamilies = matchDocFamilies(req.documentTypeName);
  const reqTokens = tokens(req.documentTypeName);

  let found: RequiredDocumentCheck | null = null;
  let weak: RequiredDocumentCheck | null = null;

  for (const d of docs) {
    // 1. Canonical library match (exact / alias / fuzzy via classifier).
    if (d.canonicalName && normalize(d.canonicalName) === reqNorm) {
      return {
        documentTypeName: req.documentTypeName,
        found: true,
        confidence: Math.max(0.9, d.classifyConfidence),
        matchedVia: d.classifyConfidence >= 0.95 ? "canonical" : "alias",
        matchedFile: d.fileName,
        ...(d.billStatus !== "unknown" ? { billStatus: d.billStatus } : {}),
      };
    }

    // 2. Document-family / synonym match — the CBRE-012480 fix: an interim
    //    "Summary Bill" satisfies a "Summary Tax Invoice" requirement. A
    //    compound requirement ("Invoice/Receipt") is satisfied when the
    //    document shares ANY of its families (a receipt satisfies it).
    if (reqFamilies.length > 0 && d.families.some((f) => reqFamilies.includes(f))) {
      const evidenceMatch =
        reqFamilies.includes("Receipt") &&
        d.families.includes("Receipt") &&
        d.receiptEvidence != null &&
        !matchDocFamilies(d.rawType).includes("Receipt") &&
        !matchDocFamilies(d.canonicalName ?? "").includes("Receipt");
      const cand: RequiredDocumentCheck = {
        documentTypeName: req.documentTypeName,
        found: true,
        confidence: evidenceMatch ? d.receiptEvidence!.confidence : 0.85,
        matchedVia: evidenceMatch ? "evidence" : "synonym",
        matchedFile: d.fileName,
        ...(evidenceMatch ? { notes: d.receiptEvidence!.notes } : {}),
        ...(d.billStatus !== "unknown" ? { billStatus: d.billStatus } : {}),
      };
      if (!found || (cand.confidence ?? 0) > (found.confidence ?? 0)) found = cand;
      continue;
    }

    // 3. Keyword overlap — weak evidence only → at most "uncertain".
    if (reqTokens.length > 0) {
      const docNorm = ` ${d.text.toLowerCase()} `;
      const hits = reqTokens.filter((t) => docNorm.includes(t)).length;
      const ratio = hits / reqTokens.length;
      if (ratio >= 0.5) {
        const cand: RequiredDocumentCheck = {
          documentTypeName: req.documentTypeName,
          found: false,
          uncertain: true,
          confidence: Math.min(0.4 + ratio * 0.4, UNCERTAIN_THRESHOLD - 0.01),
          matchedVia: "keyword",
          matchedFile: d.fileName,
        };
        if (!weak || (cand.confidence ?? 0) > (weak.confidence ?? 0)) weak = cand;
      }
    }
  }

  return found ?? weak ?? miss(req);
}

/**
 * Reconcile the LLM's required-document check with the deterministic resolver.
 *
 * - Where we have NO domain knowledge of the required type (not a known family),
 *   the LLM's verdict is trusted — we can't second-guess it.
 * - Where we DO have domain knowledge (a hospital-billing-type requirement) and
 *   document labels to judge from, the deterministic resolver is authoritative:
 *   it both corrects false "not found" (CBRE-012480) AND downgrades a likely
 *   false "found" to manual review when no matching document is present.
 */
export function reconcileRequiredDocChecks(
  llmChecks: RequiredDocumentCheck[] | undefined,
  requiredDocuments: RequiredDocument[],
  docs: RecognizedDoc[]
): RequiredDocumentCheck[] {
  const byName = new Map((llmChecks ?? []).map((c) => [normalize(c.documentTypeName), c]));
  // Can we actually judge document types? (Recompare before persistence had no
  // labels, so deterministic absence wouldn't be meaningful there.)
  const haveLabels = docs.some((d) => d.rawType.trim() !== "" || d.canonicalName);

  return requiredDocuments.map((req) => {
    const llm = byName.get(normalize(req.documentTypeName));
    const deterministic = resolveRequiredDocument(req, docs);
    const reqFamily = matchDocFamily(req.documentTypeName);

    if (llm?.found) {
      // Deterministic confirms → strongest result.
      if (deterministic.found) return deterministic;
      // Domain knowledge + labels but no matching document of that family →
      // likely an LLM false positive; flag for manual review rather than trust.
      if (reqFamily && haveLabels) {
        if (deterministic.uncertain) return deterministic;
        return {
          documentTypeName: req.documentTypeName,
          found: false,
          uncertain: true,
          confidence: 0.5,
          matchedVia: "llm",
          notes:
            llm.notes ??
            "Model reported this document present, but no matching document was detected — please verify.",
        };
      }
      // No domain knowledge to override the model.
      return { ...llm, matchedVia: llm.matchedVia ?? "llm" };
    }

    // LLM didn't find it → let deterministic recover it (found/uncertain).
    if (deterministic.found || deterministic.uncertain) return deterministic;

    return { ...miss(req), ...(llm?.notes ? { notes: llm.notes } : {}) };
  });
}
