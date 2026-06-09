import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, ValidationError } from "@/lib/errors";
import { learnAliasSchema } from "@/lib/validations/document-type";
import { toInputJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Continuous-learning feedback loop.
 *
 * When a claims user corrects a misclassification ("the AI labelled this
 * 'Hospital Statement' but it IS our 'Summary Tax Invoice'"), the wrong label is
 * appended as an alias to the canonical document type. Future submissions with
 * the same label are then recognised automatically — no model retraining needed.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthApi();
    const body = await req.json();
    const parsed = learnAliasSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid feedback");
    }
    const { documentTypeName, alias } = parsed.data;

    const existing = await db.documentType.findFirst({
      where: { userId: session.user.id, name: documentTypeName },
    });

    // Don't store an alias identical to the canonical name.
    const aliasIsName = alias.toLowerCase() === documentTypeName.toLowerCase();

    if (existing) {
      const current = (existing.aliases as string[]) ?? [];
      const already = current.some((a) => a.toLowerCase() === alias.toLowerCase());
      if (already || aliasIsName) {
        return NextResponse.json({ documentType: existing, learned: false });
      }
      const updated = await db.documentType.update({
        where: { id: existing.id },
        data: { aliases: toInputJson([...current, alias]), isActive: true },
      });
      return NextResponse.json({ documentType: updated, learned: true });
    }

    const created = await db.documentType.create({
      data: {
        userId: session.user.id,
        name: documentTypeName,
        aliases: toInputJson(aliasIsName ? [] : [alias]),
        requiredFields: toInputJson([]),
        isActive: true,
      },
    });
    return NextResponse.json({ documentType: created, learned: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
