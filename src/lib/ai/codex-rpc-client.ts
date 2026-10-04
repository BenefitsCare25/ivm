import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { readFile, readdir } from "node:fs/promises";
import { AppError } from "@/lib/errors";

type Json = Record<string, unknown>;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Turn = Pending & { text: string; turnId?: string };
export interface CodexResources { pid: number; rssBytes: number; descriptors: number }
export interface CodexRpcOptions {
  command: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  shutdownGraceMs?: number;
  maxRssBytes?: number;
  onResources?: (resources: CodexResources) => void;
  onDiagnostic?: (event: string, data: Json) => void;
}

export function isCodexInfrastructureError(error: unknown): error is AppError {
  return error instanceof AppError && /^CODEX_(TIMEOUT|TURN_TIMEOUT|UNAVAILABLE|EXITED|RESOURCE_LIMIT|NOT_CONNECTED|RECOVERING|MODEL_UNAVAILABLE|RPC_ERROR)$/.test(error.code);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One owner, one process group, and a terminal close: a failed client is never reused. */
export class CodexRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private startup: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private closed = false;
  private failure: Error | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, Turn>();
  private monitor?: ReturnType<typeof setInterval>;
  private monitoring = false;
  private diagnosticSignatures = new Set<string>();
  private readonly onParentExit = () => {
    if (process.platform !== "win32" && this.child?.pid) {
      try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  };

  constructor(private readonly options: CodexRpcOptions) {}

  get error(): Error | null { return this.failure; }
  get pid(): number | undefined { return this.child?.pid; }

  async request<T>(method: string, params: Json = {}, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<T> {
    await this.start();
    return this.send<T>(method, params, timeoutMs);
  }

  private start(): Promise<void> {
    if (this.closed) return Promise.reject(this.failure ?? new AppError("ChatGPT process is closed", 503, "CODEX_UNAVAILABLE"));
    if (this.startup) return this.startup;
    this.startup = (async () => {
      const child = spawn(this.options.command, this.options.args, {
        env: this.options.environment ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(this.options.command),
      });
      this.child = child;
      process.once("exit", this.onParentExit);
      this.lines = createInterface({ input: child.stdout });
      this.lines.on("line", (line) => this.handleLine(line));
      // Never retain raw stderr: it can contain prompts, account details, or tokens.
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").toLowerCase();
        for (const signature of ["refresh_token_reused", "invalid_grant", "401", "403", "429", "timed out", "out of memory", "panicked"] ) {
          if (text.includes(signature) && !this.diagnosticSignatures.has(signature)) {
            this.diagnosticSignatures.add(signature);
            this.options.onDiagnostic?.("stderr-signature", { pid: child.pid, signature });
          }
        }
      });
      child.stdin.on("error", () => this.fail(new AppError("ChatGPT transport closed", 503, "CODEX_UNAVAILABLE")));
      child.once("error", () => this.fail(new AppError("Unable to start ChatGPT process", 503, "CODEX_UNAVAILABLE")));
      child.once("exit", (code, signal) => {
        if (!this.closed) this.fail(new AppError(`ChatGPT process exited (${signal ?? code ?? "unknown"})`, 503, "CODEX_EXITED"));
      });
      if (process.platform === "linux") {
        this.monitor = setInterval(() => void this.sampleResources(), 5_000);
        this.monitor.unref();
      }
      await this.send("initialize", {
        clientInfo: { name: "ivm", title: "IVM AI Review", version: "1.1.0" },
        capabilities: { experimentalApi: true },
      }, this.options.requestTimeoutMs ?? 30_000);
      this.write({ method: "initialized" });
      this.options.onDiagnostic?.("started", { pid: child.pid });
    })();
    return this.startup;
  }

  private send<T>(method: string, params: Json, timeoutMs: number): Promise<T> {
    if (this.closed) return Promise.reject(this.failure ?? new AppError("ChatGPT process is closed", 503, "CODEX_UNAVAILABLE"));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.options.onDiagnostic?.("request-timeout", { method, pid: this.child?.pid });
        this.fail(new AppError(`ChatGPT request timed out: ${method}`, 504, "CODEX_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { this.fail(error instanceof Error ? error : new Error("ChatGPT write failed")); }
    });
  }

  private write(message: Json): void {
    if (!this.child?.stdin.writable) throw new AppError("ChatGPT transport unavailable", 503, "CODEX_UNAVAILABLE");
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  async runTurn(threadId: string, params: Json): Promise<{ text: string; threadId: string; turnId: string }> {
    const completion = new Promise<{ text: string; threadId: string; turnId: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new AppError("ChatGPT processing timed out", 504, "CODEX_TURN_TIMEOUT");
        void this.interruptAndClose(error);
      }, this.options.turnTimeoutMs ?? 300_000);
      this.turns.set(threadId, { text: "", resolve: (value) => resolve(value as { text: string; threadId: string; turnId: string }), reject, timer });
    });
    // Attach a rejection handler immediately: a crash may precede turn/start's reply.
    void completion.catch(() => undefined);
    try {
      const response = await this.request<{ turn: { id: string } }>("turn/start", { ...params, threadId });
      const turn = this.turns.get(threadId);
      if (turn) turn.turnId = response.turn.id;
      return await completion;
    } catch (error) {
      await this.close(error instanceof Error ? error : new Error("ChatGPT turn failed"));
      throw error;
    }
  }

  async interruptAndClose(error: Error): Promise<void> {
    if (this.closed) return this.close(error);
    // Cancellation is best effort. Process-group termination remains the hard boundary.
    for (const [threadId, turn] of this.turns) {
      if (!turn.turnId) continue;
      try { this.write({ id: ++this.nextId, method: "turn/interrupt", params: { threadId, turnId: turn.turnId } }); } catch { /* close below */ }
    }
    await this.close(error);
  }

  private handleLine(line: string): void {
    if (this.closed) return;
    let message: Json;
    try { message = JSON.parse(line) as Json; } catch { return; }
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error) {
        // Provider text may contain request content; report a stable error to the app.
        const needsLogin = /refresh_token_(reused|expired|invalidated)|invalid_grant|please (log|sign) in|not authenticated/i.test(String((message.error as Json).message ?? ""));
        request.reject(new AppError(needsLogin ? "ChatGPT login requires reconnection" : "ChatGPT rejected the request; check worker diagnostics", 502, needsLogin ? "CODEX_NOT_CONNECTED" : "CODEX_RPC_ERROR"));
        this.options.onDiagnostic?.("rpc-error", { pid: this.child?.pid, rpcCode: (message.error as Json).code });
      } else request.resolve(message.result);
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      try { this.write({ id: message.id, error: { code: -32000, message: "IVM does not permit interactive tools or approvals" } }); } catch { /* transport failure handled separately */ }
      return;
    }
    const params = (message.params ?? {}) as Json;
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const collector = this.turns.get(threadId);
    if (!collector) return;
    if (message.method === "turn/started") collector.turnId = (params.turn as { id?: string })?.id;
    if (message.method === "item/completed") {
      const item = params.item as { type?: string; text?: string };
      if (item?.type === "agentMessage" && item.text) collector.text = item.text;
    }
    if (message.method === "turn/completed") {
      clearTimeout(collector.timer);
      this.turns.delete(threadId);
      const turn = params.turn as { id?: string; status?: string };
      if (turn?.status !== "completed") collector.reject(new AppError("ChatGPT turn did not complete", 502, "CODEX_RPC_ERROR"));
      else if (!collector.text.trim()) collector.reject(new AppError("ChatGPT returned no text response", 502, "AI_EMPTY_RESPONSE"));
      else collector.resolve({ text: collector.text, threadId, turnId: turn.id ?? "" });
    }
  }

  private fail(error: Error): void { void this.close(error); }

  close(error?: Error): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.failure ??= error ?? null;
    if (this.monitor) clearInterval(this.monitor);
    const reason = this.failure ?? new AppError("ChatGPT process closed", 503, "CODEX_UNAVAILABLE");
    for (const request of [...this.pending.values(), ...this.turns.values()]) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    this.pending.clear();
    this.turns.clear();
    this.stopping = this.stopProcessTree();
    return this.stopping;
  }

  private async stopProcessTree(): Promise<void> {
    const child = this.child;
    const pid = child?.pid;
    if (!child || !pid) return;
    const grace = this.options.shutdownGraceMs ?? 1_000;
    if (process.platform === "win32") {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.once("exit", () => resolve());
          killer.once("error", () => { child.kill(); resolve(); });
        });
      }
    } else {
      const signalGroup = (signal: NodeJS.Signals): boolean => {
        try { process.kill(-pid, signal); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
      };
      signalGroup("SIGTERM");
      // Allow the wrapper to reap its native child. Always SIGKILL the group at
      // the deadline, even if the wrapper exits first and leaves a descendant.
      const deadline = Date.now() + grace;
      while (Date.now() < deadline) {
        try { process.kill(-pid, 0); } catch { break; }
        await sleep(25);
      }
      signalGroup("SIGKILL");
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    this.lines?.close();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    process.removeListener("exit", this.onParentExit);
    this.options.onDiagnostic?.("stopped", { pid });
  }

  private async sampleResources(): Promise<void> {
    if (this.monitoring || this.closed || !this.child?.pid) return;
    this.monitoring = true;
    try {
      let rssBytes = 0, descriptors = 0;
      const pending = [this.child.pid];
      const visited = new Set<number>();
      while (pending.length) {
        const pid = pending.pop()!;
        if (visited.has(pid)) continue;
        visited.add(pid);
        try {
          const status = await readFile(`/proc/${pid}/status`, "utf8");
          rssBytes += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
          descriptors += (await readdir(`/proc/${pid}/fd`)).length;
          const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
          pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
        } catch { /* process exited while sampling */ }
      }
      this.options.onResources?.({ pid: this.child.pid, rssBytes, descriptors });
      if (this.options.maxRssBytes && rssBytes > this.options.maxRssBytes) {
        this.fail(new AppError("ChatGPT worker exceeded its memory budget", 503, "CODEX_RESOURCE_LIMIT"));
      }
    } finally { this.monitoring = false; }
  }
}
