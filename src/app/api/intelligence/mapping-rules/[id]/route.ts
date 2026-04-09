import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateCodeMappingRuleSchema } from "@/lib/validations/intelligence-phase2";
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
    const parsed = updateCodeMappingRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.sourceFieldLabel !== undefined) data.sourceFieldLabel = parsed.data.sourceFieldLabel;
    if (parsed.data.datasetId !== undefined) data.datasetId = parsed.data.datasetId;
    if (parsed.data.lookupColumn !== undefined) data.lookupColumn = parsed.data.lookupColumn;
    if (parsed.data.outputColumn !== undefined) data.outputColumn = parsed.data.outputColumn;
    if (parsed.data.matchStrategy !== undefined) data.matchStrategy = parsed.data.matchStrategy;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const updated = await db.codeMappingRule.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Code mapping rule");

    logger.info({ ruleId: id, userId: session.user.id }, "Code mapping rule updated");

    const rule = await db.codeMappingRule.findFirst({
      where: { id, userId: session.user.id },
      include: { dataset: { select: { id: true, name: true } } },
    });

    return NextResponse.json(rule);
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

    const deleted = await db.codeMappingRule.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Code mapping rule");

    logger.info({ ruleId: id, userId: session.user.id }, "Code mapping rule deleted");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
