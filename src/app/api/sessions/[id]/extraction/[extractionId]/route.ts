import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { updateExtractionFieldsSchema } from "@/lib/validations/extraction";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; extractionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, extractionId } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const body = await req.json();
    const parsed = updateExtractionFieldsSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const existing = await db.extractionResult.findFirst({
      where: { id: extractionId, fillSessionId: id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Extraction result", extractionId);

    const [updated] = await Promise.all([
      db.extractionResult.update({
        where: { id: extractionId },
        data: { fields: parsed.data.fields },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "EXTRACTION_FIELDS_EDITED",
          actor: "USER",
          payload: {
            extractionId,
            fieldCount: parsed.data.fields.length,
          },
        },
      }),
    ]);

    logger.info(
      { sessionId: id, extractionId, fieldCount: parsed.data.fields.length },
      "Extraction fields updated"
    );

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
