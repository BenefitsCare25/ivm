"use client";

import { CheckCircle2, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { ComparisonStatusBadge } from "../portal-status-badge";
import type { FieldComparison, ComparisonFieldStatus, ValidationAlert, ComparisonSummary } from "@/types/portal";
import { FWA_LABELS } from "@/types/portal";

interface ComparisonColumnProps {
  comparisonResult: ComparisonSummary | null;
  fwaAlerts: ValidationAlert[];
}

const MATCH: ComparisonFieldStatus = "MATCH";

function findAiDiagnosis(fieldComparisons: FieldComparison[]): string | null {
  const field = fieldComparisons.find((f) => {
    const name = f.fieldName.toLowerCase();
    return name.includes("diagnosis") || name === "icd-10" || name.includes("icd10") || name.includes("icd 10");
  });
  return field?.pdfValue ?? null;
}

export function ComparisonColumn({ comparisonResult, fwaAlerts }: ComparisonColumnProps) {
  const diagnosis = comparisonResult ? findAiDiagnosis(comparisonResult.fieldComparisons) : null;

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

          {/* Diagnosis */}
          {diagnosis && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground shrink-0">Diagnosis:</span>
              <span className="text-xs text-foreground">{diagnosis}</span>
            </div>
          )}

          {/* Full field comparison table */}
          <div className="overflow-hidden rounded-md border border-border">
            <div className="max-h-[350px] overflow-y-auto">
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
                      <td className="px-2 py-1.5 font-medium text-foreground truncate max-w-[120px]" title={field.fieldName}>
                        {field.fieldName}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]" title={field.pageValue ?? ""}>
                        {field.pageValue || "\u2014"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]" title={field.pdfValue ?? ""}>
                        {field.pdfValue || "\u2014"}
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

      {/* FWA Alerts */}
      {fwaAlerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            FWA Alerts ({fwaAlerts.length})
          </p>
          <div className="space-y-1.5">
            {fwaAlerts.map((alert) => (
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
