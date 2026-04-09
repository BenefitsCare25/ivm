import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateNormalizationRuleSchema } from "@/lib/validations/intelligence-phase4";
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
    const parsed = updateNormalizationRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.fieldType !== undefined) data.fieldType = parsed.data.fieldType;
    if (parsed.data.pattern !== undefined) data.pattern = parsed.data.pattern;
    if (parsed.data.outputFormat !== undefined) data.outputFormat = parsed.data.outputFormat;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const updated = await db.normalizationRule.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Normalization rule");

    logger.info({ normRuleId: id, userId: session.user.id }, "Normalization rule updated");

    const rule = await db.normalizationRule.findFirst({
      where: { id, userId: session.user.id },
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

    const deleted = await db.normalizationRule.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Normalization rule");

    logger.info({ normRuleId: id, userId: session.user.id }, "Normalization rule deleted");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
