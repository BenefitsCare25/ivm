import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { errorResponse, UnauthorizedError, AppError } from "@/lib/errors";
import { generateExtensionToken } from "@/lib/extension-token";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new AppError("Server configuration error", 500, "CONFIG_ERROR");

    const token = generateExtensionToken(session.user.id, secret);
    return NextResponse.json({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
