"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Activity, Flag, FileDown, ExternalLink, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toSGTDateStr } from "@/lib/utils";

type ViewMode = "day" | "month" | "year";

interface SummaryTotals {
  sessions: number;
  items: number;
  processed: number;
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
  processing?: number;
  discovered?: number;
}

interface SummaryData {
  period: string;
  view: ViewMode;
  source: string;
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

function currentPeriod(view: ViewMode): string {
  const today = toSGTDateStr(new Date());
  if (view === "day") return today;
  if (view === "month") return today.slice(0, 7);
  return today.slice(0, 4);
}

function shiftPeriod(period: string, view: ViewMode, dir: number): string {
  if (view === "day") {
    const d = new Date(`${period}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dir);
    return d.toISOString().split("T")[0];
  }
  if (view === "month") {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(Number(period) + dir);
}

function formatPeriodLabel(period: string, view: ViewMode): string {
  if (view === "day") {
    const today = toSGTDateStr(new Date());
    if (period === today) return "Today";
    if (period === shiftPeriod(today, "day", -1)) return "Yesterday";
    return new Date(`${period}T12:00:00Z`).toLocaleDateString("en-SG", {
      day: "numeric", month: "short", year: "numeric",
    });
  }
  if (view === "month") {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-SG", { month: "long", year: "numeric" });
  }
  return period;
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
  const [view, setView] = useState<ViewMode>("day");
  const [period, setPeriod] = useState(() => currentPeriod("day"));
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalFilter, setPortalFilter] = useState<string>("all");

  const cap = currentPeriod(view);
  const isCurrentPeriod = period === cap;

  const handleViewChange = (newView: ViewMode) => {
    setView(newView);
    setPeriod(currentPeriod(newView));
    setPortalFilter("all");
  };

  const load = useCallback(async (v: ViewMode, p: string) => {
    setData(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/portals/summary?view=${v}&period=${p}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(view, period); }, [view, period, load]);
  // Reset filter when period changes (selected portal may not exist in new period)
  useEffect(() => { setPortalFilter("all"); }, [view, period]);

  const prev = () => setPeriod((p) => shiftPeriod(p, view, -1));
  const next = () => { if (!isCurrentPeriod) setPeriod((p) => shiftPeriod(p, view, 1)); };

  const displayPortals = useMemo(() => {
    if (!data) return [];
    if (portalFilter === "all") return data.byPortal;
    return data.byPortal.filter((p) => p.portalId === portalFilter);
  }, [data, portalFilter]);

  const filteredTotals = useMemo((): SummaryTotals => {
    if (!data) return { sessions: 0, items: 0, processed: 0, flagged: 0, errors: 0, files: 0 };
    if (portalFilter === "all") return data.totals;
    return displayPortals.reduce(
      (acc, p) => {
        const processed = p.compared + p.verified + p.flagged + p.errors + p.skipped + p.requireDoc;
        return {
          sessions: acc.sessions + p.sessions,
          items: acc.items + p.items,
          processed: acc.processed + processed,
          flagged: acc.flagged + p.flagged,
          errors: acc.errors + p.errors,
          files: acc.files + p.files,
        };
      },
      { sessions: 0, items: 0, processed: 0, flagged: 0, errors: 0, files: 0 }
    );
  }, [data, portalFilter, displayPortals]);

  const filteredBreakdown = useMemo((): Record<string, number> => {
    if (!data) return {};
    if (portalFilter === "all") return data.statusBreakdown;
    const breakdown: Record<string, number> = {};
    const add = (key: string, val: number) => { if (val > 0) breakdown[key] = (breakdown[key] ?? 0) + val; };
    for (const p of displayPortals) {
      add("COMPARED", p.compared);
      add("FLAGGED", p.flagged);
      add("ERROR", p.errors);
      add("SKIPPED", p.skipped);
      add("VERIFIED", p.verified);
      add("REQUIRE_DOC", p.requireDoc);
      add("PROCESSING", p.processing ?? 0);
      add("DISCOVERED", p.discovered ?? 0);
    }
    return breakdown;
  }, [data, portalFilter, displayPortals]);

  const statCards = [
    { label: "Scrape Sessions", value: filteredTotals.sessions, icon: Activity, iconClass: "text-sky-400" },
    { label: "Items Processed", value: filteredTotals.processed, icon: Activity, iconClass: "text-emerald-400" },
    { label: "Items Flagged",   value: filteredTotals.flagged,  icon: Flag,     iconClass: "text-amber-400" },
    { label: "Files Downloaded",value: filteredTotals.files,    icon: FileDown, iconClass: "text-purple-400" },
  ];

  const isEmpty = !loading && !data?.totals.sessions;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Summary</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["day", "month", "year"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => handleViewChange(v)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  view === v
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium text-foreground min-w-[110px] text-center">
              {formatPeriodLabel(period, view)}
            </span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={next} disabled={isCurrentPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {data && data.byPortal.length > 1 && (
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <select
            value={portalFilter}
            onChange={(e) => setPortalFilter(e.target.value)}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All portals</option>
            {data.byPortal.map((p) => (
              <option key={p.portalId} value={p.portalId}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

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
          No scrape sessions for {formatPeriodLabel(period, view)}.
        </Card>
      ) : data && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Item Outcome Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusBar statusBreakdown={filteredBreakdown} />
            </CardContent>
          </Card>

          {displayPortals.length > 0 && (
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
                      {displayPortals.map((row, i) => (
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
                          <td className="text-right px-3 py-3 font-medium text-foreground">{row.compared + row.verified + row.flagged + row.errors + row.skipped + row.requireDoc}</td>
                          <td className="text-right px-3 py-3 text-emerald-400">{row.compared + row.verified}</td>
                          <td className="text-right px-3 py-3">
                            {row.flagged > 0
                              ? <span className="text-amber-400 font-medium">{row.flagged}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </td>
                          <td className="text-right px-3 py-3">
                            <FlagRate flagged={row.flagged} items={row.compared + row.verified + row.flagged + row.errors + row.skipped + row.requireDoc} />
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
