import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateSessionSchema } from "@/lib/validations/session";
import { logger } from "@/lib/logger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
        extractionResults: { select: { id: true, status: true, documentType: true, completedAt: true } },
        targetAssets: { select: { id: true, targetType: true, url: true, fileName: true, isSupported: true } },
        mappingSets: { select: { id: true, status: true, proposedAt: true } },
        fillActions: { select: { id: true, status: true } },
      },
    });

    if (!fillSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(fillSession);
  } catch (err) {
    logger.error({ err }, "Failed to get session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const updated = await db.fillSession.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await db.fillSession.delete({ where: { id } });

    logger.info({ sessionId: id }, "Session deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
