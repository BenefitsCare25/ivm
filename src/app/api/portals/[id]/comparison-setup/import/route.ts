import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id: targetId } = await params;
    const body = await req.json();
    const { sourcePortalId } = body;

    if (!sourcePortalId || typeof sourcePortalId !== "string") {
      throw new ValidationError("sourcePortalId is required");
    }
    if (sourcePortalId === targetId) {
      throw new ValidationError("Source and target portal must be different");
    }

    const target = await db.portal.findFirst({
      where: { id: targetId, userId: session.user.id },
    });
    if (!target) throw new NotFoundError("Portal");

    const source = await db.portal.findFirst({
      where: { id: sourcePortalId, userId: session.user.id },
      include: { comparisonTemplates: true },
    });
    if (!source) throw new NotFoundError("Source portal");

    await db.$transaction(async (tx) => {
      await tx.portal.update({
        where: { id: targetId },
        data: { groupingFields: JSON.parse(JSON.stringify(source.groupingFields)) },
      });
      await tx.comparisonTemplate.deleteMany({ where: { portalId: targetId } });
      if (source.comparisonTemplates.length > 0) {
        await tx.comparisonTemplate.createMany({
          data: source.comparisonTemplates.map((t) => ({
            portalId: targetId,
            name: t.name,
            groupingKey: JSON.parse(JSON.stringify(t.groupingKey)),
            fields: JSON.parse(JSON.stringify(t.fields)),
          })),
        });
      }
    });

    return NextResponse.json({
      success: true,
      templatesImported: source.comparisonTemplates.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
