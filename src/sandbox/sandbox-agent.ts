/**
 * Sandbox Agent — RPC proxy service
 *
 * Receives HTTP RPC requests from the main gateway, communicates with pi agent via JSONL.
 *
 * Two modes:
 *   - Local mode: directly spawn pi CLI (default)
 *   - SSH mode: connect to pi CLI inside a sandbox via SSH (--ssh-*)
 */

/**
 * Map frontend method names ("agent.camelCase") to pi CLI RPC command names ("snake_case").
 * The pi CLI process only understands snake_case command types.
 */
const METHOD_MAP: Record<string, string> = {
  "agent.getModifiedFiles": "get_modified_files",
  "agent.getFileDiff": "get_file_diff",
  "agent.getBatchDiffs": "get_batch_diffs",
  "agent.getFileHistory": "get_file_history",
  "agent.navigateTree": "navigate_tree",
  "agent.switchSession": "switch_session",
  "agent.previewRollback": "preview_rollback",
  "agent.exportHtml": "export_html",
  "agent.newSession": "new_session",
  "agent.getFullMessages": "get_full_messages",
  "agent.getMessages": "get_messages",
  "agent.getTree": "get_tree",
  "agent.getTreeWithLeaf": "get_tree_with_leaf",
  "agent.setSessionName": "set_session_name",
  "agent.getSessionStats": "get_session_stats",
  "agent.setModel": "set_model",
  "agent.cycleModel": "cycle_model",
  "agent.getAvailableModels": "get_available_models",
  "agent.setThinkingLevel": "set_thinking_level",
  "agent.cycleThinkingLevel": "cycle_thinking_level",
  "agent.setSteeringMode": "set_steering_mode",
  "agent.setFollowUpMode": "set_follow_up_mode",
  "agent.setAutoRetry": "set_auto_retry",
  "agent.abortRetry": "abort_retry",
  "agent.setAutoCompaction": "set_auto_compaction",
  "agent.deleteEntries": "delete_entries",
  "agent.summarizeEntries": "summarize_entries",
  "agent.setActiveTools": "set_active_tools",
  "agent.getActiveTools": "get_active_tools",
  "agent.getContextUsage": "get_context_usage",
  "agent.getSystemPrompt": "get_system_prompt",
  "agent.getMcpServers": "get_mcp_servers",
  "agent.toggleMcpServer": "toggle_mcp_server",
  "agent.restartMcpServer": "restart_mcp_server",
  "agent.getCommands": "get_commands",
  "agent.getSkills": "get_skills",
  "agent.getExtensions": "get_extensions",
  "agent.getTools": "get_tools",
  "agent.getSettings": "get_settings",
  "agent.setSettings": "set_settings",
  "agent.getFlags": "get_flags",
  "agent.getFlagValues": "get_flag_values",
  "agent.setFlag": "set_flag",
  "agent.getQueue": "get_queue",
  "agent.clearQueue": "clear_queue",
  "agent.getForkMessages": "get_fork_messages",
  "agent.getLastAssistantText": "get_last_assistant_text",
  "agent.getAgentsFiles": "get_agents_files",
  "agent.registerRemoteTool": "register_remote_tool",
  "agent.unregisterRemoteTool": "unregister_remote_tool",
  "agent.sendRemoteToolResult": "send_remote_tool_result",
  "agent.respondUI": "respond_ui",
  "agent.waitForIdle": "wait_for_idle",
  "agent.collectEvents": "collect_events",
  "agent.promptAndWait": "prompt_and_wait",
  "agent.getState": "get_state",
  "agent.setCwd": "set_cwd",
  "agent.clone": "clone",
  "agent.fork": "fork",
  "agent.prompt": "prompt",
  "agent.steer": "steer",
  "agent.followUp": "follow_up",
  "agent.abort": "abort",
  "agent.compact": "compact",
  "agent.bash": "bash",
  "agent.abortBash": "abort_bash",
  "agent.stop": "stop",
  "agent.reload": "reload",
};

/**
 * For multi-arg RPC methods, map positional params to the named fields
 * that the pi CLI rpc-mode.ts expects on the `command` object.
 * Single-object-param methods don't need this — the object is flattened directly.
 */
const PARAM_NAMES_MAP: Record<string, string[]> = {
  set_model: ["provider", "modelId"],
  fork: ["entryId", "options"],
  navigate_tree: ["targetId", "options"],
  summarize_entries: ["targetIds", "options"],
  set_settings: ["settings", "scope"],
  toggle_mcp_server: ["name", "enabled"],
  set_flag: ["name", "value"],
  send_remote_tool_result: ["toolCallId", "result"],
  respond_ui: ["requestId", "response"],
  prompt_and_wait: ["message", "images", "timeout"],
  prompt: ["message", "images"],
  steer: ["message", "images"],
  follow_up: ["message", "images"],
  compact: ["customInstructions"],
  set_session_name: ["name"],
  new_session: ["parentSession"],
  switch_session: ["sessionPath"],
  export_html: ["outputPath"],
  delete_entries: ["targetIds"],
  set_active_tools: ["toolNames"],
  set_auto_compaction: ["enabled"],
  set_auto_retry: ["enabled"],
  set_thinking_level: ["level"],
  set_steering_mode: ["mode"],
  set_follow_up_mode: ["mode"],
  bash: ["command"],
  get_full_messages: ["options"],
  get_modified_files: ["options"],
  get_file_diff: ["options"],
  get_batch_diffs: ["options"],
  get_file_history: ["options"],
  preview_rollback: ["targetId"],
  get_settings: ["scope"],
  register_remote_tool: ["toolDef"],
  unregister_remote_tool: ["toolName"],
};

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

// ─── JSONL pipeline ─────────────────────────────────────

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
      const keyFlag = SSH_KEY ? `-i ${SSH_KEY}` : "";
      const sshCmd = `ssh ${keyFlag} -o StrictHostKeyChecking=no -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} sandbox ${SSH_SANDBOX} 'pi --mode rpc'`;
      cmd = "sh";
      args = ["-c", sshCmd];
    } else {
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

  // ready notification (no id)
  if (type === "ready" || (method === "start" && type === "result")) {
    const pending = pendingRequests.get("__ready__");
    if (pending) {
      pending.resolve(null);
      pendingRequests.delete("__ready__");
    }
    return;
  }

  // RPC result — pi CLI returns { id, success, data } or { id, success: false, error }
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

function callPi(rpcType: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req_${++requestId}`;
    // pi CLI expects named fields at the top level of the JSON message.
    // SandboxRpcClient passes params as positional args.
    // For single-object-param calls (most RPC methods), flatten directly.
    // For multi-arg calls, use PARAM_NAMES_MAP to assign correct field names.
    let paramObj: Record<string, unknown>;
    if (params.length === 0) {
      paramObj = {};
    } else if (params.length === 1 && typeof params[0] === "object" && params[0] !== null) {
      // Single object arg — flatten directly (covers most methods)
      paramObj = params[0] as Record<string, unknown>;
    } else {
      // Multi-arg or single primitive arg — look up param names
      const names = PARAM_NAMES_MAP[rpcType];
      if (names && names.length >= params.length) {
        paramObj = {};
        for (let i = 0; i < params.length; i++) {
          paramObj[names[i]] = params[i];
        }
      } else {
        // Fallback: positional keys — won't work for pi CLI but won't crash
        paramObj = {};
        for (let i = 0; i < params.length; i++) {
          paramObj[i] = params[i];
        }
      }
    }
    const msg = JSON.stringify({ type: rpcType, id, ...paramObj }) + "\n";
    pendingRequests.set(id, { resolve, reject });
    piProcess?.stdin?.write(msg);
    setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (pending) {
        pending.reject(new Error(`RPC timeout: ${rpcType}`));
        pendingRequests.delete(id);
      }
    }, 60000);
  });
}

// ─── HTTP service ───────────────────────────────────────

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
      const rpcType = METHOD_MAP[method] ?? method;
      const result = await callPi(rpcType, params ?? []);
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

// ─── Startup ────────────────────────────────────────────

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
