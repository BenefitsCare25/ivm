import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { z } from "zod";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

const createConfigSchema = z.object({
  name: z.string().min(1).max(100),
  groupingFields: z.array(z.string()).max(5).default([]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const configs = await db.comparisonConfig.findMany({
      where: { portalId: id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { templates: true } } },
    });

    return NextResponse.json(
      configs.map((c) => ({
        id: c.id,
        portalId: c.portalId,
        name: c.name,
        groupingFields: c.groupingFields,
        templateCount: c._count.templates,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
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
    const session = await requireAuthApi();
    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const data = createConfigSchema.parse(body);

    const config = await db.comparisonConfig.create({
      data: {
        portalId: id,
        name: data.name,
        groupingFields: toInputJson(data.groupingFields),
      },
    });

    clearTemplateCache(id);

    return NextResponse.json(
      {
        id: config.id,
        portalId: config.portalId,
        name: config.name,
        groupingFields: config.groupingFields,
        templateCount: 0,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
