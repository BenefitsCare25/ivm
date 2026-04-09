import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { upsertEscalationConfigSchema } from "@/lib/validations/intelligence-phase4";
import { logger } from "@/lib/logger";
import { errorResponse, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireAuthApi();

    const config = await db.escalationConfig.findUnique({
      where: { userId: session.user.id },
    });

    return NextResponse.json(config ?? null);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAuthApi();

    const body = await req.json();
    const parsed = upsertEscalationConfigSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const config = await db.escalationConfig.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        confidenceThreshold: parsed.data.confidenceThreshold,
        autoFlagLowConfidence: parsed.data.autoFlagLowConfidence,
        escalationMessage: parsed.data.escalationMessage,
      },
      update: {
        confidenceThreshold: parsed.data.confidenceThreshold,
        autoFlagLowConfidence: parsed.data.autoFlagLowConfidence,
        escalationMessage: parsed.data.escalationMessage,
      },
    });

    logger.info({ userId: session.user.id }, "Escalation config saved");

    return NextResponse.json(config);
  } catch (err) {
    return errorResponse(err);
  }
}
