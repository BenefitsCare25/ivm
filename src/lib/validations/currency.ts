import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseCurrencyAmount, isAmountField, isDateField } from "@/lib/currency/detector";
import { getSgdRate } from "@/lib/currency/mas-rates";

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
  const allFields = { ...(pageFields ?? {}), ...pdfFields };

  // Resolve incurred date — prefer portal data (more reliable), fall back to PDF fields
  const incurredDate = findIncurredDate(pageFields ?? {}) ?? findIncurredDate(pdfFields);
  const dateToUse = incurredDate ?? new Date().toISOString().split("T")[0];

  const conversions: CurrencyConversionMetadata[] = [];

  for (const [label, value] of Object.entries(pdfFields)) {
    if (!isAmountField(label)) continue;

    const parsed = parseCurrencyAmount(value);
    if (!parsed) continue;

    try {
      const result = await getSgdRate(parsed.code, dateToUse);
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
      });
    } catch (err) {
      logger.warn({ err, trackedItemId, label, currency: parsed.code }, "[currency] Rate fetch failed (non-fatal)");
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
          message: `${conv.fieldLabel}: ${conv.originalCurrency} ${conv.originalAmount.toFixed(2)} ≈ SGD ${conv.sgdAmount.toFixed(2)} (rate ${conv.rate.toFixed(4)} on ${conv.rateDate}${conv.isFuture ? " — estimated, future date" : conv.isFallback ? " — nearest available rate" : ""})`,
          metadata: JSON.parse(JSON.stringify(conv)),
        },
      })
    )
  );

  logger.info({ trackedItemId, count: conversions.length }, "[currency] Foreign currency conversions saved");
}

function findIncurredDate(fields: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (!isDateField(key) || !value) continue;

    // Try multiple date formats
    const cleaned = value.trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const d2 = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      if (!isNaN(d2.getTime())) return d2.toISOString().split("T")[0];
    }
  }
  return null;
}
