import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { createNormalizationRuleSchema } from "@/lib/validations/intelligence-phase4";
import { logger } from "@/lib/logger";
import { errorResponse, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireAuthApi();

    const rules = await db.normalizationRule.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(rules);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAuthApi();

    const body = await req.json();
    const parsed = createNormalizationRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const rule = await db.normalizationRule.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        fieldType: parsed.data.fieldType,
        pattern: parsed.data.pattern ?? null,
        outputFormat: parsed.data.outputFormat,
        isActive: parsed.data.isActive,
      },
    });

    logger.info({ normRuleId: rule.id, userId: session.user.id }, "Normalization rule created");

    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
