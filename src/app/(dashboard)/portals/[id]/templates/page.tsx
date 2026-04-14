export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PortalComparisonSetup } from "@/components/portals/portal-comparison-setup";

export default async function PortalTemplatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
    include: {
      scrapeSessions: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true },
      },
    },
  });

  if (!portal) notFound();

  // Derive available fields from selectors
  const listSelectors = (portal.listSelectors ?? {}) as Record<string, unknown>;
  const detailSelectors = (portal.detailSelectors ?? {}) as Record<string, unknown>;
  const listColumns = (listSelectors.columns as Array<{ name: string }> | undefined) ?? [];
  const detailFieldKeys = Object.keys(
    (detailSelectors.fieldSelectors as Record<string, unknown> | undefined) ?? {}
  );
  const availableFields = [...new Set([...listColumns.map((c) => c.name), ...detailFieldKeys])];

  // Detect distinct claim type values from recent scraped items
  const recentItems = await db.trackedItem.findMany({
    where: { scrapeSession: { portalId: id } },
    select: { listData: true, detailData: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const groupingField = ((portal.groupingFields ?? []) as string[])[0] ?? null;
  const detectedClaimTypes: string[] = [];
  if (groupingField) {
    const seen = new Set<string>();
    for (const item of recentItems) {
      const val =
        (item.listData as Record<string, unknown>)?.[groupingField] ??
        (item.detailData as Record<string, unknown>)?.[groupingField];
      if (val && typeof val === "string" && !seen.has(val)) {
        seen.add(val);
        detectedClaimTypes.push(val);
      }
    }
    detectedClaimTypes.sort();
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
        <h1 className="text-xl font-semibold text-foreground">Claims Configuration</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure which fields the AI checks and what rules apply — per claim type.
          The AI auto-selects the right template based on each item&apos;s claim type when comparing.
        </p>
      </div>

      <PortalComparisonSetup
        portalId={id}
        groupingFields={(portal.groupingFields ?? []) as string[]}
        availableFields={availableFields}
        detectedClaimTypes={detectedClaimTypes}
      />
    </div>
  );
}
