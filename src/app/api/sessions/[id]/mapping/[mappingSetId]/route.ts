import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { reviewMappingSchema } from "@/lib/validations/mapping";
import type { FieldMapping } from "@/types/mapping";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; mappingSetId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, mappingSetId } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = await db.mappingSet.findFirst({
      where: { id: mappingSetId, fillSessionId: id },
    });
    if (!mappingSet) throw new NotFoundError("MappingSet", mappingSetId);

    const body = await req.json();
    const parsed = reviewMappingSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid review data", {
        mappings: parsed.error.issues.map((e) => e.message),
      });
    }

    const existingMappings = mappingSet.mappings as unknown as FieldMapping[];
    const reviewMap = new Map(parsed.data.mappings.map((m) => [m.id, m]));

    const updatedMappings: FieldMapping[] = existingMappings.map((mapping) => {
      const review = reviewMap.get(mapping.id);
      if (!review) return mapping;
      return {
        ...mapping,
        userApproved: review.userApproved,
        ...(review.userOverrideValue !== undefined && {
          userOverrideValue: review.userOverrideValue,
        }),
      };
    });

    const approvedCount = updatedMappings.filter((m) => m.userApproved).length;
    const overrideCount = updatedMappings.filter(
      (m) => m.userOverrideValue !== undefined
    ).length;

    const [updated] = await Promise.all([
      db.mappingSet.update({
        where: { id: mappingSetId },
        data: {
          mappings: JSON.parse(JSON.stringify(updatedMappings)),
          status: "ACCEPTED",
          reviewedAt: new Date(),
        },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "MAPPING_ACCEPTED",
          actor: session.user.id,
          payload: JSON.parse(
            JSON.stringify({ mappingSetId, approvedCount, overrideCount })
          ),
        },
      }),
    ]);

    logger.info(
      { sessionId: id, mappingSetId, approvedCount, overrideCount },
      "Mapping set accepted"
    );

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      mappings: updatedMappings,
      proposedAt: updated.proposedAt.toISOString(),
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
