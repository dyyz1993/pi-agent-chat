/**
 * Sandbox Agent — RPC 代理服务
 *
 * 接收来自主网关的 HTTP RPC 请求，通过 JSONL 与 pi agent 通信。
 *
 * 两种模式：
 *   - 本地模式：直接 spawn pi CLI（默认）
 *   - SSH 模式：通过 SSH 连接到沙盒内的 pi CLI（--ssh-*）
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
const SSH_HOST = process.argv.find((a) => a.startsWith("--ssh-host="))?.split("=")[1] ?? "";
const SSH_PORT = process.argv.find((a) => a.startsWith("--ssh-port="))?.split("=")[1] ?? "2201";
const SSH_USER = process.argv.find((a) => a.startsWith("--ssh-user="))?.split("=")[1] ?? "root";
const SSH_SANDBOX = process.argv.find((a) => a.startsWith("--ssh-sandbox="))?.split("=")[1] ?? "";
const SSH_KEY = process.argv.find((a) => a.startsWith("--ssh-key="))?.split("=")[1] ?? "";

const isSsh = !!SSH_HOST && !!SSH_SANDBOX;

log.info(
  `starting on port ${PORT}, local=${!isSsh}, ssh=${isSsh ? `${SSH_USER}@${SSH_HOST}:${SSH_PORT}/${SSH_SANDBOX}` : "none"}`,
);

// ─── JSONL 管道 ─────────────────────────────────────────

let piProcess: ChildProcess | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
let requestId = 0;

function startPi(): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    if (isSsh) {
      // SSH 模式：通过 SSH 连接到沙盒内的 pi
      const keyFlag = SSH_KEY ? `-i ${SSH_KEY}` : "";
      const sshCmd = `ssh ${keyFlag} -o StrictHostKeyChecking=no -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} sandbox ${SSH_SANDBOX} 'pi --mode rpc'`;
      cmd = "sh";
      args = ["-c", sshCmd];
    } else {
      // 本地模式：直接 spawn pi CLI
      cmd = "/usr/bin/node";
      args = [CLI_PATH, "--mode", "rpc"];
    }

    const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };
    const spawnOpts: Record<string, unknown> = { env, stdio: ["pipe", "pipe", "pipe"] };
    if (!isSsh) {
      (spawnOpts as Record<string, unknown>).cwd = CWD;
    }

    piProcess = spawn(cmd, args, spawnOpts as Record<string, unknown>);

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

    if (!isSsh) {
      piProcess.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(data);
      });
    }

    piProcess.on("error", reject);
    piProcess.on("exit", (code) => {
      log.info(`pi agent exited with code ${code}`);
      piProcess = null;
    });

    // 等待 ready 事件
    const timeout = setTimeout(() => reject(new Error("pi agent start timeout")), 60000);
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
  const { id, type, method } = msg;

  // ready 通知（无 id）
  if (type === "ready" || (method === "start" && type === "result")) {
    const pending = pendingRequests.get("__ready__");
    if (pending) {
      pending.resolve(null);
      pendingRequests.delete("__ready__");
    }
    return;
  }

  // RPC 结果 — pi CLI 返回 { id, success, data } 或 { id, success: false, error }
  if (id && pendingRequests.has(String(id))) {
    const pending = pendingRequests.get(String(id));
    if (!pending) return;
    if (msg.success === false) {
      pending.reject(new Error(String(msg.error)));
    } else {
      pending.resolve(msg.data ?? msg);
    }
    pendingRequests.delete(String(id));
  }
}

function callPi(type: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req_${++requestId}`;
    const msg = JSON.stringify({ type, id, params }) + "\n";
    pendingRequests.set(id, { resolve, reject });
    piProcess?.stdin?.write(msg);
    setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (pending) {
        pending.reject(new Error(`RPC timeout: ${type}`));
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
