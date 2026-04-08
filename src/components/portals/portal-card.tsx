"use client";

import Link from "next/link";
import { Globe, Clock, Wifi, WifiOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { ScrapeStatusBadge } from "./portal-status-badge";
import type { PortalSummary } from "@/types/portal";

interface PortalCardProps {
  portal: PortalSummary;
}

export function PortalCard({ portal }: PortalCardProps) {
  return (
    <Link href={`/portals/${portal.id}`}>
      <Card className="transition-colors hover:bg-muted/50 cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base truncate">{portal.name}</CardTitle>
            {portal.scheduleEnabled ? (
              <Wifi className="h-4 w-4 shrink-0 text-status-success" />
            ) : (
              <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{portal.baseUrl}</span>
          </div>

          <div className="flex items-center gap-2">
            {portal.lastScrapeStatus && (
              <ScrapeStatusBadge status={portal.lastScrapeStatus} />
            )}
            <span className="text-xs text-muted-foreground">
              {portal.totalItems} items tracked
            </span>
          </div>

          {portal.lastScrapeAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Last: {formatDate(portal.lastScrapeAt)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
