import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { errorResponse, ValidationError } from "@/lib/errors";
import { authLimiter } from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await authLimiter(ip);
    if (!rl.allowed) return new Response("Too Many Requests", { status: 429 });

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.flatten().fieldErrors);
    }

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await db.user.create({
        data: { name, email, passwordHash },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 409 }
        );
      }
      throw err;
    }

    logger.info({ email }, "User registered");
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
