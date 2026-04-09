import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createExtractionTemplateSchema } from "@/lib/validations/intelligence-phase4";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const templates = await db.extractionTemplate.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        documentType: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(templates);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createExtractionTemplateSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const template = await db.extractionTemplate.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        documentTypeId: parsed.data.documentTypeId ?? null,
        expectedFields: JSON.parse(JSON.stringify(parsed.data.expectedFields)),
        instructions: parsed.data.instructions ?? null,
        isActive: parsed.data.isActive,
      },
      include: {
        documentType: { select: { id: true, name: true } },
      },
    });

    logger.info({ templateId: template.id, userId: session.user.id }, "Extraction template created");

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
