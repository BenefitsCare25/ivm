import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { z } from "zod";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

const updateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  groupingFields: z.array(z.string()).max(5).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; configId: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id, configId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = updateConfigSchema.parse(body);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.groupingFields !== undefined) {
      updateData.groupingFields = toInputJson(data.groupingFields);
    }

    const updated = await db.comparisonConfig.updateMany({
      where: { id: configId, portalId: id },
      data: updateData,
    });

    if (updated.count === 0) throw new NotFoundError("ComparisonConfig");

    // Also sync portal-level groupingFields for backward compat with worker
    if (data.groupingFields !== undefined) {
      const allConfigs = await db.comparisonConfig.findMany({
        where: { portalId: id },
        select: { groupingFields: true },
      });
      const merged = new Set<string>();
      for (const c of allConfigs) {
        for (const f of (c.groupingFields as string[]) ?? []) merged.add(f);
      }
      await db.portal.update({
        where: { id },
        data: { groupingFields: toInputJson([...merged]) },
      });
    }

    clearTemplateCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; configId: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id, configId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    // Cascade deletes templates too
    const deleted = await db.comparisonConfig.deleteMany({
      where: { id: configId, portalId: id },
    });

    if (deleted.count === 0) throw new NotFoundError("ComparisonConfig");

    clearTemplateCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
