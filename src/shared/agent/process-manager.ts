import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { AgentEvent, AgentProcessInfo } from "../modules/agent";
import type { TodoChannelEvent } from "../modules/todo";
import { StreamParser } from "./stream-parser";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

const SUBAGENT_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/subagent.ts";

const TODO_EXTENSION_PATH =
  "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/todo.ts";

interface ManagedProcess {
  process: ChildProcess;
  info: AgentProcessInfo;
  parser: StreamParser;
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
    ];
    if (sessionPath && existsSync(sessionPath)) {
      args.push("--session", sessionPath);
    }

    log.info("Spawning pi", { args: args.join(" "), cwd: projectPath });

    const child = spawn("pi", args, {
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
    const managed: ManagedProcess = { process: child, info, parser };

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
    const json = JSON.stringify(msg);
    log.debug("Writing to stdin", { json });
    managed.process.stdin!.write(json + "\n");
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.processes.get(sessionId);
    if (!managed || managed.process.killed) return false;

    const msg = { type: "extension_ui_response", id: requestId, ...response };
    managed.process.stdin!.write(JSON.stringify(msg) + "\n");
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

  private handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.processes.get(sessionId);
    if (!managed) return;

    const record = event as Record<string, unknown>;

    if (record.type === "channel_data" && record.name === "subagent") {
      this.handleSubagentChannelData(sessionId, record);
      return;
    }

    if (record.type === "channel_data" && record.name === "todo") {
      this.handleTodoChannelData(sessionId, record);
      return;
    }

    const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
    if (event.type === "extension_ui_request") {
      const method = record.method as string;
      if (!INTERACTIVE_METHODS.has(method)) return;
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

    if (managed.info.status === "streaming" && event.type !== "agent_end" && event.type !== "response") {
      managed.info.holdEvents.push(event);
    }

    this.emitAgentEvent(sessionId, event);
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: Record<string, unknown>,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    const subEvent = data.event as Record<string, unknown> | undefined;
    const subSessionId = data.sessionId as string | undefined;
    if (!subEvent || !subSessionId) return;

    const eventType = subEvent.type as string;

    if (eventType === "response") return;

    const managed = this.processes.get(parentSessionId);
    const sessionPath = managed?.info.sessionPath || "";

    if (eventType === "message_end" && subEvent.message) {
      const msg = subEvent.message as Record<string, unknown>;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text" && typeof part.text === "string") {
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
      {
        parentSessionId,
        parentSessionPath: sessionPath,
        subSessionId,
        event: subEvent,
      } as unknown as Record<string, unknown>,
      { parentSessionId },
    );
  }

  private async handleTodoChannelData(
    sessionId: string,
    channelMsg: Record<string, unknown>,
  ): Promise<void> {
    const data = channelMsg.data as TodoChannelEvent | undefined;
    if (!data) return;

    log.info("Todo channel data", { sessionId, action: data.action, count: data.todos?.length });

    await this.server.emitEvent(
      "todo.event",
      {
        sessionId,
        action: data.action,
        todos: data.todos,
        timestamp: data.timestamp,
      } as unknown as Record<string, unknown>,
      { sessionId },
    );
  }

  private async emitAgentEvent(sessionId: string, event: AgentEvent): Promise<void> {
    await this.server.emitEvent(
      "agent.event",
      { sessionId, event } as unknown as Record<string, unknown>,
      { sessionId },
    );
  }
}
