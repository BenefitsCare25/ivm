import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { getCodexAccountStatus, listCodexModels } from "@/lib/ai/codex-app-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await getCodexAccountStatus();
  let selectedModelAvailable = false;
  if (account.connected) {
    try {
      const models = await listCodexModels();
      selectedModelAvailable = models.some((model) => model.id === env.CODEX_REVIEW_MODEL);
    } catch {
      // Account health is still useful when model discovery is temporarily unavailable.
    }
  }

  return NextResponse.json({
    configured: env.AI_PROVIDER === "codex",
    connected: account.connected,
    planType: account.planType,
    model: env.CODEX_REVIEW_MODEL,
    reasoningEffort: env.CODEX_REVIEW_EFFORT,
    selectedModelAvailable,
    sharedDeploymentConnection: true,
    message: env.AI_PROVIDER !== "codex"
      ? "ChatGPT is not the deployment default. The default may use a saved API connection."
      : !account.connected
        ? "ChatGPT connection lost. Default processing is blocked. An administrator must reconnect ChatGPT on the server; no API fallback will be used."
        : !selectedModelAvailable
          ? "The configured ChatGPT model is unavailable. Ask an administrator to update the server model."
          : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
