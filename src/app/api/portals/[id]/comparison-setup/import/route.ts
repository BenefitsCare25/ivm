import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id: targetId } = await params;
    const body = await req.json();
    const { sourcePortalId } = body;

    if (!sourcePortalId || typeof sourcePortalId !== "string") {
      throw new ValidationError("sourcePortalId is required");
    }
    if (sourcePortalId === targetId) {
      throw new ValidationError("Source and target portal must be different");
    }

    const target = await db.portal.findFirst({
      where: { id: targetId, userId: session.user.id },
    });
    if (!target) throw new NotFoundError("Portal");

    const source = await db.portal.findFirst({
      where: { id: sourcePortalId, userId: session.user.id },
    });
    if (!source) throw new NotFoundError("Source portal");

    const [sourceConfigs, sourceProviderGroups] = await Promise.all([
      db.comparisonConfig.findMany({
        where: { portalId: sourcePortalId },
        include: { templates: true },
      }),
      db.providerGroup.findMany({
        where: { portalId: sourcePortalId },
      }),
    ]);

    let templatesImported = 0;

    await db.$transaction(async (tx) => {
      await tx.portal.update({
        where: { id: targetId },
        data: { groupingFields: toInputJson(source.groupingFields) },
      });

      await tx.comparisonConfig.deleteMany({ where: { portalId: targetId } });
      await tx.comparisonTemplate.deleteMany({ where: { portalId: targetId } });
      await tx.providerGroup.deleteMany({ where: { portalId: targetId } });

      const providerGroupMap = new Map<string, string>();
      for (const pg of sourceProviderGroups) {
        const newPg = await tx.providerGroup.create({
          data: {
            portalId: targetId,
            name: pg.name,
            providerFieldName: pg.providerFieldName,
            matchMode: pg.matchMode,
            members: toInputJson(pg.members),
          },
        });
        providerGroupMap.set(pg.id, newPg.id);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function mapTemplates(templates: any[], configId: string) {
        return templates.map((t) => ({
          portalId: targetId,
          comparisonConfigId: configId,
          name: t.name,
          groupingKey: toInputJson(t.groupingKey),
          fields: toInputJson(t.fields),
          requiredDocuments: toInputJson(t.requiredDocuments),
          businessRules: toInputJson(t.businessRules),
          providerGroupId: t.providerGroupId ? (providerGroupMap.get(t.providerGroupId) ?? null) : null,
        }));
      }

      for (const config of sourceConfigs) {
        const newConfig = await tx.comparisonConfig.create({
          data: {
            portalId: targetId,
            name: config.name,
            groupingFields: toInputJson(config.groupingFields),
          },
        });

        if (config.templates.length > 0) {
          await tx.comparisonTemplate.createMany({ data: mapTemplates(config.templates, newConfig.id) });
          templatesImported += config.templates.length;
        }
      }

      // Legacy: source had templates without configs
      if (sourceConfigs.length === 0) {
        const legacyTemplates = await tx.comparisonTemplate.findMany({
          where: { portalId: sourcePortalId },
        });
        if (legacyTemplates.length > 0) {
          const newConfig = await tx.comparisonConfig.create({
            data: {
              portalId: targetId,
              name: "Claims Configuration",
              groupingFields: toInputJson(source.groupingFields),
            },
          });
          await tx.comparisonTemplate.createMany({ data: mapTemplates(legacyTemplates, newConfig.id) });
          templatesImported += legacyTemplates.length;
        }
      }
    });

    clearTemplateCache(targetId);

    return NextResponse.json({
      success: true,
      templatesImported,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
