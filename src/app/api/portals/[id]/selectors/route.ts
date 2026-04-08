import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateSelectorsSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSelectorsSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.listSelectors) {
      data.listSelectors = JSON.parse(JSON.stringify(parsed.data.listSelectors));
    }
    if (parsed.data.detailSelectors) {
      data.detailSelectors = JSON.parse(JSON.stringify(parsed.data.detailSelectors));
    }

    const updated = await db.portal.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Portal");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
