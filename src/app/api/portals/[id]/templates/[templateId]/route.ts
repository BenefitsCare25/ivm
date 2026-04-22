import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateComparisonTemplateSchema } from "@/lib/validations/portal";
import { clearTemplateCache } from "@/lib/comparison-templates";
import { toInputJson } from "@/lib/utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, templateId } = await params;

    const [, template] = await Promise.all([
      db.portal.findFirstOrThrow({ where: { id, userId: session.user.id }, select: { id: true } }),
      db.comparisonTemplate.findFirst({ where: { id: templateId, portalId: id } }),
    ]);
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

    const [, body] = await Promise.all([
      db.portal.findFirstOrThrow({ where: { id, userId: session.user.id }, select: { id: true } }),
      req.json(),
    ]);
    const data = updateComparisonTemplateSchema.parse(body);

    const template = await db.comparisonTemplate.update({
      where: { id: templateId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.providerGroupId !== undefined && { providerGroupId: data.providerGroupId }),
        ...(data.fields && { fields: toInputJson(data.fields) }),
        ...(data.requiredDocuments !== undefined && { requiredDocuments: toInputJson(data.requiredDocuments) }),
        ...(data.businessRules !== undefined && { businessRules: toInputJson(data.businessRules) }),
      },
    }).catch(() => { throw new NotFoundError("Template"); });

    clearTemplateCache(id);
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

    await db.portal.findFirstOrThrow({ where: { id, userId: session.user.id }, select: { id: true } });

    const deleted = await db.comparisonTemplate.deleteMany({
      where: { id: templateId, portalId: id },
    });

    if (deleted.count === 0) throw new NotFoundError("Template");

    clearTemplateCache(id);

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
