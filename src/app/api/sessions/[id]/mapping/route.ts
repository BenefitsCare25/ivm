import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { proposeFieldMappings } from "@/lib/ai/mapping";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError, AppError } from "@/lib/errors";
import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        extractionResults: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
        targetAssets: {
          orderBy: { inspectedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const extraction = fillSession.extractionResults[0];
    if (!extraction) {
      throw new ValidationError("No completed extraction found. Run extraction first.");
    }

    const extractedFields = extraction.fields as unknown as ExtractedField[];
    if (!extractedFields || extractedFields.length === 0) {
      throw new ValidationError("Extraction has no fields to map.");
    }

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) {
      throw new ValidationError("No target selected. Set a target first.");
    }

    const targetFields = targetAsset.detectedFields as unknown as TargetField[];
    if (!targetFields || targetFields.length === 0) {
      throw new ValidationError("Target has no detected fields to map to.");
    }

    const { provider, apiKey } = await resolveProviderAndKey(session.user.id);

    try {
      const result = await proposeFieldMappings({
        extractedFields,
        targetFields,
        provider,
        apiKey,
      });

      const [mappingSet] = await Promise.all([
        db.mappingSet.create({
          data: {
            fillSessionId: id,
            extractionResultId: extraction.id,
            targetAssetId: targetAsset.id,
            mappings: JSON.parse(JSON.stringify(result.mappings)),
            status: "PROPOSED",
            proposedAt: new Date(),
          },
        }),
        db.fillSession.updateMany({
          where: { id, userId: session.user.id },
          data: { status: "MAPPED", currentStep: "MAP" },
        }),
        db.auditEvent.create({
          data: {
            fillSessionId: id,
            eventType: "MAPPING_PROPOSED",
            actor: "SYSTEM",
            payload: {
              provider,
              mappingCount: result.mappings.length,
              mappedCount: result.mappings.filter(
                (m: { sourceFieldId: string | null }) => m.sourceFieldId !== null
              ).length,
            },
          },
        }),
      ]);

      logger.info(
        {
          sessionId: id,
          mappingSetId: mappingSet.id,
          provider,
          mappingCount: result.mappings.length,
        },
        "Mapping proposed"
      );

      return NextResponse.json({
        id: mappingSet.id,
        status: mappingSet.status,
        mappings: result.mappings,
        proposedAt: mappingSet.proposedAt.toISOString(),
        reviewedAt: null,
      });
    } catch (aiErr) {
      const errorMessage = aiErr instanceof Error ? aiErr.message : "Unknown mapping error";

      await db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "MAPPING_FAILED",
          actor: "SYSTEM",
          payload: { provider, error: errorMessage },
        },
      });

      logger.error(
        { err: aiErr, sessionId: id, provider },
        "Mapping failed"
      );

      if (aiErr instanceof AppError) throw aiErr;
      throw new AppError(`Mapping failed: ${errorMessage}`, 500, "MAPPING_FAILED");
    }
  } catch (err) {
    return errorResponse(err);
  }
}

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
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = await db.mappingSet.findFirst({
      where: { fillSessionId: id },
      orderBy: { proposedAt: "desc" },
    });

    if (!mappingSet) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      id: mappingSet.id,
      status: mappingSet.status,
      mappings: mappingSet.mappings,
      proposedAt: mappingSet.proposedAt.toISOString(),
      reviewedAt: mappingSet.reviewedAt ? mappingSet.reviewedAt.toISOString() : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
