import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { executeFillSchema } from "@/lib/validations/fill";
import { buildFillContext, executeFill } from "@/lib/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary, FillReport } from "@/types/fill";

function buildReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = executeFillSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid fill request", {
        fill: parsed.error.issues.map((e) => e.message),
      });
    }

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = fillSession.mappingSets[0];
    if (!mappingSet) {
      throw new ValidationError("No accepted mapping set. Accept mappings first.");
    }

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) {
      throw new ValidationError("No target asset found.");
    }

    const mappings = mappingSet.mappings as unknown as FieldMapping[];
    const targetFields = targetAsset.detectedFields as unknown as TargetField[];

    // Delete existing fill actions (re-fill support)
    await db.fillAction.deleteMany({ where: { fillSessionId: id } });

    const ctx = buildFillContext({
      sessionId: id,
      mappingSetId: mappingSet.id,
      targetType: targetAsset.targetType as TargetType,
      targetFields,
      mappings,
      storagePath: targetAsset.storagePath,
      targetUrl: targetAsset.url,
      targetFileName: targetAsset.fileName,
      skipFieldIds: parsed.data.skipFieldIds,
    });

    if (ctx.approvedMappings.length === 0) {
      throw new ValidationError(
        "No approved mappings to fill. Approve at least one mapping."
      );
    }

    const result = await executeFill(ctx);

    // Create FillAction records
    const now = new Date();
    const fillActions = await Promise.all(
      result.results.map((r) =>
        db.fillAction.create({
          data: {
            fillSessionId: id,
            mappingSetId: mappingSet.id,
            targetFieldId: r.targetFieldId,
            intendedValue: r.intendedValue,
            appliedValue: r.appliedValue,
            verifiedValue: r.verifiedValue,
            status: r.status,
            errorMessage: r.errorMessage,
            appliedAt:
              r.status !== "FAILED" && r.status !== "SKIPPED" ? now : null,
            verifiedAt: r.status === "VERIFIED" ? now : null,
          },
        })
      )
    );

    // Update target asset with filled storage path
    if (result.filledStoragePath) {
      await db.targetAsset.update({
        where: { id: targetAsset.id },
        data: { filledStoragePath: result.filledStoragePath },
      });
    }

    // Update session status
    await db.fillSession.updateMany({
      where: { id, userId: session.user.id },
      data: { status: "FILLED", currentStep: "FILL" },
    });

    const actions: FillActionSummary[] = fillActions.map((fa, i) => ({
      id: fa.id,
      targetFieldId: fa.targetFieldId,
      targetLabel: result.results[i].targetLabel,
      intendedValue: fa.intendedValue,
      appliedValue: fa.appliedValue,
      verifiedValue: fa.verifiedValue,
      status: fa.status as FillActionSummary["status"],
      errorMessage: fa.errorMessage,
    }));

    const report = buildReport(actions);

    await db.auditEvent.create({
      data: {
        fillSessionId: id,
        eventType: "FILL_EXECUTED",
        actor: session.user.id,
        payload: JSON.parse(
          JSON.stringify({ targetType: targetAsset.targetType, report })
        ),
      },
    });

    logger.info(
      { sessionId: id, targetType: targetAsset.targetType, report },
      "Fill executed"
    );

    return NextResponse.json({
      actions,
      report,
      hasFilledDocument: result.filledStoragePath !== null,
      webpageFillScript: result.webpageFillScript,
    });
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
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
        fillActions: true,
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    if (fillSession.fillActions.length === 0) {
      return NextResponse.json(null);
    }

    const targetAsset = fillSession.targetAssets[0];
    const mappingSet = fillSession.mappingSets[0];
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];

    const actions: FillActionSummary[] = fillSession.fillActions.map((fa) => {
      const targetField = targetFields.find((f) => f.id === fa.targetFieldId);
      const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
      return {
        id: fa.id,
        targetFieldId: fa.targetFieldId,
        targetLabel:
          targetField?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
        intendedValue: fa.intendedValue,
        appliedValue: fa.appliedValue,
        verifiedValue: fa.verifiedValue,
        status: fa.status as FillActionSummary["status"],
        errorMessage: fa.errorMessage,
      };
    });

    const report = buildReport(actions);

    return NextResponse.json({
      actions,
      report,
      hasFilledDocument:
        targetAsset?.filledStoragePath !== null &&
        targetAsset?.filledStoragePath !== undefined,
      webpageFillScript: null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
