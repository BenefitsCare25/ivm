export interface ParsedAmount {
  code: string;    // ISO 4217: "USD", "MYR", etc.
  amount: number;  // numeric value
  raw: string;     // original string
}

interface CurrencyPattern {
  pattern: RegExp;
  code: string;
}

// Ordered by specificity — more specific patterns first to avoid mismatches
const CURRENCY_PATTERNS: CurrencyPattern[] = [
  // USD — "USD 500", "US$ 500", "US$500"
  { pattern: /\bUSD\s*([\d,]+\.?\d*)/i, code: "USD" },
  { pattern: /US\$\s*([\d,]+\.?\d*)/i, code: "USD" },
  // EUR
  { pattern: /\bEUR\s*([\d,]+\.?\d*)/i, code: "EUR" },
  { pattern: /€\s*([\d,]+\.?\d*)/, code: "EUR" },
  // GBP
  { pattern: /\bGBP\s*([\d,]+\.?\d*)/i, code: "GBP" },
  { pattern: /£\s*([\d,]+\.?\d*)/, code: "GBP" },
  // MYR — "MYR 1,200", "RM 1,200", "RM1200"
  { pattern: /\bMYR\s*([\d,]+\.?\d*)/i, code: "MYR" },
  { pattern: /\bRM\s*([\d,]+\.?\d*)/i, code: "MYR" },
  // AUD
  { pattern: /\bAUD\s*([\d,]+\.?\d*)/i, code: "AUD" },
  { pattern: /\bA\$\s*([\d,]+\.?\d*)/i, code: "AUD" },
  // JPY
  { pattern: /\bJPY\s*([\d,]+\.?\d*)/i, code: "JPY" },
  { pattern: /¥\s*([\d,]+\.?\d*)/, code: "JPY" },
  // CNY / RMB
  { pattern: /\bCNY\s*([\d,]+\.?\d*)/i, code: "CNY" },
  { pattern: /\bRMB\s*([\d,]+\.?\d*)/i, code: "CNY" },
  // HKD
  { pattern: /\bHKD\s*([\d,]+\.?\d*)/i, code: "HKD" },
  { pattern: /\bHK\$\s*([\d,]+\.?\d*)/i, code: "HKD" },
  // THB
  { pattern: /\bTHB\s*([\d,]+\.?\d*)/i, code: "THB" },
  { pattern: /฿\s*([\d,]+\.?\d*)/, code: "THB" },
  // IDR
  { pattern: /\bIDR\s*([\d,]+\.?\d*)/i, code: "IDR" },
  { pattern: /\bRp\.?\s*([\d,]+\.?\d*)/i, code: "IDR" },
  // PHP
  { pattern: /\bPHP\s*([\d,]+\.?\d*)/i, code: "PHP" },
  { pattern: /₱\s*([\d,]+\.?\d*)/, code: "PHP" },
  // INR — "INR 546", "₹546", "Rs 546", "Rs. 546"
  { pattern: /\bINR\s*([\d,]+\.?\d*)/i, code: "INR" },
  { pattern: /₹\s*([\d,]+\.?\d*)/, code: "INR" },
  { pattern: /\bRs\.?\s*([\d,]+\.?\d*)/i, code: "INR" },
  // NZD
  { pattern: /\bNZD\s*([\d,]+\.?\d*)/i, code: "NZD" },
  { pattern: /\bNZ\$\s*([\d,]+\.?\d*)/i, code: "NZD" },
  // CAD
  { pattern: /\bCAD\s*([\d,]+\.?\d*)/i, code: "CAD" },
  { pattern: /\bC\$\s*([\d,]+\.?\d*)/i, code: "CAD" },
  // CHF
  { pattern: /\bCHF\s*([\d,]+\.?\d*)/i, code: "CHF" },
];

// SGD detection — if any of these match, skip (not foreign)
export const SGD_PATTERN = /\bSGD\b|\bS\$|\bS\s*\$/i;

/**
 * Parse a currency code and numeric amount from a raw string value.
 * Returns null if the value appears to be SGD or no recognisable foreign currency is found.
 */
export function parseCurrencyAmount(value: string): ParsedAmount | null {
  if (!value || SGD_PATTERN.test(value)) return null;

  // Receipts frequently print the currency as a label separated from the number
  // by a colon ("RM: 880", "Total (USD): 100"), which would otherwise break the
  // "<code><spaces><digits>" patterns. Normalise separators to spaces for matching
  // while still returning the original string as `raw`.
  const normalized = value.replace(/:/g, " ");

  for (const { pattern, code } of CURRENCY_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match || !match[1]) continue;

    const amount = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(amount) && amount > 0) {
      return { code, amount, raw: value.trim() };
    }
  }

  return null;
}

// Unambiguous currency WORDS → ISO code, for document-level currency inference
// when the amount itself is a bare number (e.g. a receipt prints "RM" as a
// separate label and the amount extracts as "880", but the amount-in-words says
// "eight hundred and eighty ringgit only"). Deliberately excludes "dollar" and
// "pound" — ambiguous across SGD/USD/AUD/… and common non-currency uses — so
// those stay driven by explicit codes/symbols only.
const CURRENCY_WORDS: { pattern: RegExp; code: string }[] = [
  { pattern: /\bringgit\b/i, code: "MYR" },
  { pattern: /\brupiah\b/i, code: "IDR" },
  { pattern: /\bbaht\b/i, code: "THB" },
  { pattern: /\bpeso\b/i, code: "PHP" },
  { pattern: /\brenminbi\b|\byuan\b/i, code: "CNY" },
  { pattern: /\brupees?\b/i, code: "INR" },
  { pattern: /\beuros?\b/i, code: "EUR" },
  // "won" (English past tense) and "dong" are excluded as too-common homographs;
  // "yen"/"pound"/"dollar" likewise stay driven by explicit codes/symbols only.
];

// Standalone ISO codes (no adjacent amount required) — a "Currency: MYR" field
// or an amount-in-words line naming the code.
const ISO_CODE_TOKEN =
  /\b(USD|EUR|GBP|MYR|AUD|JPY|CNY|HKD|THB|IDR|PHP|INR|NZD|CAD|CHF|KRW|VND)\b/i;

/**
 * Detect a currency ISO code from arbitrary text (a field label or value) WITHOUT
 * requiring an amount glued to it. Order: explicit "CODE 880"/symbol (via
 * parseCurrencyAmount) → standalone ISO code token → currency word. Returns null
 * for SGD or when there is no currency signal. Used to infer the document
 * currency for bare-number totals whose currency is stated elsewhere.
 */
export function detectCurrencyCode(text: string): string | null {
  if (!text || SGD_PATTERN.test(text)) return null;

  const parsed = parseCurrencyAmount(text);
  if (parsed) return parsed.code;

  const codeToken = text.match(ISO_CODE_TOKEN);
  if (codeToken) return codeToken[1].toUpperCase();

  for (const { pattern, code } of CURRENCY_WORDS) {
    if (pattern.test(text)) return code;
  }

  return null;
}

// Labels that look monetary (often contain "fee"/"amount") but are actually
// counts, rates, dosages or percentages — must NEVER be currency-converted
// (e.g. "Imaging Reporting Fee Quantity: 1.50" is 1.5 units, not RM 1.50).
const NON_MONETARY_LABEL = /quantit|\bqty\b|\bunits?\b|\bnos?\.?\b|\bcount\b|dosage|percent|\bpcs?\b|tablet|capsule|\bqnty\b/i;

/** Returns true if a field label looks like a monetary amount field. */
export function isAmountField(label: string): boolean {
  if (NON_MONETARY_LABEL.test(label)) return false;
  return /amount|total|charge|fee|cost|invoice|bill|claim|paid|payable|balance|outstanding|co-?pay|deductible|premium|settlement|reimburs/i.test(label);
}

// The claim-relevant TOTALS worth surfacing a currency conversion for. Used to
// bound the inferred-currency pass so a foreign bill doesn't emit a conversion
// card for every individual line item — only the totals a reviewer cares about.
const PRIMARY_AMOUNT_LABEL = /total|final|grand|net\s*amount|bill\s*amount|claim\s*amount|receipt\s*amount|invoice\s*amount|guarantee\s*amount|payable|outstanding|balance|amount\s*(due|payable)/i;

/** Returns true if a label is a primary/total amount (vs an individual line item). */
export function isPrimaryAmountField(label: string): boolean {
  if (NON_MONETARY_LABEL.test(label)) return false;
  return PRIMARY_AMOUNT_LABEL.test(label);
}

/** Returns true if a field label looks like a date field suitable for incurred date. */
export function isDateField(label: string): boolean {
  return /incurred|service.date|treatment.date|visit.date|admission.date|discharge.date|invoice.date|bill(ing)?.date|receipt.date|claim.date|consultation.date|procedure.date|transaction.date|statement.date|date.of.(visit|service|treatment|admission|discharge|claim|invoice|bill|loss|consultation|procedure)/i.test(label);
}

/**
 * Priority-ordered patterns for date field labels.
 * Earlier entries are preferred when multiple date fields exist.
 */
export const DATE_FIELD_PRIORITY: RegExp[] = [
  /incurred/i,
  /service.date|date.of.service/i,
  /visit.date|date.of.visit/i,
  /treatment.date|date.of.treatment/i,
  /admission.date|date.of.admission/i,
  /consultation.date|date.of.consultation/i,
  /procedure.date|date.of.procedure/i,
  /invoice.date|date.of.invoice/i,
  /bill(ing)?.date|date.of.bill/i,
  /receipt.date/i,
  /claim.date|date.of.claim/i,
  /transaction.date/i,
  /statement.date/i,
  /discharge.date|date.of.discharge/i,
  /date.of.loss/i,
];
