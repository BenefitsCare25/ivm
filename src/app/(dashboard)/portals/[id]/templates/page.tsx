export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PortalComparisonSetup } from "@/components/portals/portal-comparison-setup";
import { toInputJson } from "@/lib/utils";
import type { DiscoveredClaimType, DetectedClaimType } from "@/types/portal";

export default async function PortalTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ configId?: string; autoCreate?: string; groupingKey?: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;
  const { configId, groupingKey: groupingKeyParam } = await searchParams;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!portal) notFound();

  // Load the specific config, or fall back to first config for the portal
  let config = configId
    ? await db.comparisonConfig.findFirst({
        where: { id: configId, portalId: id },
      })
    : await db.comparisonConfig.findFirst({
        where: { portalId: id },
        orderBy: { createdAt: "asc" },
      });

  // Auto-create default config if none exist (upsert for idempotency)
  if (!config) {
    config = await db.comparisonConfig.upsert({
      where: { portalId_name: { portalId: id, name: "Claims Configuration" } },
      update: {},
      create: {
        portalId: id,
        name: "Claims Configuration",
        groupingFields: toInputJson(portal.groupingFields ?? []),
      },
    });
  }

  // Use discovery data as primary source for available fields and claim types
  const discoveredTypes = (portal.discoveredClaimTypes ?? []) as unknown as DiscoveredClaimType[];
  const configGroupingFields = (config.groupingFields ?? []) as string[];

  // Available fields: union of all discovered detail fields, or fall back to scraped/selector data
  let availableFields: string[] = [];
  let detectedClaimTypes: DetectedClaimType[] = [];

  if (discoveredTypes.length > 0) {
    const fieldSet = new Set<string>();
    for (const dt of discoveredTypes) {
      for (const f of dt.detailFields) fieldSet.add(f);
    }
    availableFields = [...fieldSet].sort();

    const seen = new Set<string>();
    for (const dt of discoveredTypes) {
      const label = Object.values(dt.groupingKey).filter(Boolean).join(" / ") || "(empty)";
      if (!seen.has(label)) {
        seen.add(label);
        detectedClaimTypes.push({ label, groupingKey: dt.groupingKey });
      }
    }
    detectedClaimTypes.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    const listSelectors = (portal.listSelectors ?? {}) as Record<string, unknown>;
    const detailSelectors = (portal.detailSelectors ?? {}) as Record<string, unknown>;
    const listColumns = (listSelectors.columns as Array<{ name: string }> | undefined) ?? [];
    const detailFieldKeys = Object.keys(
      (detailSelectors.fieldSelectors as Record<string, unknown> | undefined) ?? {}
    );

    const recentItems = await db.trackedItem.findMany({
      where: { scrapeSession: { portalId: id } },
      select: { listData: true, detailData: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const scrapedFields = new Set<string>();
    for (const item of recentItems) {
      Object.keys((item.listData as Record<string, unknown>) ?? {}).forEach((k) => scrapedFields.add(k));
      Object.keys((item.detailData as Record<string, unknown>) ?? {}).forEach((k) => scrapedFields.add(k));
    }

    const selectorFields = [...listColumns.map((c) => c.name), ...detailFieldKeys];
    availableFields = scrapedFields.size > 0
      ? [...scrapedFields].sort()
      : [...new Set(selectorFields)];

    const groupingField = configGroupingFields[0] ?? null;
    if (groupingField) {
      const seen = new Set<string>();
      for (const item of recentItems) {
        const val =
          (item.listData as Record<string, unknown>)?.[groupingField] ??
          (item.detailData as Record<string, unknown>)?.[groupingField];
        if (val && typeof val === "string" && !seen.has(val)) {
          seen.add(val);
          detectedClaimTypes.push({ label: val, groupingKey: { [groupingField]: val } });
        }
      }
      detectedClaimTypes.sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  // If "Configure" was clicked from discovery with a specific groupingKey, pass it for auto-create
  let initialGroupingKey: Record<string, string> | null = null;
  if (groupingKeyParam) {
    try {
      const parsed = JSON.parse(groupingKeyParam);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        initialGroupingKey = parsed as Record<string, string>;
      }
    } catch { /* ignore invalid JSON */ }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/portals/${id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {portal.name}
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-foreground">{config.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure which fields the AI checks and what rules apply — per claim type.
          The AI auto-selects the right template based on each item&apos;s claim type when comparing.
        </p>
      </div>

      <PortalComparisonSetup
        portalId={id}
        configId={config.id}
        configName={config.name}
        groupingFields={configGroupingFields}
        availableFields={availableFields}
        detectedClaimTypes={detectedClaimTypes}
      />
    </div>
  );
}
