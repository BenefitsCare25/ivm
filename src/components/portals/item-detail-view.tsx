"use client";

import { FileText, Download, CheckCircle2, XCircle, AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComparisonStatusBadge } from "./portal-status-badge";
import { formatFieldLabel } from "@/lib/utils";
import type { TrackedItemStatus, ComparisonFieldStatus } from "@/types/portal";
import { FWA_RULE_TYPES, FWA_LABELS as FWA_RULE_LABELS } from "@/types/portal";

interface FileData {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadedAt: string | null;
}

interface ComparisonField {
  fieldName: string;
  pageValue: string | null;
  pdfValue: string | null;
  status: ComparisonFieldStatus;
  confidence: number;
  notes?: string;
}

interface ComparisonData {
  id: string;
  provider: string;
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  fields: ComparisonField[];
  createdAt: string;
  templateId: string | null;
  templateName: string | null;
}

interface ItemData {
  id: string;
  portalItemId: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  files: FileData[];
  comparison: ComparisonData | null;
}

interface ValidationData {
  id: string;
  ruleType: string;
  status: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ItemDetailViewProps {
  item: ItemData;
  portalId: string;
  sessionId: string;
  validations?: ValidationData[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VALIDATION_STATUS_ICON: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
  PASS: { icon: CheckCircle2, cls: "text-status-success" },
  FAIL: { icon: XCircle, cls: "text-status-error" },
  WARNING: { icon: AlertTriangle, cls: "text-amber-500" },
};

export function ItemDetailView({ item, portalId, sessionId, validations }: ItemDetailViewProps) {
  const comparison = item.comparison;
  const totalFields = comparison ? comparison.fields.length : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left column: Portal data + files */}
      <div className="space-y-4">
        {/* List data */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">List Page Data</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2">
              {Object.entries(item.listData).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-sm text-muted-foreground shrink-0">{key}</dt>
                  <dd className="text-sm text-foreground text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Detail data */}
        {item.detailData && Object.keys(item.detailData).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detail Page Data</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2">
                {Object.entries(item.detailData).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-sm text-muted-foreground shrink-0">{key}</dt>
                    <dd className="text-sm text-foreground text-right break-words max-w-[250px]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Downloaded files */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Downloaded Files ({item.files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {item.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files downloaded.</p>
            ) : (
              <div className="space-y-2">
                {item.files.map((file) => (
                  <a
                    key={file.id}
                    href={`/api/portals/${portalId}/scrape/${sessionId}/items/${item.id}/files/${file.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.mimeType} &middot; {formatBytes(file.sizeBytes)}
                      </p>
                    </div>
                    <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right column: Comparison */}
      <div className="space-y-4">
        {comparison ? (
          <>
            {/* Summary */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Comparison Result</CardTitle>
                  <div className="flex items-center gap-2">
                    {comparison.templateName ? (
                      <Badge variant="outline">{comparison.templateName}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground text-xs">
                        Full comparison
                      </Badge>
                    )}
                    <Badge variant="secondary">{comparison.provider}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-status-success" />
                    <div>
                      <p className="text-2xl font-semibold text-foreground">
                        {comparison.matchCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Matches</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-status-error" />
                    <div>
                      <p className="text-2xl font-semibold text-foreground">
                        {comparison.mismatchCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Mismatches</p>
                    </div>
                  </div>
                  {totalFields > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-2xl font-semibold text-foreground">
                          {Math.round((comparison.matchCount / totalFields) * 100)}%
                        </p>
                        <p className="text-xs text-muted-foreground">Match Rate</p>
                      </div>
                    </div>
                  )}
                </div>

                {comparison.summary && (
                  <p className="text-sm text-muted-foreground">{comparison.summary}</p>
                )}
              </CardContent>
            </Card>

            {/* Field-by-field comparison */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Field Comparison ({comparison.fields.length} fields)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Field</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Portal Value</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">PDF Value</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.fields.map((field, i) => (
                        <tr
                          key={i}
                          className={`border-t border-border ${
                            field.status === "MISMATCH" ? "bg-status-error/5" : ""
                          }`}
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {field.fieldName}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">
                            {field.pageValue ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">
                            {field.pdfValue ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <ComparisonStatusBadge status={field.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No comparison data yet. This item needs to be processed first.
              </p>
            </CardContent>
          </Card>
        )}

        {/* FWA Alerts */}
        {(() => {
          const fwaAlerts = validations?.filter((v) => FWA_RULE_TYPES.has(v.ruleType)) ?? [];
          const hasFail = fwaAlerts.some((v) => v.status === "FAIL");
          if (fwaAlerts.length === 0) return null;
          return (
            <Card className={hasFail ? "border-status-error/40" : "border-amber-400/40"}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  {hasFail ? (
                    <ShieldAlert className="h-4 w-4 text-status-error" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                  )}
                  <CardTitle className="text-base">
                    FWA Alerts ({fwaAlerts.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {fwaAlerts.map((v) => {
                    const { icon: Icon, cls } = VALIDATION_STATUS_ICON[v.status] ?? {
                      icon: AlertTriangle,
                      cls: "text-muted-foreground",
                    };
                    return (
                      <div
                        key={v.id}
                        className="flex items-start gap-3 rounded-lg border border-border p-3"
                      >
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cls}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">{v.message}</p>
                          <Badge
                            variant={v.status === "FAIL" ? "error" : "secondary"}
                            className="mt-1 text-xs"
                          >
                            {FWA_RULE_LABELS[v.ruleType] ?? formatFieldLabel(v.ruleType)}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Other validations */}
        {(() => {
          const others = validations?.filter((v) => !FWA_RULE_TYPES.has(v.ruleType)) ?? [];
          if (others.length === 0) return null;
          return (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Validations ({others.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {others.map((v) => {
                    const { icon: Icon, cls } = VALIDATION_STATUS_ICON[v.status] ?? {
                      icon: AlertTriangle,
                      cls: "text-muted-foreground",
                    };
                    return (
                      <div
                        key={v.id}
                        className="flex items-start gap-3 rounded-lg border border-border p-3"
                      >
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cls}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">{v.message}</p>
                          <Badge variant="secondary" className="mt-1 text-xs">
                            {formatFieldLabel(v.ruleType)}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>
    </div>
  );
}
