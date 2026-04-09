import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!fillSession) throw new NotFoundError("Session");

    const validations = await db.validationResult.findMany({
      where: { fillSessionId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(validations);
  } catch (err) {
    return errorResponse(err);
  }
}
