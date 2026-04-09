import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateDocumentSetSchema } from "@/lib/validations/intelligence";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

const ITEMS_INCLUDE = {
  items: {
    include: {
      documentType: { select: { id: true, name: true } },
    },
  },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const documentSet = await db.documentSet.findFirst({
      where: { id, userId: session.user.id },
      include: ITEMS_INCLUDE,
    });

    if (!documentSet) throw new NotFoundError("Document set");

    return NextResponse.json(documentSet);
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
    const parsed = updateDocumentSetSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Validation failed",
        parsed.error.flatten().fieldErrors
      );
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const updated = await db.documentSet.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Document set");

    if (parsed.data.items !== undefined) {
      await db.$transaction([
        db.documentSetItem.deleteMany({
          where: { documentSetId: id },
        }),
        db.documentSetItem.createMany({
          data: parsed.data.items.map((item) => ({
            documentSetId: id,
            documentTypeId: item.documentTypeId,
            isRequired: item.isRequired,
            minCount: item.minCount,
            maxCount: item.maxCount ?? null,
          })),
        }),
      ]);
    }

    logger.info(
      { documentSetId: id, userId: session.user.id },
      "Document set updated"
    );

    const documentSet = await db.documentSet.findFirst({
      where: { id, userId: session.user.id },
      include: ITEMS_INCLUDE,
    });

    return NextResponse.json(documentSet);
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

    const deleted = await db.documentSet.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Document set");

    logger.info(
      { documentSetId: id, userId: session.user.id },
      "Document set deleted"
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
