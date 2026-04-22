import { logger } from "@/lib/logger";

const MAS_API = "https://eservices.mas.gov.sg/statistics/api/v1/exchange-rate";

const MAS_FIELD_MAP: Record<string, { field: string; units: number }> = {
  USD: { field: "usd_sgd",     units: 1   },
  EUR: { field: "eur_sgd",     units: 1   },
  GBP: { field: "gbp_sgd",     units: 1   },
  AUD: { field: "aud_sgd",     units: 1   },
  CAD: { field: "cad_sgd",     units: 1   },
  NZD: { field: "nzd_sgd",     units: 1   },
  CHF: { field: "chf_sgd",     units: 1   },
  SEK: { field: "sek_sgd",     units: 1   },
  DKK: { field: "dkk_sgd",     units: 1   },
  NOK: { field: "nok_sgd",     units: 1   },
  CNY: { field: "cny_10_sgd",  units: 10  },
  HKD: { field: "hkd_100_sgd", units: 100 },
  JPY: { field: "jpy_100_sgd", units: 100 },
  MYR: { field: "myr_100_sgd", units: 100 },
  THB: { field: "thb_100_sgd", units: 100 },
  IDR: { field: "idr_100_sgd", units: 100 },
  PHP: { field: "php_100_sgd", units: 100 },
  INR: { field: "inr_100_sgd", units: 100 },
};

export interface RateResult {
  rate: number;
  /** The date MAS actually published this rate (may differ from requested date). */
  actualDate: string;
  /** True if actualDate !== requestedDate — i.e. we fell back to a nearby business day. */
  isFallback: boolean;
  /** True if the requested date was after today — rate is an estimate only. */
  isFuture: boolean;
  /** Which API sourced this rate. */
  source: "mas" | "exchangerate-api";
}

// In-memory cache: "${code}:${requestedDate}" → RateResult
const rateCache = new Map<string, RateResult>();

const today = (): string => new Date().toISOString().split("T")[0];

/**
 * Fetch the SGD exchange rate for a given currency on or before the given date.
 * Returns the rate plus metadata about whether it is exact, a fallback, or an estimate
 * (when the requested date is in the future).
 */
export async function getSgdRate(currencyCode: string, date: string): Promise<RateResult | null> {
  const code = currencyCode.toUpperCase();
  const cacheKey = `${code}:${date}`;

  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey)!;

  const config = MAS_FIELD_MAP[code];
  if (!config) {
    logger.debug({ currency: code }, "[mas-rates] Unsupported currency");
    return null;
  }

  const requestedDate = new Date(date);
  if (isNaN(requestedDate.getTime())) return null;

  const isFuture = date > today();

  // For future dates cap the end_date at today so MAS doesn't reject the query
  const endDate = isFuture ? today() : date;

  // Look back 10 days to cover weekends and public holidays
  const start = new Date(endDate);
  start.setDate(start.getDate() - 10);
  const startStr = start.toISOString().split("T")[0];

  const url = `${MAS_API}?start_date=${startStr}&end_date=${endDate}&rows=15&fields=end_of_day,${config.field}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, currency: code, date }, "[mas-rates] MAS API error");
      return null;
    }

    const json = await res.json();
    const records: Record<string, string>[] = json?.result?.records ?? [];

    for (const record of [...records].reverse()) {
      const raw = record[config.field];
      if (!raw) continue;

      const actualDate = record["end_of_day"] as string;
      const rate = parseFloat(raw) / config.units;
      const result: RateResult = {
        rate,
        actualDate,
        isFallback: actualDate !== date,
        isFuture,
        source: "mas",
      };

      rateCache.set(cacheKey, result);
      logger.debug({ currency: code, requestedDate: date, actualDate, rate, isFuture }, "[mas-rates] Rate resolved");
      return result;
    }

    logger.warn({ currency: code, date }, "[mas-rates] No rate found in window");
    return null;
  } catch (err) {
    logger.warn({ err, currency: code, date }, "[mas-rates] Fetch failed");
    return null;
  }
}
