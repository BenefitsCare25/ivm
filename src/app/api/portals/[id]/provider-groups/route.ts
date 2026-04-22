import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { createProviderGroupSchema } from "@/lib/validations/portal";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const groups = await db.providerGroup.findMany({
      where: { portalId: id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { templates: true } } },
    });

    return NextResponse.json(
      groups.map((g) => ({
        id: g.id,
        portalId: g.portalId,
        name: g.name,
        providerFieldName: g.providerFieldName,
        matchMode: g.matchMode,
        members: g.members ?? [],
        templateCount: g._count.templates,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = createProviderGroupSchema.parse(body);

    const group = await db.providerGroup.create({
      data: {
        portalId: id,
        name: data.name,
        providerFieldName: data.providerFieldName,
        matchMode: data.matchMode,
        members: toInputJson(data.members),
      },
    });

    clearTemplateCache(id);

    return NextResponse.json(
      {
        id: group.id,
        portalId: group.portalId,
        name: group.name,
        providerFieldName: group.providerFieldName,
        matchMode: group.matchMode,
        members: group.members ?? [],
        templateCount: 0,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
