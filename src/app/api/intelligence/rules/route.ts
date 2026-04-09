import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createBusinessRuleSchema } from "@/lib/validations/intelligence-phase3";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const rules = await db.businessRule.findMany({
      where: { userId: session.user.id },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(rules);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createBusinessRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const rule = await db.businessRule.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        priority: parsed.data.priority,
        triggerPoint: parsed.data.triggerPoint,
        conditions: JSON.parse(JSON.stringify(parsed.data.conditions)),
        actions: JSON.parse(JSON.stringify(parsed.data.actions)),
        isActive: parsed.data.isActive,
        scope: JSON.parse(JSON.stringify(parsed.data.scope ?? {})),
      },
    });

    logger.info({ ruleId: rule.id, userId: session.user.id }, "Business rule created");

    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
