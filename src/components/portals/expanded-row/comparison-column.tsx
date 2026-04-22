"use client";

import { CheckCircle2, XCircle, ShieldAlert, TrendingUp, Stethoscope } from "lucide-react";
import { ComparisonStatusBadge } from "../portal-status-badge";
import type { FieldComparison, ValidationAlert, ComparisonSummary } from "@/types/portal";
import { FWA_LABELS } from "@/types/portal";

interface ComparisonColumnProps {
  comparisonResult: ComparisonSummary | null;
  fwaAlerts: ValidationAlert[];
}

const SOURCE_LABELS: Record<string, string> = {
  document: "From Document",
  portal: "From Portal",
  inferred: "AI Inferred",
};

const SOURCE_COLORS: Record<string, string> = {
  document: "bg-emerald-500/20 text-emerald-400",
  portal: "bg-amber-500/20 text-amber-400",
  inferred: "bg-purple-500/20 text-purple-400",
};

export function ComparisonColumn({ comparisonResult, fwaAlerts }: ComparisonColumnProps) {
  const diagnosis = comparisonResult?.diagnosisAssessment ?? null;

  const currencyAlerts = fwaAlerts.filter((a) => a.ruleType === "CURRENCY_CONVERSION");
  const otherAlerts = fwaAlerts.filter((a) => a.ruleType !== "CURRENCY_CONVERSION");

  if (!comparisonResult && fwaAlerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">No comparison data available.</p>
      </div>
    );
  }

  const totalFields = comparisonResult?.fieldComparisons.length ?? 0;
  const matchRate = totalFields > 0
    ? Math.round(((comparisonResult?.matchCount ?? 0) / totalFields) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        AI Comparison & Alerts
      </p>

      {comparisonResult && (
        <>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-xs font-medium text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {comparisonResult.matchCount} matched
            </span>
            {comparisonResult.mismatchCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-medium text-status-error">
                <XCircle className="h-3.5 w-3.5" />
                {comparisonResult.mismatchCount} mismatched
              </span>
            )}
            {totalFields > 0 && (
              <span className="text-xs text-muted-foreground">
                {matchRate}% match rate
              </span>
            )}
          </div>

          {/* AI summary */}
          {comparisonResult.summary && (
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {comparisonResult.summary}
            </p>
          )}

          {/* Full field comparison table */}
          <div className="overflow-hidden rounded-md border border-border">
            <div className="max-h-[450px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted">
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Field</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Portal</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Document</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-[80px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonResult.fieldComparisons.map((field, i) => (
                    <tr
                      key={i}
                      className={`border-t border-border ${
                        field.status === "MISMATCH" ? "bg-status-error/5" : ""
                      }`}
                    >
                      <td className="px-2 py-1.5 font-medium text-foreground truncate max-w-[200px]" title={field.fieldName}>
                        {field.fieldName}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[200px]" title={field.pageValue ?? ""}>
                        {field.pageValue || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[200px]" title={field.pdfValue ?? ""}>
                        {field.pdfValue || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <ComparisonStatusBadge status={field.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Diagnosis Assessment */}
      {diagnosis && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-foreground">{diagnosis.diagnosis}</span>
            {diagnosis.icdCode && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {diagnosis.icdCode}
              </span>
            )}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${SOURCE_COLORS[diagnosis.source] ?? "bg-muted text-muted-foreground"}`}>
              {SOURCE_LABELS[diagnosis.source] ?? diagnosis.source}
            </span>
          </div>
          {diagnosis.evidence && (
            <p className="text-[11px] text-muted-foreground leading-relaxed pl-5.5">
              {diagnosis.evidence}
            </p>
          )}
        </div>
      )}

      {/* Currency Conversion Notices */}
      {currencyAlerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Currency Conversion
          </p>
          <div className="space-y-1.5">
            {currencyAlerts.map((alert) => {
              const meta = alert.metadata as {
                originalCurrency?: string;
                originalAmount?: number;
                sgdAmount?: number;
                rate?: number;
                rateDate?: string;
                fieldLabel?: string;
                isFallback?: boolean;
                isFuture?: boolean;
                source?: "mas" | "exchangerate-api";
              } | null;
              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs"
                >
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium mb-1 bg-blue-500/20 text-blue-400">
                      Foreign Currency
                    </span>
                    {meta ? (
                      <div className="space-y-0.5">
                        <p className="text-foreground/80 font-medium">
                          {meta.fieldLabel}: {meta.originalCurrency} {meta.originalAmount?.toFixed(2)}
                          {" → "}
                          <span className="text-blue-300">SGD {meta.sgdAmount?.toFixed(2)}</span>
                        </p>
                        <p className="text-muted-foreground">
                          Rate: 1 {meta.originalCurrency} = SGD {meta.rate?.toFixed(4)} &nbsp;·&nbsp; {meta.rateDate}
                          {meta.isFuture && (
                            <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-400">
                              ESTIMATED
                            </span>
                          )}
                          {!meta.isFuture && meta.isFallback && meta.source === "mas" && (
                            <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold bg-blue-500/20 text-blue-400">
                              NEAREST DATE
                            </span>
                          )}
                          {meta.source === "exchangerate-api" && (
                            <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400">
                              LIVE
                            </span>
                          )}
                        </p>
                      </div>
                    ) : (
                      <p className="text-foreground/80">{alert.message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FWA Alerts */}
      {otherAlerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            FWA Alerts ({otherAlerts.length})
          </p>
          <div className="space-y-1.5">
            {otherAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                  alert.status === "FAIL"
                    ? "border border-status-error/30 bg-status-error/10"
                    : "border border-amber-500/30 bg-amber-500/10"
                }`}
              >
                <ShieldAlert
                  className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                    alert.status === "FAIL" ? "text-status-error" : "text-amber-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <span
                    className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium mb-1 ${
                      alert.status === "FAIL"
                        ? "bg-status-error/20 text-status-error"
                        : "bg-amber-500/20 text-amber-500"
                    }`}
                  >
                    {FWA_LABELS[alert.ruleType] ?? alert.ruleType}
                  </span>
                  <p className="text-foreground/80 leading-relaxed">{alert.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
