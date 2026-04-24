import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { AgentEvent, AgentProcessInfo } from "../modules/agent";
import { StreamParser } from "./stream-parser";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

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
        await this.emit(sessionId, evt);
      }
      return { agentId: sessionId, status: "already_running" };
    }

    const args = ["--mode", "rpc", "--no-extensions", "--no-skills"];
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
      this.emit(sessionId, { type: "agent_end", messages: [] });
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

    const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
    if (event.type === "extension_ui_request") {
      const method = (event as Record<string, unknown>).method as string;
      if (!INTERACTIVE_METHODS.has(method)) return;
    }

    // 状态跟踪
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

    // hold buffer: 在 streaming 期间收集事件
    if (managed.info.status === "streaming" && event.type !== "agent_end" && event.type !== "response") {
      managed.info.holdEvents.push(event);
    }

    // 转发给前端
    this.emit(sessionId, event);
  }

  private async emit(sessionId: string, event: AgentEvent): Promise<void> {
    await this.server.emitEvent(
      "agent.event",
      { sessionId, event } as unknown as Record<string, unknown>,
      { sessionId },
    );
  }
}
