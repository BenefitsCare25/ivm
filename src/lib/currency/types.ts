export interface RateResult {
  rate: number;
  /** The date the rate was actually published (may differ from requested date). */
  actualDate: string;
  /** True if actualDate !== requestedDate — i.e. we fell back to a nearby business day. */
  isFallback: boolean;
  /** True if the requested date was after today — rate is an estimate only. */
  isFuture: boolean;
  /** True if the rate is date-specific historical data (not a live/latest rate). */
  isHistorical: boolean;
  /** Which API sourced this rate. ("mas" retained for legacy stored records.) */
  source: "frankfurter" | "exchangerate-api" | "mas";
}
