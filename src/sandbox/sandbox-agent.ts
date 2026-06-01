import { createServer, type ServerResponse } from "http";
import { spawn, type ChildProcess } from "child_process";
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  rmSync,
  renameSync,
  copyFileSync,
  existsSync,
  constants,
} from "fs";
import { join, basename as pathBasename, dirname } from "path";

const PORT = parseInt(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3101");
const CLI_PATH =
  process.argv.find((a) => a.startsWith("--cli-path="))?.split("=")[1] ?? "/usr/local/bin/pi";
const CWD = process.argv.find((a) => a.startsWith("--cwd="))?.split("=")[1] ?? process.cwd();
void CLI_PATH;
void CWD;

const log = {
  info: (...args: unknown[]) => process.stdout.write(`[sandbox-agent] ${JSON.stringify(args)}\n`),
  error: (...args: unknown[]) =>
    process.stderr.write(`[sandbox-agent] ERROR ${JSON.stringify(args)}\n`),
};

// ─── Pi Process Management ─────────────────────────────

let piProcess: ChildProcess | null = null;
const pendingRequests = new Map<
  string,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let requestId = 0;
let readyResolve: (() => void) | null = null;
const sseClients = new Set<ServerResponse>();

function startPi(): Promise<void> {
  return new Promise((resolve, reject) => {
    readyResolve = resolve;
    const timeout = setTimeout(() => reject(new Error("pi agent start timeout")), 60_000);

    piProcess = spawn(process.execPath, [CLI_PATH, "--mode", "rpc"], {
      cwd: CWD,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    piProcess.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handlePiMessage(msg);
        } catch {
          /* skip malformed */
        }
      }
    });

    piProcess.stderr!.on("data", (data: Buffer) => process.stderr.write(data));

    piProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    piProcess.on("exit", (code) => {
      log.info(`pi agent exited with code ${code}`);
      piProcess = null;
      clearTimeout(timeout);
      reject(new Error(`pi agent exited with code ${code}`));
    });
  });
}

function handlePiMessage(msg: Record<string, unknown>): void {
  if (msg.type === "ready") {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
    return;
  }

  if (msg.type === "response" && msg.id && pendingRequests.has(String(msg.id))) {
    const pending = pendingRequests.get(String(msg.id))!;
    pendingRequests.delete(String(msg.id));
    clearTimeout(pending.timer);
    if (msg.success === false) {
      pending.reject(new Error(String(msg.error ?? "unknown error")));
    } else {
      pending.resolve(msg.data ?? msg);
    }
    broadcastSSE(msg);
    return;
  }

  broadcastSSE(msg);
}

function broadcastSSE(data: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sendToPi(command: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!piProcess || !piProcess.stdin) {
      reject(new Error("pi process not running"));
      return;
    }
    if (!command.id) {
      command.id = `req_${++requestId}`;
    }
    const id = String(command.id);
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${command.type ?? "unknown"}`));
      }
    }, 60000);
    pendingRequests.set(id, { resolve, reject, timer });
    piProcess.stdin.write(JSON.stringify(command) + "\n");
  });
}

function writeToPi(message: Record<string, unknown>): void {
  if (!piProcess || !piProcess.stdin) {
    throw new Error("pi process not running");
  }
  piProcess.stdin.write(JSON.stringify(message) + "\n");
}

// ─── HTTP Server ──────────────────────────────────────

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
    res.end(
      JSON.stringify({
        status: "ok",
        pid: process.pid,
        piAlive: piProcess !== null,
      }),
    );
    return;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if ((url.pathname === "/jsonl" || url.pathname === "/rpc") && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    let command: Record<string, unknown>;
    if (raw.type && !raw.method) {
      command = raw;
    } else if (raw.method) {
      const method = String(raw.method);
      const snakeType = method
        .replace(/^agent\./, "")
        .replace(/[A-Z]/g, (c, i) => (i > 0 ? "_" : "") + c.toLowerCase());
      command = { type: snakeType, id: raw.id ?? `rpc_${++requestId}` };
      const params = raw.params as unknown[];
      if (Array.isArray(params)) {
        PARAM_NAMES[snakeType]?.forEach((name, i) => {
          if (i < params.length) command[name] = params[i];
        });
      } else if (params && typeof params === "object") {
        Object.assign(command, params);
      }
    } else {
      command = raw;
    }
    try {
      const result = await sendToPi(command);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  const PARAM_NAMES: Record<string, string[]> = {
    prompt: ["message", "images"],
    steer: ["message", "images"],
    follow_up: ["message", "images"],
    set_model: ["provider", "modelId"],
    set_thinking_level: ["level"],
    bash: ["command"],
    new_session: ["parentSession"],
    switch_session: ["sessionPath"],
    fork: ["entryId", "options"],
    navigate_tree: ["targetId", "options"],
    preview_rollback: ["targetId"],
    set_session_name: ["name"],
    get_full_messages: ["options"],
    get_modified_files: ["options"],
    get_file_diff: ["options"],
    get_batch_diffs: ["options"],
    get_file_history: ["options"],
    set_auto_compaction: ["enabled"],
    delete_entries: ["targetIds"],
    summarize_entries: ["targetIds", "options"],
    set_auto_retry: ["enabled"],
    set_steering_mode: ["mode"],
    set_follow_up_mode: ["mode"],
    set_settings: ["settings", "scope"],
    get_settings: ["scope"],
    get_agent_detail: ["agentName"],
    set_cwd: ["cwd"],
    set_flag: ["name", "value"],
    toggle_mcp_server: ["name", "enabled"],
    restart_mcp_server: ["name"],
    set_active_tools: ["toolNames"],
    register_remote_tool: ["tool"],
    unregister_remote_tool: ["name"],
    send_remote_tool_result: ["toolCallId", "result"],
    respond_ui: ["requestId", "response"],
    wait_for_idle: ["timeout"],
    collect_events: ["timeout"],
    prompt_and_wait: ["message", "images", "timeout"],
  };

  if (url.pathname === "/write" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const message = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    try {
      writeToPi(message);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  // ─── File System Operations ─────────────────────────
  if (url.pathname.startsWith("/fs/")) {
    const action = url.pathname.slice(4);
    try {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      }
      const queryPath = url.searchParams.get("path");
      if (queryPath && !body.path) {
        body.path = queryPath;
      } else if (body.path) {
        body.path = String(body.path);
      }
      let result: unknown;
      switch (action) {
        case "listDir": {
          const dirPath = String(body.path ?? mapPath(CWD));
          const entries = readdirSync(dirPath).map((name) => {
            const fullPath = join(dirPath, name);
            try {
              const stat = statSync(fullPath);
              return {
                name,
                path: fullPath,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile(),
                size: stat.size,
                modified: stat.mtime.toISOString(),
              };
            } catch {
              return {
                name,
                path: fullPath,
                isDirectory: false,
                isFile: false,
                size: 0,
                modified: "",
              };
            }
          });
          result = { entries, basePath: dirPath };
          break;
        }
        case "readFile": {
          const filePath = String(body.path);
          const content = readFileSync(filePath, "utf-8");
          const stat = statSync(filePath);
          result = { content, size: stat.size };
          break;
        }
        case "writeFile": {
          const filePath = String(body.path);
          const dir = dirname(filePath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(filePath, String(body.content ?? ""), "utf-8");
          result = { ok: true };
          break;
        }
        case "editFile": {
          const filePath = String(body.path);
          let content = readFileSync(filePath, "utf-8");
          const edits = (body.edits as Array<{ oldText: string; newText: string }>) ?? [];
          for (const edit of edits) {
            content = content.replace(edit.oldText, edit.newText);
          }
          writeFileSync(filePath, content, "utf-8");
          result = { ok: true };
          break;
        }
        case "createFile": {
          const dir = String(body.dirPath);
          const name = String(body.name);
          const filePath = join(dir, name);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(filePath, "", "utf-8");
          result = { path: filePath };
          break;
        }
        case "createDir": {
          const dir = String(body.dirPath);
          const name = String(body.name);
          const dirPath = join(dir, name);
          mkdirSync(dirPath, { recursive: true });
          result = { path: dirPath };
          break;
        }
        case "rename": {
          const oldPath = String(body.oldPath);
          const newName = String(body.newName);
          const newPath = join(dirname(oldPath), newName);
          renameSync(oldPath, newPath);
          result = { newPath };
          break;
        }
        case "delete": {
          const targetPath = String(body.path);
          const stat = statSync(targetPath);
          if (stat.isDirectory()) {
            rmSync(targetPath, { recursive: true, force: true });
          } else {
            unlinkSync(targetPath);
          }
          result = { ok: true };
          break;
        }
        case "copy": {
          const srcPath = String(body.srcPath);
          const destDir = String(body.destDir);
          const destPath = join(destDir, pathBasename(srcPath));
          copyFileSync(srcPath, destPath, constants.COPYFILE_FICLONE);
          result = { path: destPath };
          break;
        }
        case "stat": {
          const filePath = String(body.path);
          const stat = statSync(filePath);
          result = {
            exists: true,
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile(),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
          break;
        }
        default:
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: `Unknown fs action: ${action}` }));
          return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  if (url.pathname.startsWith("/raw/")) {
    let filePath = decodeURIComponent(url.pathname.slice(5));
    if (!filePath.startsWith("/")) filePath = "/" + filePath;
    if (!filePath || !existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Is a directory");
        return;
      }
      const ext = filePath.lastIndexOf(".");
      const mimeType: Record<string, string> = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
      };
      const ct =
        ext >= 0
          ? (mimeType[filePath.slice(ext)] ?? "application/octet-stream")
          : "application/octet-stream";
      const range = req.headers["range"];
      const data = readFileSync(filePath);
      if (range) {
        const parts = String(range)
          .replace(/bytes=/, "")
          .split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": ct,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": ct,
          "Accept-Ranges": "bytes",
        });
        res.end(data);
      }
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Read error");
    }
    return;
  }

  res.writeHead(404).end();
});

// ─── Start ────────────────────────────────────────────

async function main() {
  log.info(`starting on port ${PORT}, cli=${CLI_PATH}, cwd=${CWD}`);
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
