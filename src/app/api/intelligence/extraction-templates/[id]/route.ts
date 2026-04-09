import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateExtractionTemplateSchema } from "@/lib/validations/intelligence-phase4";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateExtractionTemplateSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.documentTypeId !== undefined) data.documentTypeId = parsed.data.documentTypeId;
    if (parsed.data.instructions !== undefined) data.instructions = parsed.data.instructions;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.expectedFields !== undefined) {
      data.expectedFields = JSON.parse(JSON.stringify(parsed.data.expectedFields));
    }

    const updated = await db.extractionTemplate.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Extraction template");

    logger.info({ templateId: id, userId: session.user.id }, "Extraction template updated");

    const template = await db.extractionTemplate.findFirst({
      where: { id, userId: session.user.id },
      include: { documentType: { select: { id: true, name: true } } },
    });

    return NextResponse.json(template);
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

    const deleted = await db.extractionTemplate.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Extraction template");

    logger.info({ templateId: id, userId: session.user.id }, "Extraction template deleted");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
