import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { createCodeMappingRuleSchema } from "@/lib/validations/intelligence-phase2";
import { logger } from "@/lib/logger";
import { errorResponse, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireAuthApi();

    const rules = await db.codeMappingRule.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        dataset: { select: { id: true, name: true } },
      },
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
    const parsed = createCodeMappingRuleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const rule = await db.codeMappingRule.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        sourceFieldLabel: parsed.data.sourceFieldLabel,
        datasetId: parsed.data.datasetId,
        lookupColumn: parsed.data.lookupColumn,
        outputColumn: parsed.data.outputColumn,
        matchStrategy: parsed.data.matchStrategy,
        isActive: parsed.data.isActive,
      },
      include: {
        dataset: { select: { id: true, name: true } },
      },
    });

    logger.info({ ruleId: rule.id, userId: session.user.id }, "Code mapping rule created");

    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
