export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { TemplateDetailView } from "@/components/portals/template-detail-view";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string; templateId: string }>;
}) {
  const session = await requireAuth();
  const { id, templateId } = await params;

  const [portal, template] = await Promise.all([
    db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, name: true, groupingFields: true },
    }),
    db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
    }),
  ]);

  if (!portal) notFound();
  if (!template) notFound();

  const serialized = {
    id: template.id,
    portalId: portal.id,
    portalName: portal.name,
    name: template.name,
    groupingKey: template.groupingKey as Record<string, string>,
    fields: (template.fields as unknown as TemplateField[]) ?? [],
    requiredDocuments: (template.requiredDocuments as unknown as RequiredDocument[]) ?? [],
    businessRules: (template.businessRules as unknown as BusinessRule[]) ?? [],
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };

  return <TemplateDetailView template={serialized} />;
}
