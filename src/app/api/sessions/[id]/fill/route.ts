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
import {
  buildFillReport,
  toFillActionSummary,
} from "@/types/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary } from "@/types/fill";

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

    const now = new Date();
    await db.fillAction.createMany({
      data: result.results.map((r) => ({
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
      })),
    });

    const dbActions = await db.fillAction.findMany({
      where: { fillSessionId: id },
    });

    const updatePromises: Promise<unknown>[] = [
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "FILLED", currentStep: "FILL" },
      }),
    ];

    if (result.filledStoragePath) {
      updatePromises.push(
        db.targetAsset.update({
          where: { id: targetAsset.id },
          data: { filledStoragePath: result.filledStoragePath },
        })
      );
    }

    const actions: FillActionSummary[] = dbActions.map((fa, i) => ({
      id: fa.id,
      targetFieldId: fa.targetFieldId,
      targetLabel: result.results[i]?.targetLabel ?? fa.targetFieldId,
      intendedValue: fa.intendedValue,
      appliedValue: fa.appliedValue,
      verifiedValue: fa.verifiedValue,
      status: fa.status as FillActionSummary["status"],
      errorMessage: fa.errorMessage,
    }));

    const report = buildFillReport(actions);

    updatePromises.push(
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "FILL_EXECUTED",
          actor: session.user.id,
          payload: JSON.parse(
            JSON.stringify({ targetType: targetAsset.targetType, report })
          ),
        },
      })
    );

    await Promise.all(updatePromises);

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

    const actions = fillSession.fillActions.map((fa) =>
      toFillActionSummary(fa, targetFields, mappings)
    );

    return NextResponse.json({
      actions,
      report: buildFillReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
