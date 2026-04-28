import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseCurrencyAmount, isAmountField, isDateField } from "@/lib/currency/detector";
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
  const seen = new Map<string, { labels: string[]; parsed: ReturnType<typeof parseCurrencyAmount> }>();

  for (const [label, value] of Object.entries(pdfFields)) {
    if (!isAmountField(label)) continue;

    const parsed = parseCurrencyAmount(value);
    if (!parsed) continue;

    const key = `${parsed.code}:${parsed.amount}`;
    const existing = seen.get(key);
    if (existing) {
      existing.labels.push(label);
    } else {
      seen.set(key, { labels: [label], parsed });
    }
  }

  const conversions: CurrencyConversionMetadata[] = [];

  for (const { labels, parsed } of seen.values()) {
    if (!parsed) continue;
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
          message: `${conv.fieldLabel}: ${conv.originalCurrency} ${conv.originalAmount.toFixed(2)} ≈ SGD ${conv.sgdAmount.toFixed(2)} (rate ${conv.rate.toFixed(4)} on ${conv.rateDate}${conv.isFuture ? " — estimated, future date" : conv.isFallback && conv.source === "mas" ? " — nearest MAS business day" : conv.source === "exchangerate-api" ? " — live rate" : ""})`,
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

function findIncurredDate(fields: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (!isDateField(key) || !value) continue;

    const cleaned = value.trim();

    // YYYY-MM-DD (ISO)
    if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
      const iso = cleaned.slice(0, 10);
      if (!isNaN(new Date(iso).getTime())) return iso;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
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
  }
  return null;
}
