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
const SGD_PATTERN = /\bSGD\b|\bS\$|\bS\s*\$/i;

/**
 * Parse a currency code and numeric amount from a raw string value.
 * Returns null if the value appears to be SGD or no recognisable foreign currency is found.
 */
export function parseCurrencyAmount(value: string): ParsedAmount | null {
  if (!value || SGD_PATTERN.test(value)) return null;

  for (const { pattern, code } of CURRENCY_PATTERNS) {
    const match = value.match(pattern);
    if (!match || !match[1]) continue;

    const amount = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(amount) && amount > 0) {
      return { code, amount, raw: value.trim() };
    }
  }

  return null;
}

/** Returns true if a field label looks like a monetary amount field. */
export function isAmountField(label: string): boolean {
  return /amount|total|charge|fee|cost|invoice|bill|claim|paid|payable|balance|outstanding|co-?pay|deductible|premium|settlement|reimburs/i.test(label);
}

/** Returns true if a field label looks like a date field suitable for incurred date. */
export function isDateField(label: string): boolean {
  return /incurred|service.date|treatment.date|visit.date|admission.date|discharge.date|invoice.date|bill.date|date.of.(visit|service|treatment|admission|discharge)/i.test(label);
}
