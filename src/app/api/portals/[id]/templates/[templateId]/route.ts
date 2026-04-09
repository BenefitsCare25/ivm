import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateComparisonTemplateSchema } from "@/lib/validations/portal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const template = await db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
    });
    if (!template) throw new NotFoundError("Template");

    return NextResponse.json(template);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const body = await req.json();
    const data = updateComparisonTemplateSchema.parse(body);

    const updated = await db.comparisonTemplate.updateMany({
      where: { id: templateId, portalId: id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.fields && { fields: JSON.parse(JSON.stringify(data.fields)) }),
      },
    });

    if (updated.count === 0) throw new NotFoundError("Template");

    const template = await db.comparisonTemplate.findUnique({
      where: { id: templateId },
    });

    return NextResponse.json(template);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    await db.portal.findFirstOrThrow({
      where: { id, userId: session.user.id },
      select: { id: true },
    });

    const deleted = await db.comparisonTemplate.deleteMany({
      where: { id: templateId, portalId: id },
    });

    if (deleted.count === 0) throw new NotFoundError("Template");

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
