import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentProcessInfo,
  ChannelDataEvent,
  ExtensionUIRequestEvent,
  MessageData,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { TodoChannelEvent } from "../modules/todo";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import { StreamParser } from "./stream-parser";
import { serializeJsonLine } from "./jsonl-helpers";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

const SUBAGENT_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/subagent.ts";

const TODO_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/todo.ts";

const BASH_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/bash.ts";

const LSP_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/lsp/index.ts";

const PREVIEW_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/preview.ts";

interface ManagedProcess {
  process: ChildProcess;
  info: AgentProcessInfo;
  parser: StreamParser;
  pendingRequests: Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  reqIdCounter: number;
}

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & { partial?: AssistantMessage };
    return { ...rest, assistantMessageEvent: ameRest } as SanitizedMessageUpdate;
  }
  return event as SanitizedEvent;
}

interface SubagentChannelPayload {
  sessionId: string;
  event: Record<string, unknown>;
}

export class AgentProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private server: RPCServer;

  constructor(server: RPCServer) {
    this.server = server;
  }

  updateServer(server: RPCServer): void {
    this.server = server;
  }

  async start(sessionId: string, projectPath: string, sessionPath: string): Promise<{ agentId: string; status: "started" | "already_running" }> {
    const existing = this.processes.get(sessionId);
    if (existing && existing.process.pid && !existing.process.killed) {
      for (const evt of existing.info.holdEvents) {
        await this.emitAgentEvent(sessionId, evt);
      }
      return { agentId: sessionId, status: "already_running" };
    }

    const args = [
      "--mode", "rpc",
      "--no-extensions",
      "--extension", SUBAGENT_EXTENSION_PATH,
      "--extension", TODO_EXTENSION_PATH,
      "--extension", BASH_EXTENSION_PATH,
      "--extension", LSP_EXTENSION_PATH,
      "--extension", PREVIEW_EXTENSION_PATH,
    ];
    if (sessionPath && existsSync(sessionPath)) {
      args.push("--session", sessionPath);
    }

    log.info("Spawning pi", { args: args.join(" "), cwd: projectPath });

    const LOCAL_PI = "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/cli.js";
    const child = spawn("node", [LOCAL_PI, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: projectPath,
    });

    log.info("Spawned", { pid: child.pid });

    const info: AgentProcessInfo = {
      sessionId,
      projectPath,
      sessionPath,
      pid: child.pid!,
      status: "idle",
      holdEvents: [],
      holdStartTime: 0,
    };

    const parser = new StreamParser();
    const managed: ManagedProcess = { process: child, info, parser, pendingRequests: new Map(), reqIdCounter: 0 };

    child.stdout.on("data", (data: Buffer) => {
      const raw = data.toString();
      log.debug("stdout", { raw: raw.slice(0, 200) });
      const events = parser.feed(raw);
      log.debug("parsed events", { count: events.length });
      for (const event of events) {
        this.handleEvent(sessionId, event);
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        log.warn("stderr", { msg: msg.slice(0, 200) });
      }
    });

    child.on("exit", (code, signal) => {
      log.info("Process exited", { code, signal });
      this.emitAgentEvent(sessionId, { type: "agent_end", messages: [] });
      this.processes.delete(sessionId);
    });

    this.processes.set(sessionId, managed);
    return { agentId: sessionId, status: "started" };
  }

  send(sessionId: string, content: string): boolean {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) {
      log.warn("send: no process", { sessionId, killed: managed?.process.killed });
      return false;
    }

    const msg = { type: "prompt", message: content, id: `req_${Date.now()}` };
    log.debug("Writing to stdin", { json: JSON.stringify(msg) });
    managed.process.stdin!.write(serializeJsonLine(msg));
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) return false;

    const msg = { type: "extension_ui_response", id: requestId, ...response };
    managed.process.stdin!.write(serializeJsonLine(msg));
    return true;
  }

  stop(sessionId: string): boolean {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) return false;

    managed.process.kill("SIGTERM");
    this.processes.delete(sessionId);
    return true;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) return { status: "stopped" };
    return { status: managed.info.status, pid: managed.info.pid };
  }

  private sendRpcCommand(sessionId: string, command: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) return Promise.reject(new Error("Process not running"));
    if (!managed.process.stdin) return Promise.reject(new Error("Stdin not available"));

    const reqId = `req_${Date.now()}_${++managed.reqIdCounter}`;
    const msg = { ...command, id: reqId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        managed.pendingRequests.delete(reqId);
        reject(new Error(`RPC command ${command.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      managed.pendingRequests.set(reqId, { resolve: resolve as (data: unknown) => void, reject, timer });
      managed.process.stdin!.write(serializeJsonLine(msg));
    });
  }

  getState(sessionId: string): Promise<{
    model?: { id: string; contextWindow: number; maxTokens: number };
    isStreaming: boolean;
    isCompacting: boolean;
    messageCount: number;
  } | null> {
    return this.sendRpcCommand(sessionId, { type: "get_state" })
      .then((data) => {
        if (!data || typeof data !== "object") return null;
        const d = data as Record<string, unknown>;
        const model = d.model as Record<string, unknown> | undefined;
        return {
          model: model ? {
            id: String(model.id ?? ""),
            contextWindow: Number(model.contextWindow ?? 0),
            maxTokens: Number(model.maxTokens ?? 0),
          } : undefined,
          isStreaming: Boolean(d.isStreaming),
          isCompacting: Boolean(d.isCompacting),
          messageCount: Number(d.messageCount ?? 0),
        };
      })
      .catch(() => null);
  }

  getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    return this.sendRpcCommand(sessionId, { type: "get_session_stats" })
      .then((data) => {
        if (!data || typeof data !== "object") return null;
        if ((data as Record<string, unknown>).success === false) return null;
        const d = ((data as Record<string, unknown>).data ?? data) as Record<string, unknown>;
        const tokens = d.tokens as Record<string, unknown> | undefined;
        const cu = d.contextUsage as Record<string, unknown> | undefined;
        return {
          tokens: {
            input: Number(tokens?.input ?? 0),
            output: Number(tokens?.output ?? 0),
            cacheRead: Number(tokens?.cacheRead ?? 0),
            cacheWrite: Number(tokens?.cacheWrite ?? 0),
            total: Number(tokens?.total ?? 0),
          },
          cost: Number(d.cost ?? 0),
          contextUsage: cu ? {
            tokens: cu.tokens as number | null,
            contextWindow: Number(cu.contextWindow ?? 0),
            percent: cu.percent as number | null,
          } : undefined,
        };
      })
      .catch(() => null);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.processes.get(sessionId);
    if (!managed) return;

    if (event.type === "response" && event.id) {
      const pending = managed.pendingRequests.get(event.id);
      if (pending) {
        clearTimeout(pending.timer);
        managed.pendingRequests.delete(event.id);
        if (event.success !== false) {
          pending.resolve(event.data ?? null);
        } else {
          pending.reject(new Error(event.error ?? "RPC command failed"));
        }
        return;
      }
    }

    if (event.type === "channel_data") {
      const ch = event as ChannelDataEvent;
      if (ch.name === "subagent") {
        this.handleSubagentChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "todo") {
        this.handleTodoChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "bash") {
        this.handleBashChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "lsp") {
        this.handleLspChannelData(sessionId, ch);
        return;
      }
    }

    if (event.type === "extension_ui_request") {
      const ui = event as ExtensionUIRequestEvent;
      const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
      if (!INTERACTIVE_METHODS.has(ui.method)) return;
    }

    if (event.type === "agent_start") {
      managed.info.status = "streaming";
      managed.info.holdEvents = [];
      managed.info.holdStartTime = Date.now();
    }

    if (event.type === "agent_end") {
      managed.info.status = "idle";
      managed.info.holdEvents = [];
    }

    if (event.type === "message_update") {
      managed.info.status = "streaming";
    }

    const sanitized = sanitizeEvent(event);

    if (managed.info.status === "streaming" && event.type !== "agent_end" && event.type !== "response") {
      managed.info.holdEvents.push(sanitized);
    }

    this.emitAgentEvent(sessionId, sanitized);
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as SubagentChannelPayload | undefined;
    if (!data) return;

    const { event: subEvent, sessionId: subSessionId } = data;
    if (!subEvent || !subSessionId) return;

    const eventType = subEvent.type as string;
    if (eventType === "response") return;

    const managed = this.processes.get(parentSessionId);
    const sessionPath = managed?.info.sessionPath || "";

    if (eventType === "message_end" && subEvent.message) {
      const msg = subEvent.message as MessageData;
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            log.info("Subagent final text", {
              parentSessionId,
              subSessionId,
              textLength: part.text.length,
              preview: part.text.slice(0, 100),
            });
          }
        }
      }
    }

    await this.server.emitEvent(
      "subagent.event",
      { parentSessionId, parentSessionPath: sessionPath, subSessionId, event: subEvent },
      { parentSessionId },
    );
  }

  private async handleTodoChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as TodoChannelEvent | undefined;
    if (!data) return;

    log.info("Todo channel data", { sessionId, action: data.action, count: data.todos?.length });

    await this.server.emitEvent(
      "todo.event",
      { sessionId, action: data.action, todos: data.todos, timestamp: data.timestamp },
      { sessionId },
    );
  }

  private async handleBashChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as BashChannelEvent | undefined;
    log.info("Bash channel data", { sessionId, type: data?.type, toolCallId: data?.toolCallId });
    if (!data) return;

    await this.server.emitEvent(
      "bash.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async handleLspChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as LspChannelEvent | undefined;
    if (!data) return;

    log.info("LSP channel data", { sessionId, event: data.event });

    await this.server.emitEvent(
      "lsp.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.server.emitEvent(
      "agent.event",
      { sessionId, event },
      { sessionId },
    );
  }

  sendChannelData(sessionId: string, channelName: string, data: unknown): void {
    const managed = this.processes.get(sessionId);
    if (!managed || !managed.process.stdin) return;
    managed.process.stdin.write(serializeJsonLine({ type: "channel_data", name: channelName, data }));
  }
}
