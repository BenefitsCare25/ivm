import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateScheduleSchema } from "@/lib/validations/portal";
import { addPortalSchedule, removePortalSchedule } from "@/lib/queue/portal-scheduler";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const { enabled, cron } = parsed.data;

    await db.portal.updateMany({
      where: { id, userId: session.user.id },
      data: {
        scheduleEnabled: enabled,
        ...(cron !== undefined ? { scheduleCron: cron } : {}),
      },
    });

    if (enabled && cron) {
      await addPortalSchedule(id, session.user.id, cron);
    } else {
      await removePortalSchedule(id);
    }

    return NextResponse.json({ success: true, enabled, cron: cron ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
