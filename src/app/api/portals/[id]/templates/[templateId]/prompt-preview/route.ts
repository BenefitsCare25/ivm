import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { buildPromptPreview } from "@/lib/ai/prompt-builder";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

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

    const fields = template.fields as unknown as TemplateField[];
    const requiredDocuments = template.requiredDocuments as unknown as RequiredDocument[];
    const businessRules = template.businessRules as unknown as BusinessRule[];

    const preview = buildPromptPreview({ fields, businessRules, requiredDocuments });

    return NextResponse.json({ preview });
  } catch (err) {
    return errorResponse(err);
  }
}
