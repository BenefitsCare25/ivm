import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDocumentSetSchema } from "@/lib/validations/intelligence";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

const ITEMS_INCLUDE = {
  items: {
    include: {
      documentType: { select: { id: true, name: true } },
    },
  },
} as const;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const documentSets = await db.documentSet.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: ITEMS_INCLUDE,
    });

    return NextResponse.json(documentSets);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createDocumentSetSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Validation failed",
        parsed.error.flatten().fieldErrors
      );
    }

    const documentSet = await db.documentSet.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        items: {
          create: parsed.data.items.map((item) => ({
            documentTypeId: item.documentTypeId,
            isRequired: item.isRequired,
            minCount: item.minCount,
            maxCount: item.maxCount ?? null,
          })),
        },
      },
      include: ITEMS_INCLUDE,
    });

    logger.info(
      { documentSetId: documentSet.id, userId: session.user.id },
      "Document set created"
    );

    return NextResponse.json(documentSet, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
