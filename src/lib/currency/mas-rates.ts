import { logger } from "@/lib/logger";

const MAS_API = "https://eservices.mas.gov.sg/statistics/api/v1/exchange-rate";

// MAS fields: { masField, units } — rate = masValue / units gives SGD per 1 foreign unit
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

// In-memory cache: "${code}:${date}" → SGD per 1 unit of foreign currency
const rateCache = new Map<string, number>();

/**
 * Fetch the SGD exchange rate for a given currency on or before the given date.
 * Uses the Monetary Authority of Singapore (MAS) exchange rate API.
 * Looks back up to 10 calendar days to cover weekends and public holidays.
 * Returns null if the currency is unsupported or the API is unavailable.
 */
export async function getSgdRate(currencyCode: string, date: string): Promise<number | null> {
  const code = currencyCode.toUpperCase();
  const cacheKey = `${code}:${date}`;

  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey)!;

  const config = MAS_FIELD_MAP[code];
  if (!config) {
    logger.debug({ currency: code }, "[mas-rates] Unsupported currency");
    return null;
  }

  // Look back up to 10 days so weekends and public holidays resolve to the prior business day
  const end = new Date(date);
  if (isNaN(end.getTime())) return null;
  const start = new Date(end);
  start.setDate(start.getDate() - 10);

  const startStr = start.toISOString().split("T")[0];
  const url = `${MAS_API}?start_date=${startStr}&end_date=${date}&rows=15&fields=end_of_day,${config.field}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, currency: code, date }, "[mas-rates] MAS API returned error");
      return null;
    }

    const json = await res.json();
    const records: Record<string, string>[] = json?.result?.records ?? [];

    // Records are returned oldest-first; reverse to get the most recent first
    for (const record of [...records].reverse()) {
      const raw = record[config.field];
      if (raw) {
        const rate = parseFloat(raw) / config.units;
        rateCache.set(cacheKey, rate);
        logger.debug({ currency: code, date: record["end_of_day"], rate }, "[mas-rates] Rate resolved");
        return rate;
      }
    }

    logger.warn({ currency: code, date }, "[mas-rates] No rate found in window");
    return null;
  } catch (err) {
    logger.warn({ err, currency: code, date }, "[mas-rates] Failed to fetch from MAS API");
    return null;
  }
}
