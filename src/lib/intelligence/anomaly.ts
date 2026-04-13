import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "intelligence-anomaly" });

// Substrings that identify likely monetary / numeric fields in portal data
const NUMERIC_HINTS = [
  "amount", "total", "charge", "fee", "cost", "price", "balance",
  "payment", "claim", "billed", "paid", "allowed", "deductible",
  "copay", "coinsurance", "qty", "quantity", "units",
];

const Z_THRESHOLD = 2.5;
const MIN_SAMPLES = 5;

function isNumericField(name: string): boolean {
  const lower = name.toLowerCase();
  return NUMERIC_HINTS.some((h) => lower.includes(h));
}

function parseNumeric(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? null : n;
}

function stats(values: number[]): { mean: number; stdDev: number } | null {
  if (values.length < MIN_SAMPLES) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? null : { mean, stdDev };
}

/**
 * Detects statistical anomalies in numeric portal fields by comparing current
 * values against historical baselines (last 100 processed items in same portal).
 *
 * An ANOMALY ValidationResult (WARNING) is written for each outlier field (z > 2.5).
 * Always non-fatal — never throws.
 */
export async function checkAnomalies(
  trackedItemId: string,
  portalId: string,
  fields: Record<string, string>
): Promise<void> {
  try {
    // Collect current numeric field candidates
    const candidates: { name: string; value: number }[] = [];
    for (const [name, raw] of Object.entries(fields)) {
      if (!isNumericField(name)) continue;
      const value = parseNumeric(raw);
      if (value !== null) candidates.push({ name, value });
    }

    if (candidates.length === 0) return;

    // Fetch historical items from same portal (last 100 processed)
    const history = await db.trackedItem.findMany({
      where: {
        id: { not: trackedItemId },
        scrapeSession: { portalId },
        status: { in: ["COMPARED", "FLAGGED", "VERIFIED"] },
        },
      select: { detailData: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    if (history.length < MIN_SAMPLES) return;

    for (const { name, value: current } of candidates) {
      const historical: number[] = [];

      for (const item of history) {
        const data = item.detailData as Record<string, string> | null;
        if (!data) continue;
        const entry = Object.entries(data).find(
          ([k]) => k.toLowerCase() === name.toLowerCase()
        );
        if (!entry) continue;
        const n = parseNumeric(entry[1]);
        if (n !== null) historical.push(n);
      }

      const s = stats(historical);
      if (!s) continue;

      const zScore = Math.abs((current - s.mean) / s.stdDev);
      if (zScore <= Z_THRESHOLD) continue;

      const direction = current > s.mean ? "higher" : "lower";

      await db.validationResult.create({
        data: {
          trackedItemId,
          ruleType: "ANOMALY",
          status: "WARNING",
          message: `"${name}" value ${current} is unusually ${direction} than typical (avg: ${s.mean.toFixed(2)}, z-score: ${zScore.toFixed(1)})`,
          metadata: JSON.parse(
            JSON.stringify({
              fieldName: name,
              currentValue: current,
              mean: parseFloat(s.mean.toFixed(2)),
              stdDev: parseFloat(s.stdDev.toFixed(2)),
              zScore: parseFloat(zScore.toFixed(2)),
              sampleSize: historical.length,
            })
          ),
        },
      });

      log.warn(
        { trackedItemId, fieldName: name, zScore, current, mean: s.mean },
        "[anomaly] Outlier detected"
      );
    }
  } catch (err) {
    log.warn({ err, trackedItemId }, "[anomaly] Check failed (non-fatal)");
  }
}
