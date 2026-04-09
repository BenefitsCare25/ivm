import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateDocumentTypeSchema } from "@/lib/validations/intelligence";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const documentType = await db.documentType.findFirst({
      where: { id, userId: session.user.id },
      include: {
        _count: { select: { documentSetItems: true } },
      },
    });

    if (!documentType) throw new NotFoundError("Document type");

    return NextResponse.json(documentType);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateDocumentTypeSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Validation failed",
        parsed.error.flatten().fieldErrors
      );
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.category !== undefined) data.category = parsed.data.category;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.aliases !== undefined) {
      data.aliases = JSON.parse(JSON.stringify(parsed.data.aliases));
    }
    if (parsed.data.requiredFields !== undefined) {
      data.requiredFields = JSON.parse(
        JSON.stringify(parsed.data.requiredFields)
      );
    }

    const updated = await db.documentType.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Document type");

    logger.info(
      { documentTypeId: id, userId: session.user.id },
      "Document type updated"
    );

    const documentType = await db.documentType.findFirst({
      where: { id, userId: session.user.id },
      include: {
        _count: { select: { documentSetItems: true } },
      },
    });

    return NextResponse.json(documentType);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const deleted = await db.documentType.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Document type");

    logger.info(
      { documentTypeId: id, userId: session.user.id },
      "Document type deleted"
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
