"use client";

import Link from "next/link";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ItemStatusBadge } from "./portal-status-badge";
import type { TrackedItemStatus } from "@/types/portal";

interface TableItem {
  id: string;
  portalItemId: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailUrl: string | null;
  fileCount: number;
  comparisonCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TrackedItemsTableProps {
  items: TableItem[];
  portalId: string;
  sessionId: string;
}

export function TrackedItemsTable({ items, portalId, sessionId }: TrackedItemsTableProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No items found in this session.
        </CardContent>
      </Card>
    );
  }

  // Determine column headers from first item's listData keys
  const columnKeys = items.length > 0
    ? Object.keys(items[0].listData).slice(0, 5)
    : [];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">ID</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
            {columnKeys.map((key) => (
              <th key={key} className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                {key}
              </th>
            ))}
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Files</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                {item.portalItemId || item.id.slice(0, 8)}
              </td>
              <td className="px-4 py-2.5">
                <ItemStatusBadge status={item.status} />
              </td>
              {columnKeys.map((key) => (
                <td key={key} className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">
                  {item.listData[key] ?? "—"}
                </td>
              ))}
              <td className="px-4 py-2.5">
                {item.fileCount > 0 && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <span>{item.fileCount}</span>
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  {item.detailUrl && (
                    <a
                      href={item.detailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/portals/${portalId}/sessions/${sessionId}/items/${item.id}`}>
                      Detail
                    </Link>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
