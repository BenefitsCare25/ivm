import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Optional bearer token guard — prevents exposing DB/Redis health to the public
  const expectedToken = env.HEALTH_CHECK_TOKEN;
  if (expectedToken) {
    const auth = req.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (provided !== expectedToken) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const start = Date.now();
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch {
    checks.database = { status: "unhealthy", error: "Connection failed" };
  }

  const redis = getRedisClient();
  if (redis) {
    const redisStart = Date.now();
    try {
      await redis.ping();
      checks.redis = { status: "healthy", latencyMs: Date.now() - redisStart };
    } catch {
      checks.redis = { status: "unhealthy", error: "Connection failed" };
    }
  } else {
    checks.redis = { status: "not_configured" };
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status === "healthy" || c.status === "not_configured"
  );

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
