"use client";

import { FileText, Download, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComparisonStatusBadge } from "./portal-status-badge";
import type { TrackedItemStatus, ComparisonFieldStatus } from "@/types/portal";

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

interface ItemDetailViewProps {
  item: ItemData;
  portalId: string;
  sessionId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ItemDetailView({ item, portalId, sessionId }: ItemDetailViewProps) {
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
                  <Badge variant="secondary">{comparison.provider}</Badge>
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
      </div>
    </div>
  );
}
