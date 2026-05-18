"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Activity, Flag, FileDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toSGTDateStr } from "@/lib/utils";

interface SummaryTotals {
  sessions: number;
  items: number;
  flagged: number;
  errors: number;
  files: number;
}

interface PortalRow {
  portalId: string;
  name: string;
  baseUrl: string;
  sessions: number;
  items: number;
  files: number;
  compared: number;
  flagged: number;
  errors: number;
  skipped: number;
  verified: number;
  requireDoc: number;
}

interface SummaryData {
  date: string;
  totals: SummaryTotals;
  statusBreakdown: Record<string, number>;
  byPortal: PortalRow[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; barColor: string }> = {
  COMPARED:    { label: "Matched",    color: "text-emerald-400",      barColor: "bg-emerald-500" },
  FLAGGED:     { label: "Flagged",    color: "text-amber-400",        barColor: "bg-amber-500" },
  VERIFIED:    { label: "Verified",   color: "text-sky-400",          barColor: "bg-sky-500" },
  ERROR:       { label: "Error",      color: "text-red-400",          barColor: "bg-red-500" },
  SKIPPED:     { label: "Skipped",    color: "text-muted-foreground", barColor: "bg-muted" },
  REQUIRE_DOC: { label: "Need Doc",   color: "text-purple-400",       barColor: "bg-purple-500" },
  PROCESSING:  { label: "Processing", color: "text-blue-400",         barColor: "bg-blue-500" },
  DISCOVERED:  { label: "Discovered", color: "text-muted-foreground", barColor: "bg-muted/50" },
};

const STATUS_ORDER = ["COMPARED", "VERIFIED", "FLAGGED", "REQUIRE_DOC", "ERROR", "SKIPPED", "PROCESSING", "DISCOVERED"];

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDisplayDate(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function StatusBar({ statusBreakdown }: { statusBreakdown: Record<string, number> }) {
  const total = Object.values(statusBreakdown).reduce((s, n) => s + n, 0);
  if (total === 0) return <div className="h-2 rounded-full bg-muted w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
        {STATUS_ORDER.map((status) => {
          const count = statusBreakdown[status] ?? 0;
          if (!count) return null;
          const cfg = STATUS_CONFIG[status] ?? { barColor: "bg-muted" };
          return (
            <div
              key={status}
              className={`${cfg.barColor} transition-all`}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${STATUS_CONFIG[status]?.label ?? status}: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STATUS_ORDER.map((status) => {
          const count = statusBreakdown[status] ?? 0;
          if (!count) return null;
          const cfg = STATUS_CONFIG[status];
          return (
            <span key={status} className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block w-2 h-2 rounded-full ${cfg?.barColor ?? "bg-muted"}`} />
              <span className="text-muted-foreground">{cfg?.label ?? status}</span>
              <span className="font-medium text-foreground">{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function FlagRate({ flagged, items }: { flagged: number; items: number }) {
  if (!items) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round((flagged / items) * 100);
  const cls = pct > 20 ? "text-red-400" : pct > 5 ? "text-amber-400" : "text-emerald-400";
  return <span className={`text-xs font-medium ${cls}`}>{pct}%</span>;
}

export function PortalDashboard() {
  const [date, setDate] = useState(() => toSGTDateStr(new Date()));
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const today = toSGTDateStr(new Date());
  const isToday = date === today;

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portals/summary?date=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const prev = () => setDate((d) => shiftDate(d, -1));
  const next = () => { if (!isToday) setDate((d) => shiftDate(d, 1)); };

  const statCards = [
    { label: "Scrape Sessions", value: data?.totals.sessions ?? 0, icon: Activity,  iconClass: "text-sky-400" },
    { label: "Items Processed", value: data?.totals.items ?? 0,    icon: Activity,  iconClass: "text-emerald-400" },
    { label: "Items Flagged",   value: data?.totals.flagged ?? 0,  icon: Flag,      iconClass: "text-amber-400" },
    { label: "Files Downloaded",value: data?.totals.files ?? 0,    icon: FileDown,  iconClass: "text-purple-400" },
  ];

  const isEmpty = !loading && !data?.totals.sessions;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Daily Summary</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[90px] text-center">
            {formatDisplayDate(date, today)}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={next} disabled={isToday}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, iconClass }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
            </div>
            <div className={`text-2xl font-semibold ${loading ? "animate-pulse text-muted-foreground" : "text-foreground"}`}>
              {loading ? "—" : value.toLocaleString()}
            </div>
          </Card>
        ))}
      </div>

      {isEmpty ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No scrape sessions on {formatDisplayDate(date, today)}.
        </Card>
      ) : data && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Item Outcome Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusBar statusBreakdown={data.statusBreakdown} />
            </CardContent>
          </Card>

          {data.byPortal.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">By Company / Portal URL</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Portal</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Sessions</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Items</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Matched</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Flagged</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Flag Rate</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-3 py-2.5">Errors</th>
                        <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Files</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPortal.map((row, i) => (
                        <tr
                          key={row.portalId}
                          className={`border-b border-border/50 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground leading-tight">{row.name}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-muted-foreground truncate max-w-[200px]">{row.baseUrl}</span>
                              <a href={row.baseUrl} target="_blank" rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground shrink-0">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </td>
                          <td className="text-right px-3 py-3 text-muted-foreground">{row.sessions}</td>
                          <td className="text-right px-3 py-3 font-medium text-foreground">{row.items}</td>
                          <td className="text-right px-3 py-3 text-emerald-400">{row.compared + row.verified}</td>
                          <td className="text-right px-3 py-3">
                            {row.flagged > 0
                              ? <span className="text-amber-400 font-medium">{row.flagged}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </td>
                          <td className="text-right px-3 py-3">
                            <FlagRate flagged={row.flagged} items={row.items} />
                          </td>
                          <td className="text-right px-3 py-3">
                            {row.errors > 0
                              ? <span className="text-red-400 font-medium">{row.errors}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </td>
                          <td className="text-right px-4 py-3 text-muted-foreground">{row.files}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
