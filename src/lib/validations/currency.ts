import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseCurrencyAmount, detectCurrencyCode, detectCountryCurrency, isAmountField, isPrimaryAmountField, isDateField, DATE_FIELD_PRIORITY, SGD_PATTERN } from "@/lib/currency/detector";
import { resolveSgdRate } from "@/lib/currency";
import { parseDisplayDate as parseDate } from "@/lib/date-utils";

export interface CurrencyConversionMetadata {
  fieldLabel: string;
  /** Which side the foreign amount was found on — the submitted document or the portal record. */
  origin: "document" | "portal";
  originalCurrency: string;
  originalAmount: number;
  sgdAmount: number;
  rate: number;
  rateDate: string;
  raw: string;
  isFallback: boolean;
  isFuture: boolean;
  isHistorical: boolean;
  source: "frankfurter" | "exchangerate-api" | "mas";
}

// Provider/location-bearing field labels — ONLY these are scanned for a country
// name, so an incidental clinical mention ("patient travelled to Thailand")
// elsewhere in the document can't drive the currency inference.
const LOCATION_LABEL = /provider|clinic|hospital|address|company|facility|centre|center|vendor|merchant|payee|billed\s*from/i;

// A Singapore provider address must not be read as a foreign country merely
// because it contains a place-name like "Little India" or "China Street": a
// domestic address that names Singapore suppresses country inference entirely.
const SINGAPORE_HINT = /\bsingapore\b|\bs'?pore\b/i;

// The ¥ symbol is shared by Japanese Yen and Chinese Yuan (RMB); the detector
// defaults it to JPY. These signals mark a document/portal as RMB/CNY — a Chinese
// e-invoice (发票), an explicit RMB/CNY code, or 人民币 — so a ¥ amount on it is
// reinterpreted as CNY rather than JPY.
const RMB_SIGNAL = /\bRMB|\bCNY|人民[币幣]|发票|發票/i;

/** True when any field label/value carries a Chinese-Yuan (RMB) signal. */
function hasRmbSignal(
  pdfFields: Record<string, string>,
  pageFields?: Record<string, string>
): boolean {
  for (const fields of [pdfFields, pageFields ?? {}]) {
    for (const [label, value] of Object.entries(fields)) {
      if (RMB_SIGNAL.test(value) || RMB_SIGNAL.test(label)) return true;
    }
  }
  return false;
}

/**
 * Infer the document's currency from the provider's country when NO explicit
 * currency token exists. Scans ONLY location-bearing fields (provider/address/…)
 * so an incidental country mention in clinical text can't drive the currency.
 * Returns null for a Singapore (domestic) address or when no known country is
 * found. Only meaningful for bare-number receipts (e.g. a PHP service invoice
 * that prints plain numbers with "Philippines" only in the address).
 */
function inferProviderCurrency(
  pdfFields: Record<string, string>,
  pageFields?: Record<string, string>
): string | null {
  const located: string[] = [];
  for (const fields of [pdfFields, pageFields ?? {}]) {
    for (const [label, value] of Object.entries(fields)) {
      if (LOCATION_LABEL.test(label)) located.push(value);
    }
  }
  const text = located.join(" ");
  if (SINGAPORE_HINT.test(text)) return null;
  return detectCountryCurrency(text);
}

/** Numeric values of the portal's primary/total amount fields (receipt/claim/total). */
function collectPrimaryAmounts(fields: Record<string, string>): number[] {
  const out: number[] = [];
  for (const [label, value] of Object.entries(fields)) {
    if (!isPrimaryAmountField(label)) continue;
    const n = parseFloat(String(value).replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * Scan extracted document fields for foreign-currency amounts, convert each to
 * SGD using the incurred-date exchange rate (Frankfurter/ECB, then
 * ExchangeRate-API as fallback), and persist CURRENCY_CONVERSION ValidationResult
 * rows. Non-fatal — failures are logged and ignored.
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

  // Document-level currency signal: a currency stated ANYWHERE in the document
  // (a field label/value, or the amount-in-words) even when it isn't glued to a
  // number — e.g. a receipt that prints "RM" as a separate label so the amount
  // extracts as bare "880", but the amount-in-words reads "…eighty ringgit only".
  const documentCurrencies = new Set<string>();

  for (const [label, value] of Object.entries(pdfFields)) {
    const parsed = parseCurrencyAmount(value);

    // An EXPLICIT currency+amount (e.g. "MYR 230.00") is unambiguous, so capture
    // it regardless of the field label. Receipts routinely state the paid amount
    // inside a descriptive line — "The Sum of MYR 230.00 NO. 1 PAYMENT" — whose
    // label ("The Sum of") is not amount-like; gating this on isAmountField()
    // silently dropped the conversion even though the foreign amount is right
    // there in the value.
    if (parsed) {
      documentCurrencies.add(parsed.code);
      seenCurrencies.add(parsed.code);
      const key = `${parsed.code}:${parsed.amount}`;
      const existing = seen.get(key);
      if (existing) {
        if (!existing.labels.includes(label)) existing.labels.push(label);
      } else {
        seen.set(key, { labels: [label], parsed });
      }
      continue;
    }

    // No explicit amount glued to this field — still harvest a currency SIGNAL
    // from the value or label (e.g. "Currency: MYR", or "…ringgit only" in words)
    // for the bare-number inference pass below.
    const signal = detectCurrencyCode(value) ?? detectCurrencyCode(label);
    if (signal) documentCurrencies.add(signal);

    // Bare-number totals (currency omitted on the number): only PRIMARY amount
    // labels qualify, so an inferred currency isn't spread across every bare
    // line item (registration fee, each charge, etc.).
    if (
      isAmountField(label) &&
      isPrimaryAmountField(label) &&
      BARE_AMOUNT.test(value.trim()) &&
      !SGD_PATTERN.test(value)
    ) {
      bareCandidates.push([label, value]);
    }
  }

  // Portal fields can state the claim currency without an amount — e.g. a Remarks
  // field reading "In Ringgit". Harvest that signal too, so bare document/portal
  // amounts (no code glued to the number) infer the right currency instead of
  // being skipped.
  for (const [label, value] of Object.entries(pageFields ?? {})) {
    const signal = detectCurrencyCode(value) ?? detectCurrencyCode(label);
    if (signal) documentCurrencies.add(signal);
  }

  // Disambiguate the shared ¥ symbol: on a document/portal that signals RMB/CNY
  // (a Chinese e-invoice), a ¥-sourced amount the detector read as JPY is really
  // Chinese Yuan. Reclassify those entries CNY (leaving explicit "JPY"/円 amounts
  // untouched) so the conversion uses the correct currency and rate.
  if (hasRmbSignal(pdfFields, pageFields)) {
    let swapped = 0;
    for (const [key, entry] of [...seen]) {
      const raw = entry.parsed.raw;
      if (entry.parsed.code === "JPY" && /[¥￥]/.test(raw) && !/\bJPY\b|円|日本/i.test(raw)) {
        seen.delete(key);
        const cnyKey = `CNY:${entry.parsed.amount}`;
        const existing = seen.get(cnyKey);
        if (existing) {
          for (const l of entry.labels) if (!existing.labels.includes(l)) existing.labels.push(l);
        } else {
          seen.set(cnyKey, { labels: entry.labels, parsed: { ...entry.parsed, code: "CNY" } });
        }
        swapped++;
      }
    }
    if (swapped > 0) {
      // Rebuild the currency sets so the bare-number inference below uses CNY, not
      // the stale ¥→JPY signal.
      seenCurrencies.clear();
      for (const { parsed } of seen.values()) seenCurrencies.add(parsed.code);
      if (!seenCurrencies.has("JPY") && documentCurrencies.delete("JPY")) documentCurrencies.add("CNY");
    }
  }

  // Last-resort provider-country inference: no currency token appeared ANYWHERE
  // (no code, symbol, or currency word), so fall back to the provider's country
  // (e.g. a Philippine service invoice printing bare numbers → PHP). Gated on a
  // total absence of currency signals so it never overrides an explicit currency.
  if (seenCurrencies.size === 0 && documentCurrencies.size === 0) {
    const countryCurrency = inferProviderCurrency(pdfFields, pageFields);
    if (countryCurrency) documentCurrencies.add(countryCurrency);
  }

  // Infer the document currency for bare-number totals from the union of
  // amount-glued currencies and document-level signals. Applied only when the
  // whole document points to exactly ONE foreign currency, so a bare total is
  // never mis-tagged when the currency is ambiguous. This handles fields like
  // "Receipt Amount / Total Invoice: 27,030.50" (currency omitted on the number
  // but stated elsewhere) and the "RM"-label / "ringgit"-in-words receipt case.
  const effectiveCurrencies = new Set<string>([...seenCurrencies, ...documentCurrencies]);
  const claimCurrency = effectiveCurrencies.size === 1
    ? (effectiveCurrencies.values().next().value as string)
    : null;
  if (claimCurrency) {
    const inferredCode = claimCurrency;
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

  // Prefer the claim TOTAL over individual line items. An itemised receipt (each
  // line carrying its own currency amount) must convert the grand total — not
  // emit one alert per line. A captured amount counts as a total when its label
  // reads like a total, when it equals a portal primary amount (the authoritative
  // claim figure), or when it equals the sum of the other captured amounts (i.e.
  // it IS their grand total). If any totals are found, the non-total line items
  // are dropped; otherwise everything is kept (no identifiable total).
  // NB: `final` is scoped to "final bill/amount/…" — a bare `final` would wrongly
  // match line-item labels like "X-Ray — Final Cost", pulling every line in.
  const TOTAL_LABEL = /grand\s*total|\btotal\b|\bsum\b|final\s*(bill|amount|total|payable)|net\s*(amount|payable)|receipt\s*amount|invoice\s*amount|amount\s*(due|payable)|outstanding|balance|presented\s*bill/i;
  const portalTotals = collectPrimaryAmounts(pageFields ?? {});
  const docCandidates = [...seen.values()];
  const docSum = docCandidates.reduce((s, c) => s + c.parsed.amount, 0);
  const isTotalCandidate = (c: { labels: string[]; parsed: ParsedAmount }) =>
    c.labels.some((l) => TOTAL_LABEL.test(l)) ||
    portalTotals.some((p) => Math.abs(p - c.parsed.amount) < 0.01) ||
    (docCandidates.length > 2 && Math.abs(c.parsed.amount - (docSum - c.parsed.amount)) < 0.01);
  const totals = docCandidates.filter(isTotalCandidate);

  // Itemised receipt with NO captured grand-total field: if the portal records a
  // primary amount equal to the SUM of the document's (single-currency) line
  // items, that portal figure IS the foreign grand total. Convert it once and
  // drop the line items. The sum-equality guard keeps this from firing when the
  // portal already stored an SGD-converted figure (which won't equal the sum).
  if (totals.length === 0 && docCandidates.length > 1) {
    const codes = new Set(docCandidates.map((c) => c.parsed.code));
    if (codes.size === 1) {
      const code = docCandidates[0].parsed.code;
      const grand = portalTotals.find((p) => Math.abs(p - docSum) < 0.01);
      if (grand !== undefined) {
        totals.push({ labels: ["Grand Total"], parsed: { code, amount: grand, raw: `${code} ${grand}` } });
      }
    }
  }

  const documentAmounts = totals.length > 0 ? totals : docCandidates;

  const ranked = documentAmounts
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
        origin: "document",
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

  // ── Portal-side currency ──────────────────────────────────────────
  // The scan above covers extracted DOCUMENT fields. The portal's own amount
  // fields (e.g. "Receipt Amount: USD 61.95") were never currency-checked, so a
  // non-SGD portal receipt amount went through un-converted. Detect and convert
  // it too, tagged origin:"portal" so the reviewer sees the SGD equivalent of the
  // figure the portal recorded. Deduped independently of the document amounts.
  const portalFields = pageFields ?? {};
  // Skip portal amounts already surfaced by the document pass (same currency +
  // amount) so one figure appearing on both sides doesn't emit two near-identical
  // conversion alerts.
  const documentKeys = new Set(conversions.map((c) => `${c.originalCurrency}:${c.originalAmount}`));
  const portalSeen = new Map<string, { labels: string[]; parsed: ParsedAmount }>();
  for (const [label, value] of Object.entries(portalFields)) {
    if (!isAmountField(label)) continue;
    // Only EXPLICIT-currency portal amounts are converted. A bare portal amount is
    // NOT inferred as the claim currency: portals frequently pre-convert to SGD
    // (e.g. Receipt Amount 31.37 with a remark "amount already in Singapore
    // Dollar"), so treating a bare portal figure as foreign would mis-convert an
    // SGD value. The foreign figure is taken from the DOCUMENT instead.
    const parsed = parseCurrencyAmount(value); // null for SGD / bare numbers
    if (!parsed) continue;
    const key = `${parsed.code}:${parsed.amount}`;
    if (documentKeys.has(key)) continue;
    const existing = portalSeen.get(key);
    if (existing) existing.labels.push(label);
    else portalSeen.set(key, { labels: [label], parsed });
  }

  const portalRanked = [...portalSeen.values()]
    .sort((a, b) => keyRank(a.labels) - keyRank(b.labels) || b.parsed.amount - a.parsed.amount)
    .slice(0, MAX_CONVERSIONS);

  for (const { labels, parsed } of portalRanked) {
    const label = labels.join(" / ");
    try {
      const result = await resolveSgdRate(parsed.code, dateToUse);
      if (result === null) continue;

      const sgdAmount = Math.round(parsed.amount * result.rate * 100) / 100;
      conversions.push({
        fieldLabel: label,
        origin: "portal",
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
      logger.warn({ err, trackedItemId, label: labels[0], currency: parsed.code }, "[currency] Portal rate fetch failed (non-fatal)");
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
          message: `${conv.origin === "portal" ? "Portal — " : ""}${conv.fieldLabel}: ${conv.originalCurrency} ${conv.originalAmount.toFixed(2)} ≈ SGD ${conv.sgdAmount.toFixed(2)} (rate ${conv.rate.toFixed(4)} on ${conv.rateDate}${conv.isFuture ? " — estimated, future date" : conv.isFallback && conv.isHistorical ? " — nearest business day" : conv.source === "exchangerate-api" && !conv.isHistorical ? " — live rate" : ""})`,
          metadata: JSON.parse(JSON.stringify(conv)),
        },
      })
    )
  );

  logger.info({ trackedItemId, count: conversions.length }, "[currency] Foreign currency conversions saved");
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
