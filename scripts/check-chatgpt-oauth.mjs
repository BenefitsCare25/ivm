import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const command = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const childEnv = { ...process.env };
if (process.env.IVM_CODEX_HOME) childEnv.CODEX_HOME = process.env.IVM_CODEX_HOME;

const child = spawn(command, ["app-server", "--stdio"], {
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: process.platform === "win32",
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;

child.stderr.on("data", (chunk) => {
  const message = chunk.toString("utf8").trim();
  if (message) console.error(message.slice(0, 1000));
});
child.on("error", (error) => console.error(`Could not start Codex App Server: ${error.message}`));

lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message || "Codex RPC error"));
  else request.resolve(message.result);
});

function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  await request("initialize", {
    clientInfo: { name: "ivm-connection-check", title: "IVM ChatGPT Connection Check", version: "1.0.0" },
    capabilities: null,
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
  const account = await request("account/read", { refreshToken: true });
  const models = account.account?.type === "chatgpt"
    ? (await request("model/list", { limit: 100, includeHidden: false })).data || []
    : [];
  const selectedModel = process.env.CODEX_REVIEW_MODEL || "gpt-5.6-terra";
  const result = {
    connected: account.account?.type === "chatgpt",
    planType: account.account?.planType,
    selectedModel,
    selectedModelAvailable: models.some((model) => model.id === selectedModel),
    availableModelCount: models.length,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.connected && result.selectedModelAvailable ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  child.kill();
}
