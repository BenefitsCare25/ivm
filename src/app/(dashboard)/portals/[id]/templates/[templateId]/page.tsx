export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { TemplateDetailView } from "@/components/portals/template-detail-view";
import { itemMatchesGroupingKey } from "@/lib/comparison-templates";
import { fuzzyMatchProvider, normalizeForMatch } from "@/lib/provider-matching";
import type {
  TemplateField,
  RequiredDocument,
  BusinessRule,
  DiscoveredClaimType,
  ProviderGroupMatchMode,
} from "@/types/portal";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string; templateId: string }>;
}) {
  const session = await requireAuth();
  const { id, templateId } = await params;

  const [portal, template, providerGroups] = await Promise.all([
    db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, name: true, groupingFields: true, discoveredClaimTypes: true },
    }),
    db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
      include: {
        comparisonConfig: { select: { groupingFields: true } },
        providerGroup: { select: { name: true } },
      },
    }),
    db.providerGroup.findMany({
      where: { portalId: id },
      select: {
        id: true,
        name: true,
        providerFieldName: true,
        matchMode: true,
        members: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!portal) notFound();
  if (!template) notFound();

  const templateKey = template.groupingKey as Record<string, string>;
  const groupingFields = (
    (template.comparisonConfig?.groupingFields as string[] | null) ??
    (portal.groupingFields as string[]) ??
    []
  );
  const discovered = (portal.discoveredClaimTypes ?? []) as unknown as DiscoveredClaimType[];
  const matchingDiscovery = discovered.find((ct) => {
    return Object.entries(ct.groupingKey).every(
      ([k, v]) => templateKey[k]?.toLowerCase().trim() === v.toLowerCase().trim()
    );
  });

  const [scopeTemplates, recentItems] = groupingFields.length > 0
    ? await Promise.all([
        db.comparisonTemplate.findMany({
          where: {
            portalId: id,
            comparisonConfigId: template.comparisonConfigId ?? null,
          },
          select: { id: true, groupingKey: true, providerGroupId: true },
        }),
        db.trackedItem.findMany({
          where: { scrapeSession: { portalId: id } },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { listData: true, detailData: true },
        }),
      ])
    : [[], []];

  const providerGroupById = new Map(providerGroups.map((group) => [group.id, group]));
  const normalizedMembersByGroup = new Map(
    providerGroups.map((group) => [
      group.id,
      ((group.members ?? []) as string[]).map(normalizeForMatch),
    ])
  );
  const uncoveredProviders = new Set<string>();
  let sampledClaimCount = 0;

  for (const item of recentItems) {
    const itemData = {
      ...(item.listData as Record<string, string>),
      ...((item.detailData as Record<string, string>) ?? {}),
    };
    if (!itemMatchesGroupingKey(groupingFields, itemData, templateKey)) continue;
    sampledClaimCount += 1;

    const candidates = scopeTemplates.filter((candidate) =>
      itemMatchesGroupingKey(
        groupingFields,
        itemData,
        candidate.groupingKey as Record<string, string>
      )
    );
    const grouped = candidates.filter((candidate) => candidate.providerGroupId);
    const ungrouped = candidates.some((candidate) => !candidate.providerGroupId);
    const listCandidates = grouped.filter((candidate) =>
      providerGroupById.get(candidate.providerGroupId!)?.matchMode === "list"
    );
    const hasListMatch = listCandidates.some((candidate) => {
      const group = providerGroupById.get(candidate.providerGroupId!);
      if (!group) return false;
      const providerValue = itemData[group.providerFieldName];
      return !!providerValue && fuzzyMatchProvider(
        providerValue,
        normalizedMembersByGroup.get(group.id) ?? []
      );
    });
    const hasOthersFallback = grouped.some((candidate) =>
      providerGroupById.get(candidate.providerGroupId!)?.matchMode === "others"
    );

    if (!hasListMatch && !hasOthersFallback && !ungrouped) {
      const providerField = listCandidates
        .map((candidate) => providerGroupById.get(candidate.providerGroupId!)?.providerFieldName)
        .find(Boolean);
      uncoveredProviders.add(
        providerField && itemData[providerField]
          ? itemData[providerField]
          : providerField
            ? `Missing ${providerField}`
            : "Provider scope is not configured"
      );
    }
  }

  const serialized = {
    id: template.id,
    portalId: portal.id,
    portalName: portal.name,
    comparisonConfigId: template.comparisonConfigId ?? null,
    name: template.name,
    groupingKey: templateKey,
    fields: (template.fields as unknown as TemplateField[]) ?? [],
    requiredDocuments: (template.requiredDocuments as unknown as RequiredDocument[]) ?? [],
    businessRules: (template.businessRules as unknown as BusinessRule[]) ?? [],
    availableFields: matchingDiscovery?.detailFields ?? [],
    providerGroupId: template.providerGroupId ?? null,
    providerGroupName: (template as unknown as { providerGroup?: { name: string } }).providerGroup?.name ?? null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };

  const serializedGroups = providerGroups.map((g) => ({
    id: g.id,
    name: g.name,
    matchMode: g.matchMode as ProviderGroupMatchMode,
    providerFieldName: g.providerFieldName,
    members: (g.members ?? []) as string[],
  }));

  return (
    <TemplateDetailView
      template={serialized}
      providerGroups={serializedGroups}
      providerCoverage={{
        sampledClaimCount,
        uncoveredProviders: Array.from(uncoveredProviders).slice(0, 8),
      }}
    />
  );
}
