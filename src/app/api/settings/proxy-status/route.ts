import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

async function checkProxy(url: string): Promise<{ healthy: boolean }> {
  try {
    const root = url.replace(/\/v1\/?$/, "");
    const res = await fetch(`${root}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { healthy: false };
    const data = await res.json() as { status?: string; claudeBinaryOk?: boolean };
    return { healthy: data?.status === "ok" && data?.claudeBinaryOk === true };
  } catch {
    return { healthy: false };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const proxyUrl = env.CLAUDE_PROXY_URL;
  const proxyToken = env.CLAUDE_PROXY_TOKEN;

  if (!proxyUrl || !proxyToken) {
    return NextResponse.json({ configured: false, healthy: false });
  }

  const { healthy } = await checkProxy(proxyUrl);

  return NextResponse.json({
    configured: true,
    healthy,
    model: "claude-sonnet-4-6",
  });
}
