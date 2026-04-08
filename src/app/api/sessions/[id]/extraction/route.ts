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
    if (!fillSession) throw new NotFoundError("Session", id);

    const extraction = await db.extractionResult.findFirst({
      where: { fillSessionId: id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        documentType: true,
        fields: true,
        provider: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });

    return NextResponse.json({ extraction: extraction ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
