import { NextResponse } from "next/server";
import { getMetricsRegistry } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  const auth = req.headers.get("authorization");
  if (!token || auth !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const registry = getMetricsRegistry();
  const metrics = await registry.metrics();

  return new Response(metrics, {
    headers: { "Content-Type": registry.contentType },
  });
}
