import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDocumentTypeSchema } from "@/lib/validations/intelligence";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const documentTypes = await db.documentType.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { documentSetItems: true } },
      },
    });

    return NextResponse.json(documentTypes);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createDocumentTypeSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Validation failed",
        parsed.error.flatten().fieldErrors
      );
    }

    const documentType = await db.documentType.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        aliases: JSON.parse(JSON.stringify(parsed.data.aliases)),
        category: parsed.data.category ?? null,
        requiredFields: JSON.parse(JSON.stringify(parsed.data.requiredFields)),
      },
    });

    logger.info(
      { documentTypeId: documentType.id, userId: session.user.id },
      "Document type created"
    );

    return NextResponse.json(documentType, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
