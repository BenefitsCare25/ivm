import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

let registry: Registry | null = null;

export function getMetricsRegistry(): Registry {
  if (registry) return registry;

  registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return registry;
}

// ── Extraction ─────────────────────────────────────────────────────────────

export function getExtractionCounter(): Counter {
  const reg = getMetricsRegistry();
  const existing = reg.getSingleMetric("ivm_extractions_total");
  if (existing) return existing as Counter;

  return new Counter({
    name: "ivm_extractions_total",
    help: "Total number of AI extraction attempts",
    labelNames: ["provider", "status"],
    registers: [reg],
  });
}

export function getExtractionDuration(): Histogram {
  const reg = getMetricsRegistry();
  const existing = reg.getSingleMetric("ivm_extraction_duration_seconds");
  if (existing) return existing as Histogram;

  return new Histogram({
    name: "ivm_extraction_duration_seconds",
    help: "Duration of AI extraction requests in seconds",
    labelNames: ["provider"],
    buckets: [1, 5, 10, 20, 30, 60],
    registers: [reg],
  });
}

// ── Fill ───────────────────────────────────────────────────────────────────

export function getFillCounter(): Counter {
  const reg = getMetricsRegistry();
  const existing = reg.getSingleMetric("ivm_fills_total");
  if (existing) return existing as Counter;

  return new Counter({
    name: "ivm_fills_total",
    help: "Total number of fill executions",
    labelNames: ["target_type", "status"],
    registers: [reg],
  });
}

export function getFillFieldCounter(): Counter {
  const reg = getMetricsRegistry();
  const existing = reg.getSingleMetric("ivm_fill_fields_total");
  if (existing) return existing as Counter;

  return new Counter({
    name: "ivm_fill_fields_total",
    help: "Total number of fields processed during fill",
    labelNames: ["status"],
    registers: [reg],
  });
}
