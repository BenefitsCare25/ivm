import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/auth-helpers";
import { errorResponse, ValidationError } from "@/lib/errors";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function GET() {
  try {
    await requireSuperAdminApi();

    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdminApi();

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.flatten().fieldErrors);
    }

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const user = await db.user.create({
        data: { name, email, passwordHash, role: "ADMIN" },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      return NextResponse.json({ user }, { status: 201 });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireSuperAdminApi();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    // Prevent Super Admin from deleting themselves
    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    await db.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
