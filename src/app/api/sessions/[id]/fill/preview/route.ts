import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { buildFillContext } from "@/lib/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";

export interface FillPreviewItem {
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  hasOverride: boolean;
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
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = fillSession.mappingSets[0];
    const targetAsset = fillSession.targetAssets[0];

    if (!mappingSet || !targetAsset) {
      return NextResponse.json({ items: [] });
    }

    const mappings = mappingSet.mappings as unknown as FieldMapping[];
    const targetFields = targetAsset.detectedFields as unknown as TargetField[];

    const ctx = buildFillContext({
      sessionId: id,
      mappingSetId: mappingSet.id,
      targetType: targetAsset.targetType as TargetType,
      targetFields,
      mappings,
      storagePath: targetAsset.storagePath,
      targetUrl: targetAsset.url,
      targetFileName: targetAsset.fileName,
    });

    const items: FillPreviewItem[] = ctx.approvedMappings.map((m) => {
      const targetField = targetFields.find((f) => f.id === m.targetFieldId);
      return {
        targetFieldId: m.targetFieldId,
        targetLabel: targetField?.label ?? m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        hasOverride: m.userOverrideValue !== null && m.userOverrideValue !== undefined,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
