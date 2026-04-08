import { NextResponse } from "next/server";
import { getMetricsRegistry } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Restrict to internal/monitoring access via a secret token
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const registry = getMetricsRegistry();
  const metrics = await registry.metrics();

  return new Response(metrics, {
    headers: { "Content-Type": registry.contentType },
  });
}
