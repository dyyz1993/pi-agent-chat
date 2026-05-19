import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { createReadStream } from "fs";
import * as path from "path";
import * as readline from "readline";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentMessageForUI,
  ChannelDataEvent,
  ExtensionUIRequestEvent,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { TodoChannelEvent } from "../modules/todo";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent } from "../modules/rules";
import type { RpcClientAPI, TreeEntry, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";

type McpServerInfo = Awaited<ReturnType<RpcClientAPI["getMcpServers"]>>[number];

type ChannelMethodKeys<CN extends keyof ChannelTypeRegistry> = keyof NonNullable<
  ChannelTypeRegistry[CN]["methods"]
> &
  string;

type ChannelMethodParams<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { params: infer P } ? P : unknown;

type ChannelMethodReturn<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { return: infer R } ? R : unknown;
import type { CoordinatorMethodCall, CoordinatorChannelEvent } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

/**
 * Strip parentSession from a JSONL session file's header entry.
 * Prevents forked sessions from being identified as subagent children on refresh.
 */
function stripParentSessionFromHeader(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    const newlineIdx = content.indexOf("\n");
    if (newlineIdx < 0) return;
    const firstLine = content.slice(0, newlineIdx);
    const rest = content.slice(newlineIdx + 1);
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    if ("parentSession" in header) {
      delete header.parentSession;
      writeFileSync(filePath, JSON.stringify(header) + "\n" + rest, "utf-8");
    }
  } catch (err) {
    log.warn("stripParentSessionFromHeader failed", {
      filePath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Scan the global extensions directory (~/.pi/agent/extensions/) and
 * return `--extension <path>` args for each discovered entry.
 *
 * Layout: each subdirectory with an index.ts/js, or each .ts/.js file,
 * is treated as an extension. Symlinks are resolved.
 */
function discoverExtensionArgs(): string[] {
  const extDir = config.piExtensionsDir;
  if (!existsSync(extDir)) {
    log.warn("Global extensions directory not found", { extDir });
    return [];
  }

  const extensionPaths: string[] = [];
  try {
    for (const entry of readdirSync(extDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(path.join(extDir, entry.name));
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const fullPath = path.join(extDir, entry.name);
      if (isDir) {
        const indexTs = path.join(fullPath, "index.ts");
        const indexJs = path.join(fullPath, "index.js");
        if (existsSync(indexTs)) {
          extensionPaths.push(indexTs);
        } else if (existsSync(indexJs)) {
          extensionPaths.push(indexJs);
        }
      } else if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        extensionPaths.push(fullPath);
      }
    }
  } catch (err: unknown) {
    log.warn("Failed to scan extensions directory", {
      extDir,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("Discovered extensions", { extDir, count: extensionPaths.length });
  for (const p of extensionPaths) {
    log.info("  → extension:", { path: p });
  }
  return extensionPaths.flatMap((p) => ["--extension", p]);
}

const EXTENSION_ARGS = ["--no-extensions", ...discoverExtensionArgs()];

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & {
      partial?: AssistantMessage;
    };
    return { ...rest, assistantMessageEvent: ameRest } as SanitizedMessageUpdate;
  }
  return event as SanitizedEvent;
}

interface SubagentChannelPayload {
  sessionId: string;
  event: Record<string, unknown>;
}

type RpcClientInstance = RpcClientAPI;

interface ManagedClient {
  client: RpcClientInstance;
  info: AgentProcessInfo;
  unsubscribe: () => void;
  /** Mutable reference — updated on switchSession to reroute events */
  _activeSessionId: string;
}

import type { AgentProcessInfo } from "../modules/agent";

let cachedModule: { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI } | null =
  null;

async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
): Promise<{ client: RpcClientInstance; timings: { dynamicImport: number; construct: number } }> {
  const t0 = performance.now();

  cachedModule ??= (await import("@dyyz1993/pi-coding-agent")) as unknown as {
    RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI;
  };
  const t1 = performance.now();

  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

  const args = [...EXTENSION_ARGS];
  if (sessionPath && existsSync(sessionPath)) {
    args.push("--session", sessionPath);
  }

  const client = new cachedModule.RpcClient({
    cliPath,
    cwd,
    args,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
  });
  const t2 = performance.now();

  const timings = { dynamicImport: Math.round(t1 - t0), construct: Math.round(t2 - t1) };
  perfLog.info("[createRpcClient] done", timings);

  return { client, timings };
}

export class AgentProcessManager {
  private clients = new Map<string, ManagedClient>();
  /** CWD-based process pool: projectPath → the ManagedClient running for that project */
  private processByCwd = new Map<string, ManagedClient>();
  private servers = new Set<RPCServer>();
  /** Guard: prevents recursive start() via coordinator session_delegate */
  private _startInProgress = false;
  /** Queued delegate requests received during start() */
  private _pendingDelegateRequests: Array<{
    sessionId: string;
    msg: unknown;
    channelName: string;
    resolve: (result: unknown) => void;
  }> = [];
  private sessionPaths = new Map<string, string>();
  /** Persistent projectPath per session — NOT cleaned on stop(), only on service restart.
      Allows restarting an inactive session when receiving delegate messages. */
  private sessionProjectPaths = new Map<string, string>();
  private leafIds = new Map<string, string | null>();
  private lastLspState = new Map<
    string,
    { state: string; servers: unknown[]; mode?: string; activeLanguages?: string[] }
  >();
  private parentChildMap = new Map<string, Set<string>>();
  private delegateReplyCount = new Map<string, number>();
  private delegateCreatedAt = new Map<string, number>();
  private syncDelegateResolvers = new Map<
    string,
    {
      resolve: (result: {
        sessionId: string;
        status: string;
        exitCode: number;
        finalText: string;
        error?: string;
      }) => void;
      timeout: ReturnType<typeof setTimeout>;
      parentSessionId: string;
    }
  >();
  private subagentSyncChildren = new Set<string>();
  private syncDelegateLastText = new Map<string, string>();

  private async _drainPendingDelegates(): Promise<void> {
    while (this._pendingDelegateRequests.length > 0) {
      const { sessionId, msg, resolve } = this._pendingDelegateRequests.shift()!;
      try {
        const call = msg as CoordinatorMethodCall;
        let delegateResult: unknown;
        if (call.__call === "session_delegate_sync") {
          delegateResult = await this.handleCoordinatorDelegateSync(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
          );
        } else {
          delegateResult = await this.handleCoordinatorDelegate(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
          );
        }
        resolve(delegateResult);
      } catch (err: unknown) {
        resolve({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private findParentSession(childSessionId: string): string | null {
    for (const [parentId, children] of this.parentChildMap.entries()) {
      if (children.has(childSessionId)) return parentId;
    }
    return null;
  }

  constructor(server: RPCServer) {
    this.servers.add(server);
  }

  updateServer(server: RPCServer): void {
    this.servers.add(server);
  }

  removeServer(server: RPCServer): void {
    this.servers.delete(server);
  }

  serverCount(): number {
    return this.servers.size;
  }

  private async broadcastEvent(
    eventType: string,
    payload: unknown,
    metadata?: unknown,
  ): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.emitEvent(eventType, payload, metadata);
      } catch (err: unknown) {
        log.warn("broadcastEvent failed, removing server", {
          eventType,
          err: err instanceof Error ? err.message : String(err),
        });
        this.servers.delete(server);
      }
    }
  }

  private broadcastSessionStatus(sessionId: string, status: string): void {
    const managed = this.getActiveManaged(sessionId);
    const projectPath = managed?.info.projectPath ?? "";
    this.broadcastEvent(
      "agent.session_status_changed",
      { sessionId, projectPath, status },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session.status_changed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async start(
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean },
  ): Promise<{ agentId: string; status: "started" | "already_running" | "switched" }> {
    const tStart = performance.now();

    // Guard: prevent recursive start() triggered by coordinator session_delegate
    // arriving during an ongoing start() (e.g. child process retarget in 0.74.50+).
    if (this._startInProgress) {
      log.warn("[start] reentrant call blocked", { sessionId });
      return { agentId: sessionId, status: "already_running" };
    }
    this._startInProgress = true;

    const existing = this.getActiveManaged(sessionId);
    if (existing) {
      perfLog.info("[start] already_running (cached hit)", {
        sessionId,
        totalMs: Math.round(performance.now() - tStart),
      });
      this._startInProgress = false;
      this._drainPendingDelegates();
      return { agentId: sessionId, status: "already_running" };
    }

    // ── Process pool: reuse existing process for same cwd ──
    const pooled = options?.forceNewProcess ? null : this.processByCwd.get(projectPath);
    if (pooled) {
      const oldSessionId = pooled._activeSessionId;
      const tSwitch = performance.now();
      try {
        perfLog.info("[start] reusing pooled process", {
          sessionId,
          projectPath,
          oldSessionId,
        });
        // Race switchSession with a 15-second timeout.
        // If the child process is busy (e.g. getFullMessages), don't queue behind it.
        const result = await Promise.race([
          pooled.client.switchSession(sessionPath),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("switchSession timed out after 15s")), 15000),
          ),
        ]);
        if (!result.cancelled) {
          // Update mappings: remove ALL stale clients entries pointing to this pooled process
          for (const [sid, mc] of this.clients) {
            if (mc === pooled && sid !== sessionId) {
              this.clients.delete(sid);
            }
          }
          pooled._activeSessionId = sessionId;
          pooled.info = {
            sessionId,
            projectPath,
            sessionPath,
            status: "idle",
            holdEvents: [],
          };
          this.clients.set(sessionId, pooled);
          this.sessionPaths.set(sessionId, sessionPath);
          this.sessionProjectPaths.set(sessionId, projectPath);
          perfLog.info("[start] switchSession done", {
            sessionId,
            oldSessionId,
            totalMs: Math.round(performance.now() - tSwitch),
          });
          this._startInProgress = false;
          this._drainPendingDelegates();
          this.broadcastSessionStatus(sessionId, "idle");
          return { agentId: sessionId, status: "switched" };
        }
        // If cancelled by an extension, fall through to create new process
        perfLog.info("[start] switchSession cancelled by extension, creating new process");
      } catch (err: unknown) {
        const switchMs = Math.round(performance.now() - tSwitch);
        // switchSession failed or timed out — kill the pooled process (it may be stuck)
        // and fall through to create a fresh one.
        perfLog.info("[start] switchSession failed, killing pooled process", {
          sessionId,
          oldSessionId,
          switchMs,
          error: err instanceof Error ? err.message : String(err),
        });
        // Remove from process pool so we don't try to reuse a stuck process
        this.processByCwd.delete(projectPath);
        // Kill ALL stale clients entries pointing to this stuck process
        for (const [sid, mc] of this.clients) {
          if (mc === pooled) {
            this.clients.delete(sid);
          }
        }
        try {
          pooled.unsubscribe();
        } catch {
          /* ignore */
        }
        try {
          await pooled.client.stop();
        } catch {
          /* ignore */
        }
      }
    }

    perfLog.info("[start] begin (new process)", { sessionId, projectPath });

    const { client, timings: createTimings } = await createRpcClient(
      config.piCliPath,
      projectPath,
      sessionPath,
    );
    const tAfterCreate = performance.now();

    log.info("Spawning pi via RpcClient", { cwd: projectPath, sessionPath });

    const info: AgentProcessInfo = {
      sessionId,
      projectPath,
      sessionPath,
      status: "idle",
      holdEvents: [],
    };

    const managed: ManagedClient = {
      client,
      info,
      unsubscribe: () => {},
      _activeSessionId: sessionId,
    };

    const bridge = (event: unknown): void => {
      this.handleEvent(managed._activeSessionId, event as AgentEvent);
    };
    managed.unsubscribe = client.onEvent(bridge);

    const coordinatorChannelNames = new Set(["coordinator", "coordinator_client"]);
    const channelNames = [
      "bash",
      "todo",
      "subagent",
      "lsp",
      "rules-engine",
      "memory",
      "coordinator",
      "coordinator_client",
      "supervisor",
    ] as const;
    for (const name of channelNames) {
      client.channel(name).onReceive((data: unknown) => {
        if (coordinatorChannelNames.has(name)) {
          this.handleCoordinatorCall(managed._activeSessionId, data, name);
          return;
        }
        this.handleEvent(managed._activeSessionId, {
          type: "channel_data",
          name,
          data,
        } as ChannelDataEvent);
      });
    }

    this.clients.set(sessionId, managed);

    try {
      await client.start();
    } catch (startErr: unknown) {
      this.clients.delete(sessionId);
      const msg = startErr instanceof Error ? startErr.message : String(startErr);
      log.error("[start] RpcClient.start failed", {
        sessionId,
        projectPath,
        error: msg,
        createRpcMs: Math.round(performance.now() - tAfterCreate),
      });
      this._startInProgress = false;
      throw new Error(`Agent startup failed for ${projectPath}: ${msg}`);
    }
    const tAfterProcessStart = performance.now();

    const totalMs = Math.round(tAfterProcessStart - tStart);
    const createRpcMs = Math.round(tAfterCreate - tStart);
    const processStartMs = Math.round(tAfterProcessStart - tAfterCreate);

    perfLog.info("[start] completed", {
      sessionId,
      totalMs,
      dynamicImportMs: createTimings.dynamicImport,
      constructMs: createTimings.construct,
      createRpcTotalMs: createRpcMs,
      processStartMs,
      channelsRegistered: channelNames.length,
    });

    log.info("RpcClient started", { sessionId });
    this.sessionPaths.set(sessionId, sessionPath);
    this.sessionProjectPaths.set(sessionId, projectPath);
    if (!options?.forceNewProcess) {
      this.processByCwd.set(projectPath, managed);
    }
    this._startInProgress = false;
    this._drainPendingDelegates();
    this.broadcastSessionStatus(sessionId, "idle");
    return { agentId: sessionId, status: "started" };
  }

  async replayHoldEvents(sessionId: string): Promise<{ replayed: number }> {
    const t0 = performance.now();
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      perfLog.info("[replayHoldEvents] no client", { sessionId, totalMs: 0 });
      return { replayed: 0 };
    }
    const events = managed.info.holdEvents;
    for (const evt of events) {
      await this.emitAgentEvent(sessionId, evt as SanitizedEvent);
    }
    const totalMs = Math.round(performance.now() - t0);
    perfLog.info("[replayHoldEvents] done", { sessionId, replayed: events.length, totalMs });
    return { replayed: events.length };
  }

  send(sessionId: string, content: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      log.warn("send: no client", { sessionId });
      return false;
    }
    managed.client.prompt(content).catch((err: Error) => {
      log.warn("prompt error", { err: err.message });
    });
    return true;
  }

  steer(sessionId: string, content: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    managed.client.steer(content).catch((err: unknown) => {
      log.warn("steer error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  followUp(sessionId: string, content: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    managed.client.followUp(content).catch((err: unknown) => {
      log.warn("followUp error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  }

  async abort(sessionId: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    await managed.client.abort().catch((err: unknown) => {
      log.warn("abort error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  async setCwd(sessionId: string, cwd: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    await managed.client.setCwd(cwd).catch((err: unknown) => {
      log.warn("setCwd error", {
        sessionId,
        cwd,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;

    managed.client.respondUI(requestId, response);
    return true;
  }

  stop(sessionId: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;

    managed.info.status = "idle";
    this.emitAgentEvent(sessionId, { type: "agent_end" } as SanitizedEvent).catch(
      (err: unknown) => {
        log.warn("emitAgentEvent(agent_end) error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      },
    );

    // Cascade stop delegated children
    const children = this.parentChildMap.get(sessionId);
    if (children) {
      for (const childId of children) {
        this.stop(childId);
      }
      this.parentChildMap.delete(sessionId);
      this.delegateReplyCount.delete(sessionId);
      this.delegateCreatedAt.delete(sessionId);
    }

    // Remove from parent's children set if this is a delegated session
    for (const [, childSet] of this.parentChildMap) {
      childSet.delete(sessionId);
    }

    this.delegateReplyCount.delete(sessionId);
    this.delegateCreatedAt.delete(sessionId);

    const syncResolver = this.syncDelegateResolvers.get(sessionId);
    if (syncResolver) {
      clearTimeout(syncResolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      syncResolver.resolve({
        sessionId,
        status: "aborted",
        exitCode: 1,
        finalText: "(stopped)",
      });
    }

    managed.unsubscribe();
    managed.client.stop().catch((err: unknown) => {
      log.warn("stop error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    this.clients.delete(sessionId);
    // Clean up process pool if this was the pooled process for its cwd
    const cwd = managed.info.projectPath;
    if (this.processByCwd.get(cwd) === managed) {
      this.processByCwd.delete(cwd);
    }
    // Note: sessionPaths and sessionProjectPaths are NOT cleared here.
    // They persist for session restart support (coordinator delegate_send).
    // The file path remains valid even after stop; session is re-activated
    // on demand like clicking on a session in the UI.
    this.lastLspState.delete(sessionId);
    this.leafIds.delete(sessionId);
    return true;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { status: "stopped" };
    return { status: managed.info.status };
  }

  private async readJsonlEntries(sessionPath: string): Promise<
    Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }>
  > {
    const entries: Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }> = [];
    if (!sessionPath || !existsSync(sessionPath)) return entries;
    try {
      const rl = readline.createInterface({
        input: createReadStream(sessionPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.id && parsed.type) {
            let label: string | undefined;
            if (
              parsed.type === "message" &&
              parsed.message &&
              typeof parsed.message === "object" &&
              parsed.message !== null
            ) {
              label = (parsed.message as Record<string, unknown>).role as string | undefined;
            } else if (parsed.customType) {
              label = parsed.customType as string;
            }
            entries.push({
              id: parsed.id as string,
              parentId: (parsed.parentId as string | null | undefined) ?? null,
              type: parsed.type as string,
              customType: parsed.customType as string | undefined,
              label,
            });
          }
        } catch (err: unknown) {
          log.warn("readJsonlEntries: skipping malformed entry", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      rl.close();
    } catch (err: unknown) {
      log.warn("readJsonlEntries: failed to read file", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return entries;
  }

  /**
   * Get the managed client for a session, but ONLY if the pooled process
   * is currently serving that session (i.e. _activeSessionId matches).
   * If the pooled process has been switched to a different session, this
   * returns null and cleans up the stale clients entry.
   */
  private getActiveManaged(sessionId: string): ManagedClient | null {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    if (managed._activeSessionId === sessionId) return managed;
    // Stale entry: pooled process was switched to a different session.
    // Clean up to prevent serving wrong session data.
    this.clients.delete(sessionId);
    return null;
  }

  private resolveSessionPath(sessionId: string): string {
    const managed = this.clients.get(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  private buildMessagesFromJsonl(
    _entries: Array<{ id: string; parentId: string | null; type: string }>,
    _leafId: string | null,
  ): unknown[] {
    return [];
  }

  async getState(sessionId: string): Promise<{
    model?: {
      id: string;
      name?: string;
      provider?: string;
      reasoning?: boolean;
      contextWindow: number;
      maxTokens: number;
    };
    thinkingLevel?: string;
    isStreaming: boolean;
    isCompacting: boolean;
    messageCount: number;
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;

    try {
      const state = await managed.client.getState();
      const model = state.model;
      return {
        model: model
          ? {
              id: String(model.id ?? ""),
              name: model.name ? String(model.name) : undefined,
              provider: model.provider ? String(model.provider) : undefined,
              reasoning: Boolean(model.reasoning),
              contextWindow: Number(model.contextWindow ?? 0),
              maxTokens: Number(model.maxTokens ?? 0),
            }
          : undefined,
        thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
        isStreaming: Boolean(state.isStreaming),
        isCompacting: Boolean(state.isCompacting),
        messageCount: Number(state.messageCount ?? 0),
      };
    } catch {
      return null;
    }
  }

  async getCommands(
    sessionId: string,
  ): Promise<
    Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
  > {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return [];

    try {
      const commands = await managed.client.getCommands();
      if (!commands) return [];
      return commands.map((c) => ({
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
        source: (c.source as "extension" | "prompt" | "skill") ?? "extension",
      }));
    } catch (err: unknown) {
      log.warn("getCommands failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;

    try {
      const stats = await managed.client.getSessionStats();
      if (!stats) return null;
      const tokens = stats.tokens;
      const cu = stats.contextUsage;
      return {
        tokens: {
          input: Number(tokens?.input ?? 0),
          output: Number(tokens?.output ?? 0),
          cacheRead: Number(tokens?.cacheRead ?? 0),
          cacheWrite: Number(tokens?.cacheWrite ?? 0),
          total: Number(tokens?.total ?? 0),
        },
        cost: Number(stats.cost ?? 0),
        contextUsage: cu
          ? {
              tokens: cu.tokens,
              contextWindow: Number(cu.contextWindow ?? 0),
              percent: cu.percent,
            }
          : undefined,
      };
    } catch (err: unknown) {
      log.warn("getSessionStats failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async getMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    const managed = this.getActiveManaged(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const messagesResult = await managed.client.getMessages();
        if (messagesResult) {
          messages = messagesResult;
        }
      } catch (err: unknown) {
        log.warn("getMessages SDK failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const treeResult = await managed.client.getTreeWithLeaf();
        const entries = treeResult.entries;
        const leafId = treeResult.leafId;
        if (Array.isArray(entries) && leafId) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; label?: string }
          >();
          for (const e of entries) {
            byId.set(e.id, e);
          }
          activePathIds = new Set<string>();
          let curId: string | null | undefined = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId =
              node && typeof node.parentId === "string" && node.parentId
                ? node.parentId
                : undefined;
          }
        }
      } catch (err: unknown) {
        log.warn("getTreeWithLeaf failed in getMessages", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      resolvedSessionPath = this.resolveSessionPath(sessionId) ?? sessionPath ?? "";
      const leafId = this.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; customType?: string }
          >();
          for (const e of jsonlEntries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node?.parentId ?? null;
          }
        }
        messages = this.buildMessagesFromJsonl(jsonlEntries, leafId);
      }
    }

    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];
    if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "custom") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (!managed && parsed.type === "message" && parsed.message) {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push(parsed.message);
            }
          } catch (err: unknown) {
            log.debug("skipping malformed JSONL entry", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        rl.close();
      } catch (err: unknown) {
        log.warn("Failed to read entries from JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { messages: messages as AgentMessageForUI[], customEntries };
  }

  async getFullMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    const t0 = performance.now();
    const managed = this.getActiveManaged(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;
    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const result = (await managed.client.getFullMessages()) as {
          messages: unknown[];
          hasMore: boolean;
          totalCount: number;
          nextCursor: string | null;
          tree?: {
            entries: Array<{ id: string; parentId: string | null; type: string; label?: string }>;
            leafId: string | null;
          };
          customEntries?: Array<{
            id: string;
            customType: string;
            data: unknown;
            timestamp: number;
          }>;
          compactionEntries?: Array<{
            id: string;
            summary: string;
            tokensBefore: number | undefined;
            timestamp: number;
          }>;
        };
        log.info("getFullMessages SDK result", {
          count: result?.messages?.length ?? 0,
          hasMore: result?.hasMore,
          totalCount: result?.totalCount,
        });
        if (result?.messages) {
          messages = result.messages;
        }
        if (result?.tree) {
          const treeEntries = result.tree.entries;
          const leafId = result.tree.leafId;
          if (Array.isArray(treeEntries) && leafId) {
            const byId = new Map<
              string,
              { id: string; parentId: string | null; type: string; label?: string }
            >();
            for (const e of treeEntries) byId.set(e.id, e);
            activePathIds = new Set<string>();
            let curId: string | null | undefined = leafId;
            while (curId) {
              activePathIds.add(curId);
              const node = byId.get(curId);
              curId =
                node && typeof node.parentId === "string" && node.parentId
                  ? node.parentId
                  : undefined;
            }
            // Filter messages by active path: message entries in tree correspond 1:1 with messages array
            const messageTreeEntries = treeEntries.filter((e) => e.type === "message");
            if (activePathIds.size > 0 && messageTreeEntries.length > 0) {
              const filtered: unknown[] = [];
              for (let i = 0; i < messageTreeEntries.length && i < messages.length; i++) {
                if (activePathIds.has(messageTreeEntries[i].id)) {
                  filtered.push(messages[i]);
                }
              }
              log.info("getMessages filtered by tree path", {
                before: messages.length,
                after: filtered.length,
                treeMsgEntries: messageTreeEntries.length,
                activePathSize: activePathIds.size,
              });
              messages = filtered;
            }
          }
        }
        if (Array.isArray(result?.customEntries)) {
          for (const ce of result.customEntries) {
            if (activePathIds && !activePathIds.has(ce.id)) continue;
            customEntries.push({
              id: ce.id,
              customType: ce.customType ?? "unknown",
              data: ce.data,
              timestamp: ce.timestamp,
            });
          }
        }
        if (Array.isArray(result?.compactionEntries)) {
          for (const comp of result.compactionEntries) {
            if (activePathIds && !activePathIds.has(comp.id)) continue;
            messages.push({
              id: comp.id,
              role: "compactionSummary",
              summary: comp.summary ?? "",
              tokensBefore: comp.tokensBefore,
              timestamp: comp.timestamp,
            });
          }
        }
      } catch (err: unknown) {
        log.error("getFullMessages SDK failed, falling back to getMessages", {
          err: err instanceof Error ? err.message : String(err),
        });
        try {
          const fallback = await managed.client.getMessages();
          if (fallback) messages = fallback;
        } catch (err: unknown) {
          log.warn("getMessages fallback also failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      resolvedSessionPath = this.resolveSessionPath(sessionId) ?? sessionPath ?? "";
      const leafId = this.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; customType?: string }
          >();
          for (const e of jsonlEntries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node?.parentId ?? null;
          }
        }
        messages = this.buildMessagesFromJsonl(jsonlEntries, leafId);
      }
    }

    if (!managed && resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "custom") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "message" && parsed.message) {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push(parsed.message);
            }
          } catch (err: unknown) {
            log.debug("skipping malformed JSONL entry", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        rl.close();
      } catch (err: unknown) {
        log.warn("Failed to read entries from JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totalMs = Math.round(performance.now() - t0);
    perfLog.info("[getFullMessages] done", {
      sessionId,
      messageCount: messages.length,
      customEntryCount: customEntries.length,
      totalMs,
    });

    return { messages: messages as AgentMessageForUI[], customEntries };
  }

  async getAvailableModels(
    sessionId: string,
  ): Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return [];
    return managed.client.getAvailableModels().catch((err: unknown) => {
      log.warn("getAvailableModels error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    });
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<{ provider: string; id: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.setModel(provider, modelId);
  }

  async cycleModel(sessionId: string): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    return managed.client.cycleModel().catch((err: unknown) => {
      log.warn("cycleModel error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client
      .setThinkingLevel(level as Parameters<typeof managed.client.setThinkingLevel>[0])
      .catch((err: unknown) => {
        log.warn("setThinkingLevel error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async cycleThinkingLevel(sessionId: string): Promise<{ level: string } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    return managed.client.cycleThinkingLevel().catch((err: unknown) => {
      log.warn("cycleThinkingLevel error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }

  async compact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<{ summary: string; tokensBefore: number }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.compact(customInstructions);
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setAutoCompaction(enabled).catch((err: unknown) => {
      log.warn("setAutoCompaction error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setAutoRetry(enabled).catch((err: unknown) => {
      log.warn("setAutoRetry error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async abortRetry(sessionId: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.abortRetry().catch((err: unknown) => {
      log.warn("abortRetry error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setSteeringMode(mode as "all" | "one-at-a-time").catch((err: unknown) => {
      log.warn("setSteeringMode error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setFollowUpMode(mode as "all" | "one-at-a-time").catch((err: unknown) => {
      log.warn("setFollowUpMode error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getActiveTools(sessionId: string): Promise<{ toolNames: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { toolNames: [] };
    try {
      const result = await managed.client.getActiveTools();
      return { toolNames: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getActiveTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { toolNames: [] };
    }
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setActiveTools(toolNames).catch((err: unknown) => {
      log.warn("setActiveTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.getQueue().catch((err: unknown) => {
      log.warn("getQueue error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { steering: [], followUp: [] };
    });
  }

  async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.clearQueue().catch((err: unknown) => {
      log.warn("clearQueue error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { steering: [], followUp: [] };
    });
  }

  async getExtensions(sessionId: string): Promise<{
    extensions: Array<{
      path: string;
      resolvedPath: string;
      toolNames: string[];
      commandNames: string[];
    }>;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { extensions: [] };
    try {
      const result = await managed.client.getExtensions();
      return { extensions: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getExtensions error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { extensions: [] };
    }
  }

  async getSkills(sessionId: string): Promise<{
    skills: Array<{
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      disableModelInvocation: boolean;
    }>;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { skills: [] };
    try {
      const result = await managed.client.getSkills();
      return { skills: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getSkills error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { skills: [] };
    }
  }

  async reload(sessionId: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.reload();
  }

  async getTools(
    sessionId: string,
  ): Promise<{ tools: Array<{ name: string; label: string; description: string }> }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { tools: [] };
    try {
      const result = await managed.client.getTools();
      return { tools: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { tools: [] };
    }
  }

  async getMcpServers(sessionId: string): Promise<{ servers: McpServerInfo[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { servers: [] };
    try {
      const servers = await managed.client.getMcpServers();
      return { servers: Array.isArray(servers) ? servers : [] };
    } catch (err) {
      log.warn("getMcpServers error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { servers: [] };
    }
  }

  async toggleMcpServer(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { success: false, error: "Client not found" };
    try {
      await managed.client.toggleMcpServer(name, enabled);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("toggleMcpServer error", { sessionId, err: msg });
      return { success: false, error: msg };
    }
  }

  async restartMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { success: false, error: "Client not found" };
    try {
      await managed.client.restartMcpServer(name);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("restartMcpServer error", { sessionId, err: msg });
      return { success: false, error: msg };
    }
  }

  async getContextUsage(
    sessionId: string,
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { tokens: null, contextWindow: 0, percent: null };
    return managed.client.getContextUsage().catch((err: unknown) => {
      log.warn("getContextUsage error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { tokens: null, contextWindow: 0, percent: null };
    });
  }

  async getTierModels(sessionId: string): Promise<{ models: Record<string, string> }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { models: {} };
    const response = await (
      managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
    )
      .send({ type: "get_tier_models" })
      .catch((err: unknown) => {
        log.warn("getTierModels error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    if (!response) return { models: {} };
    const data = (response as { data?: { models: Record<string, string> } }).data;
    return { models: data?.models ?? {} };
  }

  async setTierModels(sessionId: string, models: Record<string, string>): Promise<{ ok: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { ok: false };
    await (managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> })
      .send({ type: "set_tier_models", models })
      .catch((err: unknown) => {
        log.warn("setTierModels error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return { ok: true };
  }

  async getAgents(sessionId: string): Promise<{
    agents: Array<{
      name: string;
      description?: string;
      tier?: string;
      tools?: string[];
      permissionMode?: string;
      source: string;
      filePath: string;
    }>;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { agents: [] };
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_agents" });
      const data = (
        response as {
          data?: {
            agents: Array<{
              name: string;
              description?: string;
              tier?: string;
              tools?: string[];
              permissionMode?: string;
              source?: string;
              filePath?: string;
            }>;
          };
        }
      ).data;
      return {
        agents: (data?.agents ?? []).map((a) => ({
          ...a,
          source: a.source ?? "builtin",
          filePath: a.filePath ?? "",
        })),
      };
    } catch (err: unknown) {
      log.warn("getAgents error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { agents: [] };
    }
  }

  async switchAgent(
    sessionId: string,
    agentName: string,
  ): Promise<{
    agentName: string;
    tools: string[];
    tier?: string;
    thinkingLevel?: string;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("No agent process for session");
    const response = await (
      managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
    ).send({ type: "switch_agent", agentName });
    const data = (
      response as {
        data?: { agentName: string; tools: string[]; tier?: string; thinkingLevel?: string };
      }
    ).data;
    if (!data) throw new Error("switch_agent returned no data");
    return data;
  }

  async getCurrentAgent(sessionId: string): Promise<{ agentName: string | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { agentName: null };
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_current_agent" });
      const data = (response as { data?: { agentName: string | null } }).data;
      return { agentName: data?.agentName ?? null };
    } catch (err: unknown) {
      log.warn("getCurrentAgent error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { agentName: null };
    }
  }

  async getAgentDetail(sessionId: string, agentName: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return (
      managed.client as unknown as {
        getAgentDetail: (name: string) => Promise<unknown>;
      }
    ).getAgentDetail(agentName);
  }

  async getAllTools(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return (
      managed.client as unknown as {
        getAllTools: () => Promise<unknown>;
      }
    ).getAllTools();
  }

  async getSystemPrompt(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error(`No client for session ${sessionId}`);
    return (
      managed.client as unknown as {
        getSystemPrompt: () => Promise<unknown>;
      }
    ).getSystemPrompt();
  }

  async getLatestAgentChange(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_latest_agent_change" });
      const data = (
        response as {
          data?: {
            agentName: string;
            agentConfig?: Record<string, unknown>;
            timestamp: string;
          } | null;
        }
      ).data;
      return data ?? null;
    } catch (err: unknown) {
      log.warn("getLatestAgentChange error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async getSettings(sessionId: string, scope?: string): Promise<Record<string, unknown>> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return {};
    return managed.client
      .getSettings(scope as "global" | "project" | undefined)
      .then((s) => s as unknown as Record<string, unknown>)
      .catch((err: unknown) => {
        log.warn("getSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {};
      });
  }

  async setSettings(
    sessionId: string,
    settings: Record<string, unknown>,
    scope?: string,
  ): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client
      .setSettings(settings, scope as "global" | "project" | undefined)
      .catch((err: unknown) => {
        log.warn("setSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const projectPath = managed.info.projectPath;
    await managed.client.setSessionName(name).catch((err: unknown) => {
      log.warn("setSessionName error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    this.broadcastEvent(
      "agent.session_renamed",
      { sessionId, projectPath, newName: name },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session_renamed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getLastAssistantText(sessionId: string): Promise<{ text: string | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { text: null };
    try {
      const result = await managed.client.getLastAssistantText();
      return { text: result };
    } catch (err: unknown) {
      log.warn("getLastAssistantText error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { text: null };
    }
  }

  async getForkMessages(
    sessionId: string,
  ): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { messages: [] };
    try {
      const result = await managed.client.getForkMessages();
      return { messages: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getForkMessages error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { messages: [] };
    }
  }

  async fork(
    sessionId: string,
    entryId: string,
    options?: { position?: "before" | "at" },
  ): Promise<{
    text: string;
    cancelled: boolean;
    newSessionFile?: string;
    newSessionId?: string;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    const result = await managed.client.fork(entryId, options);
    // Don't stop the original session — the process pool's switchSession
    // will handle the transition when the forked session is started.
    // The original session remains on disk and can be re-activated later.
    // Strip parentSession from forked session so it's treated as independent on refresh
    if (result.newSessionFile && !result.cancelled) {
      stripParentSessionFromHeader(result.newSessionFile);
    }
    return result;
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<{ cancelled: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      const result = await managed.client.navigateTree(targetId, options);
      if (!result.cancelled) {
        this.leafIds.set(sessionId, targetId);
        log.info("navigateTree updated leafId", { sessionId, targetId });
      }
      return result;
    }
    log.warn("navigateTree: no managed client, rollback will not take effect", {
      sessionId,
      targetId,
    });
    return { cancelled: true };
  }

  async previewRollback(
    sessionId: string,
    targetId: string,
  ): Promise<{ restored: string[]; deleted: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      return managed.client.previewRollback(targetId);
    }
    return { restored: [], deleted: [] };
  }

  async getModifiedFiles(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
  ): Promise<
    Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      turnIndex: number;
      entryId: string;
    }>
  > {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      return managed.client.getModifiedFiles({ fromEntryId, toEntryId });
    }
    return [];
  }

  async getBatchDiffs(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
  ): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      diff: {
        path: string;
        oldContent: string | null;
        newContent: string | null;
        unifiedDiff: string;
      } | null;
    }>;
    summary: { totalFiles: number; added: number; modified: number; deleted: number };
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      return managed.client.getBatchDiffs({ fromEntryId, toEntryId });
    }
    return { files: [], summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 } };
  }

  async getTree(sessionId: string): Promise<{ entries: TreeEntry[]; leafId?: string | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      try {
        const result = await managed.client.getTree();
        return {
          entries: Array.isArray(result.entries) ? (result.entries as TreeEntry[]) : [],
          leafId: result.leafId,
        };
      } catch (err: unknown) {
        log.warn("getTree SDK failed, falling back to JSONL", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const sessionPath = this.resolveSessionPath(sessionId);
    if (!sessionPath) throw new Error("Client not found and no session path");
    const entries = await this.readJsonlEntries(sessionPath);
    return {
      entries: entries.map((e) => ({
        id: e.id,
        parentId: e.parentId,
        type: e.type,
        label: e.label,
      })),
      leafId: this.leafIds.get(sessionId) ?? null,
    };
  }

  async restoreFilesFromSnapshot(
    sessionId: string,
    snapshotTreeHash: string,
    files?: string[],
  ): Promise<string[]> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");

    const result = (await managed.client
      .channel("file-snapshot")
      .call("snapshot.restoreByHash", { snapshotTreeHash, files })) as {
      restored: string[];
    } | null;

    return result?.restored ?? [];
  }

  async clone(sessionId: string): Promise<{ cancelled: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.clone();
  }

  async newSession(sessionId: string, parentSession?: string): Promise<{ cancelled: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.newSession(parentSession);
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<{ path: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.exportHtml(outputPath);
  }

  sendChannelData(sessionId: string, channelName: string, data: unknown): void {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const ch = managed.client.channel(channelName);
    ch.send(data);
  }

  callChannel<CN extends keyof ChannelTypeRegistry, MN extends ChannelMethodKeys<CN>>(
    sessionId: string,
    channelName: CN,
    method: MN,
    params: ChannelMethodParams<CN, MN>,
  ): Promise<ChannelMethodReturn<CN, MN>>;

  callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  async callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;

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
      if (ch.name === "rules-engine") {
        this.handleRulesChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "memory") {
        this.handleMemoryChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "supervisor") {
        this.handleSupervisorChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "coordinator") {
        log.warn(
          "coordinator channel_data reached handleEvent — should have been intercepted in start()",
          { sessionId },
        );
        return;
      }
    }

    if (event.type === "extension_ui_request") {
      const ui = event as ExtensionUIRequestEvent;
      const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
      if (ui.method === "notify") {
        this.broadcastEvent(
          "agent.notify",
          {
            sessionId,
            message: ui.message ?? "",
            notifyType: ui.notifyType ?? "info",
          },
          { sessionId },
        ).catch((err: unknown) => {
          log.warn("broadcastEvent(agent.notify) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
        return;
      }
      if (!INTERACTIVE_METHODS.has(ui.method)) return;
    }

    if (event.type === "agent_start") {
      managed.info.status = "streaming";
      managed.info.holdEvents = [];
      this.broadcastSessionStatus(sessionId, "streaming");
    }

    if (event.type === "agent_end") {
      managed.info.status = "idle";
      managed.info.holdEvents = [];
      this.broadcastSessionStatus(sessionId, "idle");

      const resolver = this.syncDelegateResolvers.get(sessionId);
      if (resolver) {
        clearTimeout(resolver.timeout);
        this.syncDelegateResolvers.delete(sessionId);
        this.subagentSyncChildren.delete(sessionId);
        const finalText = this.syncDelegateLastText.get(sessionId) ?? "(completed)";
        this.syncDelegateLastText.delete(sessionId);
        resolver.resolve({
          sessionId,
          status: "completed",
          exitCode: 0,
          finalText: finalText || "(completed)",
        });
      }
    }

    if (event.type === "session_info_changed") {
      const name = (event as Record<string, unknown>).name;
      if (typeof name === "string" && name.length > 0) {
        const projectPath = managed.info.projectPath;
        this.broadcastEvent(
          "agent.session_renamed",
          { sessionId, projectPath, newName: name },
          {},
        ).catch((err: unknown) => {
          log.warn("broadcastEvent(session_renamed from info_changed) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return;
    }

    if (event.type === "message_end") {
      managed.info.holdEvents = [];
      if (this.subagentSyncChildren.has(sessionId)) {
        const msgEvent = event as {
          type: "message_end";
          message: { content?: Array<{ type: string; text?: string }> };
        };
        const msg = msgEvent.message;
        if (Array.isArray(msg?.content)) {
          const text = msg.content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
            .slice(0, 2000);
          if (text) this.syncDelegateLastText.set(sessionId, text);
        }
      }
    }

    if (event.type === "message_update") {
      managed.info.status = "streaming";
    }

    const sanitized = sanitizeEvent(event);

    if (managed.info.status === "streaming") {
      managed.info.holdEvents.push(sanitized);
    }

    const parentId = this.findParentSession(sessionId);
    if (parentId) {
      this.broadcastEvent(
        "coordinator.session_event",
        {
          parentSessionId: parentId,
          childSessionId: sessionId,
          event: sanitized,
        },
        { parentSessionId: parentId },
      ).catch((err: unknown) => {
        log.warn("broadcastEvent(coordinator.session_event) error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });

      if (this.subagentSyncChildren.has(sessionId) && event.type !== "channel_data") {
        const parentManaged = this.clients.get(parentId);
        this.broadcastEvent(
          "subagent.event",
          {
            parentSessionId: parentId,
            parentSessionPath: parentManaged?.info.sessionPath ?? "",
            subSessionId: sessionId,
            event: sanitized,
          },
          { parentSessionId: parentId },
        ).catch(() => {});
      }
    }

    this.emitAgentEvent(sessionId, sanitized);
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as SubagentChannelPayload | undefined;
    if (!data) return;

    const { event: subEvent, sessionId: subSessionId } = data;
    if (!subEvent || !subSessionId) return;

    const eventType = subEvent.type as string;
    if (eventType === "response") return;

    const managed = this.clients.get(parentSessionId);
    const sessionPath = managed?.info.sessionPath ?? "";

    if (eventType === "message_end" && subEvent.message) {
      const msg = subEvent.message as { content?: Array<{ type: string; text?: string }> };
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            log.info("Subagent final text", {
              parentSessionId,
              subSessionId,
              textLength: part.text?.length,
            });
          }
        }
      }
    }

    await this.broadcastEvent(
      "subagent.event",
      { parentSessionId, parentSessionPath: sessionPath, subSessionId, event: subEvent },
      { parentSessionId },
    );
  }

  private async handleTodoChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as TodoChannelEvent | undefined;
    if (!data) return;

    log.info("Todo channel data", { sessionId, action: data.action, count: data.todos?.length });

    await this.broadcastEvent(
      "todo.event",
      { sessionId, action: data.action, todos: data.todos, timestamp: data.timestamp },
      { sessionId },
    );
  }

  private async handleBashChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as BashChannelEvent | undefined;
    if (!data) return;

    log.info("Bash channel data", { sessionId, type: data.type, toolCallId: data.toolCallId });

    await this.broadcastEvent("bash.event", { sessionId, event: data }, { sessionId });
  }

  private async handleSupervisorChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    log.info("Supervisor channel data", { sessionId, type: data.type });

    await this.broadcastEvent("supervisor.event", { sessionId, event: data }, { sessionId });
  }

  private async handleLspChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as LspChannelEvent | undefined;
    if (!data) return;

    // Enhanced LSP logging for diagnostics review
    const lspLogData: Record<string, unknown> = {
      sessionId,
      event: data.event,
    };
    if (data.serverName) lspLogData.serverName = data.serverName;
    if (data.totalServers != null) lspLogData.totalServers = data.totalServers;
    if (data.servers?.length) lspLogData.serverCount = data.servers.length;
    if (data.mode) lspLogData.mode = data.mode;
    if (data.languages?.length) lspLogData.languages = data.languages;
    if (data.filePath) lspLogData.filePath = data.filePath;
    if (data.diagnostics)
      lspLogData.diagnosticsCount = Array.isArray(data.diagnostics)
        ? data.diagnostics.length
        : Object.keys(data.diagnostics).length;
    if (data.error) lspLogData.error = data.error;
    // Derive aggregate state for startup/status events
    if (data.servers?.length) {
      const anyReady = data.servers.some((s: { state?: string }) => s.state === "ready");
      const anyError = data.servers.some((s: { state?: string }) => s.state === "error");
      lspLogData.aggregateState = anyReady ? "ready" : anyError ? "error" : "starting";
    }
    log.info("LSP channel data", lspLogData);

    if (data.event === "startup_complete" || data.event === "status_changed") {
      const servers = (data.servers ?? []) as Array<{
        state?: string;
        status?: { state?: string };
      }>;
      const cached = this.lastLspState.get(sessionId);
      this.lastLspState.set(sessionId, {
        state: servers.some((s) => s.state === "ready" || s.status?.state === "ready")
          ? "ready"
          : servers.some((s) => s.state === "error" || s.status?.state === "error")
            ? "error"
            : servers.length > 0
              ? "starting"
              : "inactive",
        servers: data.servers ?? [],
        activeLanguages: cached?.activeLanguages ?? [],
      });
    }
    if (data.event === "mode_changed" && data.mode) {
      const cached = this.lastLspState.get(sessionId);
      if (cached) cached.mode = data.mode;
    }
    if (data.event === "language_activated" && data.languages?.length) {
      const cached = this.lastLspState.get(sessionId);
      if (cached) {
        cached.activeLanguages = Array.from(
          new Set([...(cached.activeLanguages ?? []), ...data.languages]),
        );
      }
    }
  }

  private async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as RulesChannelEvent;
    if (!data) return;

    log.info("Rules channel data", { sessionId, type: data.type });

    await this.broadcastEvent("rules.event", { sessionId, event: data }, { sessionId });
  }

  private async handleMemoryChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    const eventType = data.type as string;
    log.info("Memory channel data", { sessionId, type: eventType });

    if (eventType === "bookmark_creating") {
      await this.broadcastEvent(
        "memory.bookmark_creating",
        { sessionId, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_updated") {
      await this.broadcastEvent(
        "memory.updated",
        { sessionId, files: data.files, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_update_failed") {
      await this.broadcastEvent(
        "memory.update_failed",
        { sessionId, reason: data.reason, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_irrelevant_marked") {
      await this.broadcastEvent(
        "memory.memory_irrelevant_marked",
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch" ||
      eventType === "memory_extract" ||
      eventType === "memory_dream"
    ) {
      await this.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch_result" ||
      eventType === "memory_extract_result" ||
      eventType === "memory_dream_result"
    ) {
      await this.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    }
  }

  private async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    const msg = data as CoordinatorChannelEvent;

    if (!("__call" in msg)) {
      this.broadcastEvent("coordinator.event", { sessionId, event: msg }, { sessionId }).catch(
        (err: unknown) => {
          log.warn("broadcastEvent(coordinator.event) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        },
      );
      return;
    }

    const { __call: method, invokeId } = msg;
    let result: unknown;
    try {
      switch (method) {
        case "session_delegate":
          if (this._startInProgress) {
            // Queue the request — will be processed after current start() finishes
            log.info("[coordinator] session_delegate queued (start in progress)", { sessionId });
            result = await new Promise<unknown>((resolve) => {
              this._pendingDelegateRequests.push({ sessionId, msg, channelName, resolve });
            });
          } else {
            result = await this.handleCoordinatorDelegate(sessionId, msg);
          }
          break;
        case "session_delegate_send":
          result = await this.handleCoordinatorDelegateSend(msg);
          break;
        case "session_delegate_sync":
          if (this._startInProgress) {
            log.info("[coordinator] session_delegate_sync queued (start in progress)", {
              sessionId,
            });
            result = await new Promise<unknown>((resolve) => {
              this._pendingDelegateRequests.push({ sessionId, msg, channelName, resolve });
            });
          } else {
            result = await this.handleCoordinatorDelegateSync(sessionId, msg);
          }
          break;
        case "session_delegate_status":
          result = await this.handleCoordinatorDelegateStatus(msg);
          break;
        case "session_delegate_list":
          result = this.handleCoordinatorDelegateList(sessionId);
          break;
        case "session_delegate_stop":
          result = await this.handleCoordinatorDelegateStop(sessionId, msg);
          break;
        case "session_delegate_fork":
          result = await this.handleCoordinatorDelegateFork(sessionId, msg);
          break;
        default:
          if (method === "session_delegate_clear_stopped") {
            result = this.handleCoordinatorClearStopped(msg);
          } else if (method === "session_delegate_remove") {
            result = this.handleCoordinatorRemove(sessionId, msg);
          } else {
            log.warn("Unknown coordinator method", { sessionId, method });
            return;
          }
      }
    } catch (err: unknown) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }

    if (invokeId) {
      let managed = this.getActiveManaged(sessionId);
      // The session may have been evicted from clients during an async handler
      // (e.g. delegate_send restarts the target, switching the pooled process).
      // Fall back to processByCwd via sessionProjectPaths to find the channel.
      if (!managed) {
        const projectPath = this.sessionProjectPaths.get(sessionId) ?? "";
        if (projectPath) {
          managed = this.processByCwd.get(projectPath) ?? null;
          if (managed && managed._activeSessionId !== sessionId) {
            log.warn(
              "handleCoordinatorCall: processByCwd fallback _activeSessionId mismatch, dropping response",
              {
                sessionId,
                activeSessionId: managed._activeSessionId,
                projectPath,
              },
            );
            managed = null;
          } else if (managed) {
            log.info("handleCoordinatorCall: routed response via processByCwd fallback", {
              sessionId,
              projectPath,
              activeSession: managed._activeSessionId,
            });
          }
        }
      }
      if (managed) {
        managed.client.channel(channelName).send({ ...(result as object), invokeId });
      }
    }
  }

  private handleCoordinatorClearStopped(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
  ): { cleared: string[] } {
    const targetSessionId = (msg as Record<string, unknown>).sessionId as string | undefined;
    const cleared: string[] = [];
    if (targetSessionId) {
      this.delegateCreatedAt.delete(targetSessionId);
      this.delegateReplyCount.delete(targetSessionId);
      cleared.push(targetSessionId);
    }
    return { cleared };
  }

  private handleCoordinatorRemove(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_remove" }>,
  ): { removed: boolean } {
    const targetSessionId = (msg as Record<string, unknown>).targetSessionId as string | undefined;
    if (!targetSessionId) return { removed: false };

    const children = this.parentChildMap.get(parentSessionId);
    if (children) {
      children.delete(targetSessionId);
      if (children.size === 0) this.parentChildMap.delete(parentSessionId);
    }
    this.delegateCreatedAt.delete(targetSessionId);
    this.delegateReplyCount.delete(targetSessionId);
    this.stop(targetSessionId);
    return { removed: true };
  }

  private async handleCoordinatorDelegate(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
    const { task } = msg;
    const parent = this.getActiveManaged(parentSessionId);
    if (!parent) throw new Error("Parent session not found");

    const projectPath = parent.info.projectPath;
    const newSessionId = `sess_coord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = path.dirname(parent.info.sessionPath);
    const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

    const result = await this.start(newSessionId, projectPath, sessionPath, {
      forceNewProcess: true,
    });

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    // Register parent-child relationship
    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = msg.title ?? task.slice(0, 60);
    const title = `指派: ${rawTitle}`;
    await this.setSessionName(newSessionId, title);
    const delegatePrompt = [
      `[系统提示] 你是一个被委派的后台任务会话。`,
      ``,
      `**你的身份信息：**`,
      `- 你的会话 ID: ${newSessionId}`,
      `- 委派方（父会话）ID: ${parentSessionId}`,
      `- 任务: ${title}`,
      `- 项目路径: ${projectPath}`,
      ``,
      `**要求：**`,
      `1. 你是独立执行任务的助手，专注于完成委派给你的任务`,
      `2. 执行完毕后，请明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，请说明原因`,
      `4. 如需向委派方反馈中间进度或最终结果，请使用 session_delegate_send 工具：`,
      `   - targetSessionId: ${parentSessionId}`,
      `   - message: 你要反馈的内容`,
      ``,
      `---`,
      ``,
      task,
    ].join("\n");

    this.send(newSessionId, delegatePrompt);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: newSessionId,
          name: title,
          sessionPath,
          projectPath,
          parentSessionPath: parent.info.sessionPath,
          delegateParentSessionId: parentSessionId,
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { sessionId: newSessionId, status: result.status };
  }

  private async handleCoordinatorDelegateSync(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
  ): Promise<{
    sessionId: string;
    status: string;
    exitCode: number;
    finalText: string;
    error?: string;
  }> {
    const { task, title, agent, timeoutMs = 300000 } = msg;
    const parent = this.getActiveManaged(parentSessionId);
    if (!parent) throw new Error("Parent session not found");

    const projectPath = parent.info.projectPath;
    const newSessionId = `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = path.dirname(parent.info.sessionPath);
    const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

    try {
      const { writeFile } = await import("fs/promises");
      const headerEntry = JSON.stringify({
        type: "session",
        version: 3,
        id: newSessionId,
        timestamp: new Date().toISOString(),
        cwd: projectPath,
        delegateParentSessionId: parentSessionId,
      });
      await writeFile(sessionPath, headerEntry + "\n", "utf-8");
    } catch (writeErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] failed to write session header", {
        sessionPath,
        err: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }

    await this.start(newSessionId, projectPath, sessionPath, { forceNewProcess: true });

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = title ?? task.slice(0, 60);
    const sessionTitle = `子代理: ${rawTitle}`;
    await this.setSessionName(newSessionId, sessionTitle);

    const delegatePrompt = [
      `[系统提示] 你是一个子代理任务会话。`,
      agent ? `**Agent 角色:** ${agent}` : "",
      `**任务:** ${rawTitle}`,
      ``,
      `要求：`,
      `1. 专注于完成委派给你的任务`,
      `2. 执行完毕后，明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，说明原因`,
      ``,
      `---`,
      ``,
      task,
    ]
      .filter(Boolean)
      .join("\n");

    this.subagentSyncChildren.add(newSessionId);

    const syncPromise = new Promise<{
      sessionId: string;
      status: string;
      exitCode: number;
      finalText: string;
      error?: string;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        this.syncDelegateResolvers.delete(newSessionId);
        this.subagentSyncChildren.delete(newSessionId);
        this.syncDelegateLastText.delete(newSessionId);
        resolve({
          sessionId: newSessionId,
          status: "timeout",
          exitCode: 1,
          finalText: "(timed out)",
        });
      }, timeoutMs);

      this.syncDelegateResolvers.set(newSessionId, {
        resolve,
        timeout,
        parentSessionId,
      });
    });

    this.send(newSessionId, delegatePrompt);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: newSessionId,
          name: rawTitle,
          sessionPath,
          projectPath,
          parentSessionPath: parent.info.sessionPath,
          delegateParentSessionId: parentSessionId,
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId,
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    this.broadcastEvent(
      "subagent.event",
      {
        parentSessionId,
        parentSessionPath: parent.info.sessionPath,
        subSessionId: newSessionId,
        event: {
          type: "subagent_start",
          toolCallId: "",
          description: rawTitle,
          instruction: task,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(subagent_start) error", {
        parentSessionId,
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    const syncResult = await syncPromise;

    this.stop(newSessionId);

    const syncChildren = this.parentChildMap.get(parentSessionId);
    if (syncChildren) {
      syncChildren.delete(newSessionId);
      if (syncChildren.size === 0) this.parentChildMap.delete(parentSessionId);
    }

    return syncResult;
  }

  private async handleCoordinatorDelegateSend(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
  ): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
    const { targetSessionId, message } = msg;

    let target = this.clients.get(targetSessionId);

    // Not active — attempt restart, like clicking a session in the UI.
    // Session truly "not found" only if the file was physically deleted.
    if (!target) {
      const sessionPath = this.sessionPaths.get(targetSessionId) ?? "";
      const projectPath = this.sessionProjectPaths.get(targetSessionId) ?? "";
      if (sessionPath && projectPath && existsSync(sessionPath)) {
        try {
          const result = await this.start(targetSessionId, projectPath, sessionPath);
          target = this.clients.get(targetSessionId);
          if (target) {
            log.info("handleCoordinatorDelegateSend: restarted inactive session", {
              targetSessionId,
              status: result.status,
            });
          }
        } catch (err: unknown) {
          log.warn("handleCoordinatorDelegateSend: failed to restart session", {
            targetSessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!target) {
        return { delivered: false, targetStatus: "not_found" };
      }
    }

    const count = (this.delegateReplyCount.get(targetSessionId) ?? 0) + 1;
    this.delegateReplyCount.set(targetSessionId, count);

    const createdAt = this.delegateCreatedAt.get(targetSessionId) ?? Date.now();
    const elapsedMs = Date.now() - createdAt;
    const elapsed =
      elapsedMs < 60000 ? `${Math.round(elapsedMs / 1000)}s` : `${Math.round(elapsedMs / 60000)}m`;

    const parentSessionId = this.findParentSession(targetSessionId);
    let title = "";
    if (parentSessionId) {
      const parent = this.clients.get(parentSessionId);
      if (parent) {
        title = target.info.sessionPath.split("/").pop()?.replace(".jsonl", "") ?? "";
      }
    }

    const wrappedMessage = [
      `<delegate-reply from="${targetSessionId}" title="${title}" sequence="${count}" createdAt="${createdAt}" elapsed="${elapsed}" historyCount="${count}">`,
      message,
      `</delegate-reply>`,
    ].join("\n");

    if (msg.mode === "steer") {
      this.steer(targetSessionId, wrappedMessage);
    } else if (msg.mode === "followUp" || target.info.status === "streaming") {
      this.followUp(targetSessionId, wrappedMessage);
    } else {
      this.send(targetSessionId, wrappedMessage);
    }

    return { delivered: true, targetStatus: "active" };
  }

  private async handleCoordinatorDelegateStatus(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
  ): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
    const { sessionId: targetSessionId } = msg;

    const status = this.getStatus(targetSessionId);
    if (status.status === "stopped") {
      return {
        status: "stopped",
        isCompacting: false,
        contextUsage: { tokens: null, contextWindow: 0, percent: null },
      };
    }

    const state = await this.getState(targetSessionId);
    const contextUsage = await this.getContextUsage(targetSessionId);

    return {
      status: state?.isStreaming ? "streaming" : "idle",
      isCompacting: state?.isCompacting ?? false,
      contextUsage,
    };
  }

  private handleCoordinatorDelegateList(parentSessionId: string): {
    sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
  } {
    const children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      return { sessions: [] };
    }
    const sessions: Array<{ sessionId: string; status: string; projectPath: string }> = [];
    for (const childId of children) {
      const managed = this.clients.get(childId);
      if (managed) {
        sessions.push({
          sessionId: childId,
          status: managed.info.status,
          projectPath: managed.info.projectPath,
        });
      }
    }
    return { sessions };
  }

  private async handleCoordinatorDelegateStop(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
  ): Promise<{ ok: boolean }> {
    const { sessionId: targetSessionId } = msg;
    // Only allow stopping own children
    const children = this.parentChildMap.get(parentSessionId);
    if (!children || !children.has(targetSessionId)) {
      return { ok: false };
    }
    const ok = this.stop(targetSessionId);
    return { ok };
  }

  private async handleCoordinatorDelegateFork(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
    const { task } = msg;
    const base = this.clients.get(parentSessionId);
    if (!base) throw new Error("Base session not found");

    const sessionPath = base.info.sessionPath;
    const projectPath = base.info.projectPath;
    const sessionDir = path.dirname(sessionPath);

    const forkedSessionId = `sess_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const forkedPath = path.join(sessionDir, `${forkedSessionId}.jsonl`);

    if (existsSync(sessionPath)) {
      copyFileSync(sessionPath, forkedPath);
    }

    // Strip parentSession so the forked session is independent (not a child)
    stripParentSessionFromHeader(forkedPath);

    const result = await this.start(forkedSessionId, projectPath, forkedPath, {
      forceNewProcess: true,
    });

    // Register parent-child relationship
    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(forkedSessionId);

    const title = msg.title ?? task.slice(0, 60);
    await this.setSessionName(forkedSessionId, title);
    this.send(forkedSessionId, task);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: forkedSessionId,
          name: title,
          sessionPath: forkedPath,
          projectPath,
          parentSessionPath: sessionPath,
          delegateParentSessionId: parentSessionId,
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created from fork) error", {
        sessionId: forkedSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { sessionId: forkedSessionId, status: result.status };
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.broadcastEvent("agent.event", { sessionId, event }, { sessionId });
  }

  async sendChannelMessage(
    sessionId: string,
    channelName: string,
    data: unknown,
  ): Promise<unknown> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    try {
      const ch = managed.client.channel(channelName);
      return await ch.invoke(data);
    } catch (err: unknown) {
      log.warn("sendChannelMessage failed", {
        sessionId,
        channelName,
        err: (err as Error).message,
      });
      return null;
    }
  }

  hasSession(sessionId: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    return managed !== undefined;
  }

  getProjectPath(sessionId: string): string | undefined {
    const managed = this.getActiveManaged(sessionId);
    return managed?.info?.projectPath;
  }

  getSessionPath(sessionId: string): string {
    const managed = this.getActiveManaged(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  getCachedLspState(
    sessionId: string,
  ): { state: string; servers: unknown[]; mode?: string } | undefined {
    return this.lastLspState.get(sessionId);
  }
}
