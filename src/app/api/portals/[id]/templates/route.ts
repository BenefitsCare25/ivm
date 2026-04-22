import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { createComparisonTemplateSchema } from "@/lib/validations/portal";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

export async function GET(
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

    const configId = req.nextUrl.searchParams.get("configId");
    const where: Record<string, unknown> = { portalId: id };
    if (configId) where.comparisonConfigId = configId;

    const templates = await db.comparisonTemplate.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { providerGroup: { select: { id: true, name: true } } },
    });

    return NextResponse.json(
      templates.map((t) => ({
        ...t,
        providerGroupId: t.providerGroupId ?? null,
        providerGroupName: t.providerGroup?.name ?? null,
        providerGroup: undefined,
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
    const data = createComparisonTemplateSchema.parse(body);

    const template = await db.comparisonTemplate.create({
      data: {
        portalId: id,
        comparisonConfigId: data.comparisonConfigId ?? null,
        providerGroupId: data.providerGroupId ?? null,
        name: data.name,
        groupingKey: toInputJson(data.groupingKey),
        fields: toInputJson(data.fields),
      },
    });

    clearTemplateCache(id);

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json(
        { message: "A template with this name and provider group already exists" },
        { status: 409 }
      );
    }
    return errorResponse(err);
  }
}
