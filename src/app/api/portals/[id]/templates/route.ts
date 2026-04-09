import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { createComparisonTemplateSchema } from "@/lib/validations/portal";

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

    const templates = await db.comparisonTemplate.findMany({
      where: { portalId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(templates);
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
    const data = createComparisonTemplateSchema.parse(body);

    const template = await db.comparisonTemplate.create({
      data: {
        portalId: id,
        name: data.name,
        groupingKey: JSON.parse(JSON.stringify(data.groupingKey)),
        fields: JSON.parse(JSON.stringify(data.fields)),
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
