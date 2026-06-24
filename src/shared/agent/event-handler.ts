import type {
  AgentEvent,
  ChannelDataEvent,
  ExtensionUIRequestEvent,
} from "../modules/agent";
import type { AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { TodoChannelEvent } from "../modules/todo";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent } from "../modules/rules";
import type { LearningCandidate, LearningRun, LearningSnapshot } from "../modules/learning";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";
import { classifyExtensionUiRequest } from "./agent-event-lifecycle";

const log = createLogger("agent");

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & {
      partial?: unknown;
    };
    return { ...rest, assistantMessageEvent: ameRest } as SanitizedMessageUpdate;
  }
  return event as SanitizedEvent;
}

interface SubagentChannelPayload {
  sessionId: string;
  event: Record<string, unknown>;
}

export interface ManagedClient {
  client: { getTreeWithLeaf: () => Promise<{ entries: unknown[]; leafId: string | null }> };
  info: {
    status: string;
    projectPath: string;
    sessionPath: string;
    sessionName?: string;
  };
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

export interface AgentEventHandlerDeps {
  broadcastEvent: (method: string, params: unknown, meta?: unknown) => Promise<void>;
  broadcastSessionStatus: (sessionId: string, status: string) => void;
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>;
  getActiveManaged: (sessionId: string) => ManagedClient | undefined;
  findParentSession: (sessionId: string) => string | undefined;
  clients: Map<string, ManagedClient>;
  lastLspState: Map<string, { state: string; servers: unknown[]; mode?: string; activeLanguages?: string[] }>;
  leafIds: Map<string, string | null>;
  syncDelegateResolvers: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (err: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
      parentSessionId: string;
    }
  >;
  syncDelegateLastText: Map<string, string>;
  subagentSyncChildren: Set<string>;
  parentChildMap: Map<string, Set<string>>;
  delegateReplyCount: Map<string, number>;
  delegateCreatedAt: Map<string, number>;
  delegateRepliedSessions: Set<string>;
  sendDelegateFallbackReply: (sessionId: string) => Promise<boolean>;
}

export class AgentEventHandler {
  private deps: AgentEventHandlerDeps;

  constructor(deps: AgentEventHandlerDeps) {
    this.deps = deps;
  }

  handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.deps.getActiveManaged(sessionId);
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
      if (ch.name === "learning") {
        this.handleLearningChannelData(sessionId, ch);
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
      const action = classifyExtensionUiRequest(ui);
      if (action.type === "notify") {
        this.deps.broadcastEvent(
          "agent.notify",
          {
            sessionId,
            ...action.payload,
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
      if (action.type === "ignore") return;
    }

    // Notify user when a plugin/extension triggers an automatic continue
    if (event.type === "auto_continue") {
      const ac = event as { type: "auto_continue"; reason: string; iteration: number };
      this.deps.broadcastEvent(
        "agent.notify",
        {
          sessionId,
          message: `Plugin triggered auto-continue (${ac.reason})`,
          notifyType: "info",
        },
        { sessionId },
      ).catch((err: unknown) => {
        log.warn("broadcastEvent(agent.notify) error for auto_continue", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (event.type === "agent_start") {
      managed.info.status = "streaming";
      managed.lastActiveAt = Date.now();
      this.deps.broadcastSessionStatus(sessionId, "streaming");
    }

    if (event.type === "agent_end") {
      managed.info.status = "idle";
      managed.lastActiveAt = Date.now();
      this.deps.broadcastSessionStatus(sessionId, "idle");

      // Sync leafId from CLI SDK after agent completes, so that subsequent
      // getFullMessages calls (including page refreshes) see the latest leaf.
      if (managed.client) {
        managed.client
          .getTreeWithLeaf()
          .then((treeResult: { entries: unknown[]; leafId: string | null }) => {
            if (treeResult.leafId) {
              this.deps.leafIds.set(sessionId, treeResult.leafId);
            }
          })
          .catch(() => {});
      }

      if (config.sandboxEnabled && managed.info.projectPath) {
        this.deps.broadcastEvent(
          "file.changed",
          {
            changedPath: managed.info.projectPath,
            type: "create",
          },
          { sessionId },
        ).catch(() => {});
      }

      const resolver = this.deps.syncDelegateResolvers.get(sessionId);
      if (resolver) {
        clearTimeout(resolver.timeout);
        this.deps.syncDelegateResolvers.delete(sessionId);
        this.deps.subagentSyncChildren.delete(sessionId);
        const finalText = this.deps.syncDelegateLastText.get(sessionId) ?? "(completed)";
        this.deps.syncDelegateLastText.delete(sessionId);
        resolver.resolve({
          sessionId,
          status: "completed",
          exitCode: 0,
          finalText: finalText || "(completed)",
        });
      }

      const endReason = (event as { reason?: unknown }).reason;
      if (!resolver && !endReason && this.deps.findParentSession(sessionId)) {
        this.deps.sendDelegateFallbackReply(sessionId).catch((err: unknown) => {
          log.warn("sendDelegateFallbackReply error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    if (event.type === "session_info_changed") {
      const name = (event as Record<string, unknown>).name;
      if (typeof name === "string" && name.length > 0) {
        const projectPath = managed.info.projectPath;
        this.deps.broadcastEvent(
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
      if (this.deps.subagentSyncChildren.has(sessionId)) {
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
          if (text) this.deps.syncDelegateLastText.set(sessionId, text);
        }
      }
    }

    if (event.type === "message_update") {
      managed.info.status = "streaming";
    }

    const sanitized = sanitizeEvent(event);

    const parentId = this.deps.findParentSession(sessionId);
    if (parentId) {
      this.deps.broadcastEvent(
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

      if (this.deps.subagentSyncChildren.has(sessionId) && event.type !== "channel_data") {
        const parentManaged = this.deps.clients.get(parentId);
        this.deps.broadcastEvent(
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

    this.deps.emitAgentEvent(sessionId, sanitized);
  }

  async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as SubagentChannelPayload | undefined;
    if (!data) return;

    const { event: subEvent, sessionId: subSessionId } = data;
    if (!subEvent || !subSessionId) return;

    const eventType = subEvent.type as string;
    if (eventType === "response") return;

    const managed = this.deps.clients.get(parentSessionId);
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

    await this.deps.broadcastEvent(
      "subagent.event",
      { parentSessionId, parentSessionPath: sessionPath, subSessionId, event: subEvent },
      { parentSessionId },
    );
  }

  async handleTodoChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as TodoChannelEvent | undefined;
    if (!data) return;

    log.info("Todo channel data", { sessionId, action: data.action, count: data.todos?.length });

    await this.deps.broadcastEvent(
      "todo.event",
      { sessionId, action: data.action, todos: data.todos, timestamp: data.timestamp },
      { sessionId },
    );
  }

  async handleBashChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as BashChannelEvent | undefined;
    if (!data) return;

    log.info("Bash channel data", { sessionId, type: data.type, toolCallId: data.toolCallId });

    const managed = this.deps.clients.get(sessionId);
    if (managed && data.toolCallId) {
      if (data.type === "background") {
        managed.activeBackgroundTools.add(data.toolCallId);
      } else if (data.type === "end" || data.type === "error" || data.type === "terminated") {
        managed.activeBackgroundTools.delete(data.toolCallId);
      }
    }

    await this.deps.broadcastEvent("bash.event", { sessionId, event: data }, { sessionId });
  }

  async handleSupervisorChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    log.info("Supervisor channel data", { sessionId, type: data.type });

    await this.deps.broadcastEvent("supervisor.event", { sessionId, event: data }, { sessionId });
  }

  async handleLspChannelData(
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
      const cached = this.deps.lastLspState.get(sessionId);
      this.deps.lastLspState.set(sessionId, {
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
      const cached = this.deps.lastLspState.get(sessionId);
      if (cached) cached.mode = data.mode;
    }
    if (data.event === "language_activated" && data.languages?.length) {
      const cached = this.deps.lastLspState.get(sessionId);
      if (cached) {
        cached.activeLanguages = Array.from(
          new Set([...(cached.activeLanguages ?? []), ...data.languages]),
        );
      }
    }
  }

  async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as RulesChannelEvent;
    if (!data) return;

    log.info("Rules channel data", { sessionId, type: data.type });

    await this.deps.broadcastEvent("rules.event", { sessionId, event: data }, { sessionId });
  }

  async handleMemoryChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    const eventType = data.type as string;
    log.info("Memory channel data", { sessionId, type: eventType });

    if (eventType === "bookmark_creating") {
      await this.deps.broadcastEvent(
        "memory.bookmark_creating",
        { sessionId, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_updated") {
      await this.deps.broadcastEvent(
        "memory.updated",
        { sessionId, files: data.files, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_update_failed") {
      await this.deps.broadcastEvent(
        "memory.update_failed",
        { sessionId, reason: data.reason, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_irrelevant_marked") {
      await this.deps.broadcastEvent(
        "memory.memory_irrelevant_marked",
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch" ||
      eventType === "memory_extract" ||
      eventType === "memory_dream"
    ) {
      await this.deps.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch_result" ||
      eventType === "memory_extract_result" ||
      eventType === "memory_dream_result"
    ) {
      await this.deps.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    }
  }

  async handleLearningChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    const eventType = data.type as string;
    log.info("Learning channel data", { sessionId, type: eventType });

    if (eventType === "learning.snapshot") {
      await this.deps.broadcastEvent(
        "learning.snapshot",
        { sessionId, snapshot: data.snapshot as LearningSnapshot, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "learning.run") {
      await this.deps.broadcastEvent(
        "learning.run",
        { sessionId, run: data.run as LearningRun, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "learning.candidate") {
      await this.deps.broadcastEvent(
        "learning.candidate",
        { sessionId, candidate: data.candidate as LearningCandidate, timestamp: Date.now() },
        { sessionId },
      );
    }
  }
}
