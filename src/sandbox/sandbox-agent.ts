/**
 * Sandbox Agent — 沙箱容器内运行的 RPC 代理服务
 *
 * 接收来自主网关的 HTTP RPC 请求，在容器内调用真实的 pi agent。
 * 不依赖 @dyyz1993/pi-coding-agent 的 RpcClient，
 * 直接 spawn node + pi CLI 并通过 JSONL 通信。
 */

import { createServer } from "http";
import { spawn, type ChildProcess } from "child_process";

const log = {
  info: (...args: unknown[]) => process.stdout.write(`[sandbox-agent] ${JSON.stringify(args)}\n`),
  error: (...args: unknown[]) =>
    process.stderr.write(`[sandbox-agent] ERROR ${JSON.stringify(args)}\n`),
};

const PORT = parseInt(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3101");
const CLI_PATH =
  process.argv.find((a) => a.startsWith("--cli-path="))?.split("=")[1] ?? "/usr/bin/pi";
const CWD = process.argv.find((a) => a.startsWith("--cwd="))?.split("=")[1] ?? process.cwd();

log.info(`starting on port ${PORT}, cli=${CLI_PATH}, cwd=${CWD}`);

// ─── 直接 spawn pi agent 进程 ───────────────────────────

let piProcess: ChildProcess | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
let requestId = 0;

function startPi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["--mode", "rpc"];
    const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };

    piProcess = spawn("/usr/bin/node", [CLI_PATH, ...args], {
      cwd: CWD,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    piProcess.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          handleMessage(msg);
        } catch {
          /* skip malformed */
        }
      }
    });

    piProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    piProcess.on("error", reject);
    piProcess.on("exit", (code) => {
      log.info(`pi agent exited with code ${code}`);
      piProcess = null;
    });

    // 等待 ready 事件
    const timeout = setTimeout(() => reject(new Error("pi agent start timeout")), 30000);
    const origResolve = resolve;
    pendingRequests.set("__ready__", {
      resolve: () => {
        clearTimeout(timeout);
        origResolve();
      },
      reject,
    });
  });
}

function handleMessage(msg: Record<string, unknown>): void {
  const { id, type, method, result, error, params } = msg;

  // ready 通知
  if (type === "ready" || (method === "start" && type === "result")) {
    const pending = pendingRequests.get("__ready__");
    if (pending) {
      pending.resolve(null);
      pendingRequests.delete("__ready__");
    }
    return;
  }

  // RPC 结果
  if (id && pendingRequests.has(String(id))) {
    const pending = pendingRequests.get(String(id));
    if (!pending) return;
    if (error) pending.reject(new Error(String(error)));
    else pending.resolve(result ?? params);
    pendingRequests.delete(String(id));
  }
}

function callPi(method: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = String(++requestId);
    const msg = JSON.stringify({ id, method, params }) + "\n";
    pendingRequests.set(id, { resolve, reject });
    piProcess?.stdin?.write(msg);
    // Timeout
    setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (pending) {
        pending.reject(new Error(`RPC timeout: ${method}`));
        pendingRequests.delete(id);
      }
    }, 60000);
  });
}

// ─── HTTP 服务 ──────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", pid: process.pid, piAlive: piProcess !== null }));
    return;
  }

  if (url.pathname === "/rpc" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      method: string;
      params?: unknown[];
    };
    const { method, params } = body;

    try {
      const result = await callPi(method, params ?? []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    }
    return;
  }

  res.writeHead(404).end();
});

// ─── 启动 ────────────────────────────────────────────────

async function main() {
  log.info("starting pi agent...");
  await startPi();
  log.info("pi agent ready");

  server.listen(PORT, "0.0.0.0", () => {
    log.info(`listening on 0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  log.error("failed to start:", err);
  process.exit(1);
});
