import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { errorResponse, ValidationError } from "@/lib/errors";
import { discoverFields } from "@/lib/portal-discovery";
import { z } from "zod";

const discoverSchema = z.object({
  groupingFields: z.array(z.string().min(1)).min(1).max(5),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id } = await params;

    const body = await req.json();
    const parsed = discoverSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.message);

    const results = await discoverFields({
      portalId: id,
      userId: session.user.id,
      groupingFields: parsed.data.groupingFields,
    });

    return NextResponse.json({ discoveredClaimTypes: results });
  } catch (error) {
    return errorResponse(error);
  }
}
