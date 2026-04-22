export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { TemplateDetailView } from "@/components/portals/template-detail-view";
import type { TemplateField, RequiredDocument, BusinessRule, DiscoveredClaimType } from "@/types/portal";

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
      include: { providerGroup: { select: { name: true } } },
    }),
    db.providerGroup.findMany({
      where: { portalId: id },
      select: { id: true, name: true, matchMode: true, members: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!portal) notFound();
  if (!template) notFound();

  const templateKey = template.groupingKey as Record<string, string>;
  const discovered = (portal.discoveredClaimTypes ?? []) as unknown as DiscoveredClaimType[];
  const matchingDiscovery = discovered.find((ct) => {
    return Object.entries(ct.groupingKey).every(
      ([k, v]) => templateKey[k]?.toLowerCase().trim() === v.toLowerCase().trim()
    );
  });

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
    matchMode: g.matchMode,
  }));

  return <TemplateDetailView template={serialized} providerGroups={serializedGroups} />;
}
