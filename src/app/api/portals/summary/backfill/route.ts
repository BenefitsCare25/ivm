import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { backfillPortalMetrics } from "@/lib/portal-metrics";

// Safe to call multiple times — upsert semantics. Run once after first deploy.
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const result = await backfillPortalMetrics(session.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
