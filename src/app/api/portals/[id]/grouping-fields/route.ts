import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateGroupingFieldsSchema } from "@/lib/validations/portal";
import { clearTemplateCache } from "@/lib/comparison-templates";

export async function PUT(
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
    const data = updateGroupingFieldsSchema.parse(body);

    const [allTemplates] = await Promise.all([
      db.comparisonTemplate.findMany({
        where: { portalId: id },
        select: { groupingKey: true },
      }),
      db.portal.update({
        where: { id },
        data: { groupingFields: JSON.parse(JSON.stringify(data.groupingFields)) },
      }),
    ]);

    const affectedTemplateCount = allTemplates.filter((t) => {
      const keyFields = Object.keys(t.groupingKey as Record<string, string>);
      return !keyFields.every((f) => data.groupingFields.includes(f)) ||
        !data.groupingFields.every((f) => keyFields.includes(f));
    }).length;

    clearTemplateCache(id);

    return NextResponse.json({ groupingFields: data.groupingFields, affectedTemplateCount });
  } catch (err) {
    return errorResponse(err);
  }
}
