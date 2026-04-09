import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { updateGroupingFieldsSchema } from "@/lib/validations/portal";

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

    await db.portal.update({
      where: { id },
      data: { groupingFields: JSON.parse(JSON.stringify(data.groupingFields)) },
    });

    return NextResponse.json({ groupingFields: data.groupingFields });
  } catch (err) {
    return errorResponse(err);
  }
}
