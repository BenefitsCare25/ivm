import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateProviderGroupSchema } from "@/lib/validations/portal";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, groupId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = updateProviderGroupSchema.parse(body);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.providerFieldName !== undefined) updateData.providerFieldName = data.providerFieldName;
    if (data.matchMode !== undefined) updateData.matchMode = data.matchMode;
    if (data.members !== undefined) updateData.members = toInputJson(data.members);

    const updated = await db.providerGroup.updateMany({
      where: { id: groupId, portalId: id },
      data: updateData,
    });

    if (updated.count === 0) throw new NotFoundError("ProviderGroup");

    clearTemplateCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, groupId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const deleted = await db.providerGroup.deleteMany({
      where: { id: groupId, portalId: id },
    });

    if (deleted.count === 0) throw new NotFoundError("ProviderGroup");

    clearTemplateCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
