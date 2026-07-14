import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseCurrencyAmount, isAmountField, isPrimaryAmountField, isDateField, DATE_FIELD_PRIORITY, SGD_PATTERN } from "@/lib/currency/detector";
import { resolveSgdRate } from "@/lib/currency";

export interface CurrencyConversionMetadata {
  fieldLabel: string;
  originalCurrency: string;
  originalAmount: number;
  sgdAmount: number;
  rate: number;
  rateDate: string;
  raw: string;
  isFallback: boolean;
  isFuture: boolean;
  isHistorical: boolean;
  source: "mas" | "exchangerate-api";
}

/**
 * Scan extracted PDF fields for foreign-currency amounts. For each one found,
 * look up the MAS historical SGD exchange rate for the incurred date and persist
 * a CURRENCY_CONVERSION ValidationResult.
 *
 * This is non-fatal — failures are logged and silently ignored.
 */
export async function checkForeignCurrency(
  trackedItemId: string,
  pdfFields: Record<string, string>,
  pageFields?: Record<string, string>
): Promise<void> {
  // Resolve incurred date — prefer portal data (more reliable), fall back to PDF fields
  const incurredDate = findIncurredDate(pageFields ?? {}) ?? findIncurredDate(pdfFields);
  const dateToUse = incurredDate ?? new Date().toISOString().split("T")[0];

  // Collect unique (currency, amount) pairs — multiple fields with the same value
  // (e.g. "Amount in Figures" and "Acknowledgement Receipt - Amount in Figures") would
  // otherwise produce duplicate conversion alerts for the same underlying amount.
  type ParsedAmount = NonNullable<ReturnType<typeof parseCurrencyAmount>>;
  const seen = new Map<string, { labels: string[]; parsed: ParsedAmount }>();
  const seenCurrencies = new Set<string>();
  // Bare-number amount fields (no currency prefix) collected for inferred-currency pass
  const bareCandidates: [string, string][] = [];
  const BARE_AMOUNT = /^[\d,]+\.?\d*$/;

  for (const [label, value] of Object.entries(pdfFields)) {
    if (!isAmountField(label)) continue;

    const parsed = parseCurrencyAmount(value);
    if (parsed) {
      seenCurrencies.add(parsed.code);
      const key = `${parsed.code}:${parsed.amount}`;
      const existing = seen.get(key);
      if (existing) existing.labels.push(label);
      else seen.set(key, { labels: [label], parsed });
    } else if (
      isPrimaryAmountField(label) &&
      BARE_AMOUNT.test(value.trim()) &&
      !SGD_PATTERN.test(value)
    ) {
      // No explicit currency — defer to inferred-currency pass below. Only
      // primary totals qualify, so an inferred currency isn't spread across
      // every bare-number line item (registration fee, each charge, etc.).
      bareCandidates.push([label, value]);
    }
  }

  // If exactly one foreign currency was detected, apply it to bare-number fields.
  // This handles fields like "Receipt Amount / Total Invoice: 27,030.50" where
  // the PDF omits the currency code but the document is clearly non-SGD.
  if (seenCurrencies.size === 1) {
    const inferredCode = seenCurrencies.values().next().value as string;
    for (const [label, value] of bareCandidates) {
      const trimmed = value.trim();
      const amount = parseFloat(trimmed.replace(/,/g, ""));
      if (isNaN(amount) || amount <= 0) continue;

      const key = `${inferredCode}:${amount}`;
      if (seen.has(key)) {
        seen.get(key)!.labels.push(label);
      } else {
        seen.set(key, { labels: [label], parsed: { code: inferredCode, amount, raw: trimmed } });
      }
    }
  }

  const conversions: CurrencyConversionMetadata[] = [];

  // Bound the list: a detailed hospital bill has dozens of amount-like lines
  // (department subtotals, per-line charges). Surface only the most relevant few.
  // Rank "key totals" (grand/final bill, outstanding/payable balance, amount due)
  // FIRST so a small-but-critical figure — e.g. the co-payment balance — is never
  // crowded out by larger line-item subtotals; then fill remaining slots largest-
  // first (the claim total is virtually always the biggest figure).
  const MAX_CONVERSIONS = 6;
  const KEY_TOTAL_LABEL = /outstanding|balance|amount\s*(due|payable)|final|grand|net\s*(payable|amount)|total\s*(bill|payable|due)|presented\s*bill/i;
  const keyRank = (labels: string[]) => (labels.some((l) => KEY_TOTAL_LABEL.test(l)) ? 0 : 1);
  const ranked = [...seen.values()]
    .sort((a, b) => keyRank(a.labels) - keyRank(b.labels) || b.parsed.amount - a.parsed.amount)
    .slice(0, MAX_CONVERSIONS);

  for (const { labels, parsed } of ranked) {
    const label = labels.join(" / ");
    try {
      const result = await resolveSgdRate(parsed.code, dateToUse);
      if (result === null) continue;

      const sgdAmount = Math.round(parsed.amount * result.rate * 100) / 100;
      conversions.push({
        fieldLabel: label,
        originalCurrency: parsed.code,
        originalAmount: parsed.amount,
        sgdAmount,
        rate: result.rate,
        rateDate: result.actualDate,
        raw: parsed.raw,
        isFallback: result.isFallback,
        isFuture: result.isFuture,
        isHistorical: result.isHistorical,
        source: result.source,
      });
    } catch (err) {
      logger.warn({ err, trackedItemId, label: labels[0], currency: parsed.code }, "[currency] Rate fetch failed (non-fatal)");
    }
  }

  if (conversions.length === 0) return;

  // Replace previous results from prior attempts
  await db.validationResult.deleteMany({
    where: { trackedItemId, ruleType: "CURRENCY_CONVERSION" },
  });

  await Promise.all(
    conversions.map((conv) =>
      db.validationResult.create({
        data: {
          trackedItemId,
          ruleType: "CURRENCY_CONVERSION",
          status: "WARNING",
          message: `${conv.fieldLabel}: ${conv.originalCurrency} ${conv.originalAmount.toFixed(2)} ≈ SGD ${conv.sgdAmount.toFixed(2)} (rate ${conv.rate.toFixed(4)} on ${conv.rateDate}${conv.isFuture ? " — estimated, future date" : conv.isFallback && conv.source === "mas" ? " — nearest MAS business day" : conv.source === "exchangerate-api" && !conv.isHistorical ? " — live rate" : ""})`,
          metadata: JSON.parse(JSON.stringify(conv)),
        },
      })
    )
  );

  logger.info({ trackedItemId, count: conversions.length }, "[currency] Foreign currency conversions saved");
}

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(value: string): string | null {
  const cleaned = value.trim();

  // YYYY-MM-DD (ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const iso = cleaned.slice(0, 10);
    if (!isNaN(new Date(iso).getTime())) return iso;
  }

  // DD/MM/YYYY or MM/DD/YYYY — disambiguate by range
  const slashed = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashed) {
    const [, a, b, yyyy] = slashed;
    const n1 = parseInt(a, 10);
    const n2 = parseInt(b, 10);

    let dd: string, mm: string;
    if (n2 > 12) {
      // Second number can't be a month → must be MM/DD/YYYY
      mm = a; dd = b;
    } else if (n1 > 12) {
      // First number can't be a month → must be DD/MM/YYYY
      dd = a; mm = b;
    } else {
      // Both ≤ 12: ambiguous — default DD/MM (SG locale)
      dd = a; mm = b;
    }

    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }

  // DD Mon YYYY  (e.g. "20 Mar 2026")
  const ddmonyyyy = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (ddmonyyyy) {
    const [, dd, mon, yyyy] = ddmonyyyy;
    const mm = MONTH_ABBR[mon.toLowerCase()];
    if (mm) {
      const iso = `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }

  // Mon DD, YYYY  (e.g. "Mar 20, 2026")
  const monddyyyy = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monddyyyy) {
    const [, mon, dd, yyyy] = monddyyyy;
    const mm = MONTH_ABBR[mon.toLowerCase()];
    if (mm) {
      const iso = `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }

  return null;
}

function findIncurredDate(fields: Record<string, string>): string | null {
  // Collect all parseable date fields
  const candidates: { key: string; iso: string }[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!isDateField(key) || !value) continue;
    const iso = parseDate(value);
    if (iso) candidates.push({ key, iso });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].iso;

  // Return the highest-priority match
  for (const pattern of DATE_FIELD_PRIORITY) {
    const match = candidates.find((c) => pattern.test(c.key));
    if (match) return match.iso;
  }

  return candidates[0].iso;
}
