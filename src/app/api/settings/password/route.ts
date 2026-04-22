import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { authLimiter } from "@/lib/rate-limit";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await authLimiter(ip);
    if (!rl.allowed) return new Response("Too Many Requests", { status: 429 });

    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.flatten().fieldErrors);
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });

    if (!user?.passwordHash) {
      throw new ValidationError("Invalid input", {
        currentPassword: ["No password set on this account (OAuth account)"],
      });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new ValidationError("Invalid input", {
        currentPassword: ["Current password is incorrect"],
      });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({
      where: { id: session.user.id },
      data: { passwordHash: newHash },
    });

    logger.info({ userId: session.user.id }, "Password changed");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
