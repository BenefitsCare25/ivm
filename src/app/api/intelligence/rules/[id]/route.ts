import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { updateBusinessRuleSchema } from "@/lib/validations/intelligence-phase3";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;

    const rule = await db.businessRule.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!rule) throw new NotFoundError("Business rule");

    return NextResponse.json(rule);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateBusinessRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
    if (parsed.data.triggerPoint !== undefined) data.triggerPoint = parsed.data.triggerPoint;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.conditions !== undefined) {
      data.conditions = JSON.parse(JSON.stringify(parsed.data.conditions));
    }
    if (parsed.data.actions !== undefined) {
      data.actions = JSON.parse(JSON.stringify(parsed.data.actions));
    }
    if (parsed.data.scope !== undefined) {
      data.scope = JSON.parse(JSON.stringify(parsed.data.scope ?? {}));
    }

    const updated = await db.businessRule.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Business rule");

    logger.info({ ruleId: id, userId: session.user.id }, "Business rule updated");

    const rule = await db.businessRule.findFirst({ where: { id, userId: session.user.id } });

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
    const session = await requireAuthApi();

    const { id } = await params;

    const deleted = await db.businessRule.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Business rule");

    logger.info({ ruleId: id, userId: session.user.id }, "Business rule deleted");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
