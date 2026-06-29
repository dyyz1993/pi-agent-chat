import type { AgentEvent, ChannelDataEvent, ExtensionUIRequestEvent } from "../modules/agent";
import { createLogger } from "../lib/logger";
import { classifyExtensionUiRequest, extractMessageEndText } from "./agent-event-lifecycle";
import type { SyncChildRegistry, SyncDelegateResolver } from "./coordinator-session-state";
import { findParentSession } from "./coordinator-session-state";
import { classifyAgentEndOutcome } from "./agent-end-outcome";
import { sanitizeEvent, type SanitizedEvent } from "./hold-events";

const log = createLogger("agent");

const MESSAGE_UPDATE_THROTTLE_MS = 50;
const TOOL_UPDATE_THROTTLE_MS = 100;

type PendingBuffer = { sanitized: SanitizedEvent; timer: ReturnType<typeof setTimeout> };

const pendingMessageUpdates = new Map<string, PendingBuffer>();
const pendingToolUpdates = new Map<string, PendingBuffer>();

/** Clear all pending throttle buffers (for testing) */
export function _resetThrottleBuffers(): void {
  for (const [, buf] of pendingMessageUpdates) clearTimeout(buf.timer);
  for (const [, buf] of pendingToolUpdates) clearTimeout(buf.timer);
  pendingMessageUpdates.clear();
  pendingToolUpdates.clear();
}

function flushPendingBuffer(
  sessionId: string,
  map: Map<string, PendingBuffer>,
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>,
): void {
  const buf = map.get(sessionId);
  if (buf) {
    map.delete(sessionId);
    emitAgentEvent(sessionId, buf.sanitized).catch(() => undefined);
  }
}

function throttleEventType(
  sessionId: string,
  sanitized: SanitizedEvent,
  eventType: string,
  throttleMs: number,
  pendingMap: Map<string, PendingBuffer>,
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>,
): boolean {
  if (sanitized.type !== eventType) return false;

  const pending = pendingMap.get(sessionId);
  if (pending) {
    pending.sanitized = sanitized;
    return true;
  }
  const timer = setTimeout(() => {
    flushPendingBuffer(sessionId, pendingMap, emitAgentEvent);
  }, throttleMs);
  pendingMap.set(sessionId, { sanitized, timer });
  return true;
}

function emitAgentEventThrottled(
  sessionId: string,
  sanitized: SanitizedEvent,
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>,
): void {
  // Throttle high-frequency event types
  if (
    throttleEventType(
      sessionId,
      sanitized,
      "message_update",
      MESSAGE_UPDATE_THROTTLE_MS,
      pendingMessageUpdates,
      emitAgentEvent,
    )
  ) {
    return;
  }

  if (
    throttleEventType(
      sessionId,
      sanitized,
      "tool_execution_update",
      TOOL_UPDATE_THROTTLE_MS,
      pendingToolUpdates,
      emitAgentEvent,
    )
  ) {
    return;
  }

  // Non-throttled event: flush any pending throttled events first, then send immediately
  flushPendingBuffer(sessionId, pendingMessageUpdates, emitAgentEvent);
  flushPendingBuffer(sessionId, pendingToolUpdates, emitAgentEvent);
  emitAgentEvent(sessionId, sanitized).catch(() => undefined);
}

interface ManagedEventClientLike {
  client?: {
    getTreeWithLeaf(): Promise<{ entries: unknown[]; leafId: string | null }>;
  };
  info: {
    status: string;
    projectPath: string;
    sessionPath?: string;
    activeToolExecutions?: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  };
  lastActiveAt: number;
}

export function handleAgentEventOperation<TManaged extends ManagedEventClientLike>(options: {
  sessionId: string;
  event: AgentEvent;
  getActiveManaged: (sessionId: string) => TManaged | null;
  clients: Map<string, TManaged>;
  parentChildMap: Map<string, Set<string>>;
  leafIds: Map<string, string | null>;
  syncDelegateResolvers: Map<string, SyncDelegateResolver>;
  subagentSyncChildren: SyncChildRegistry & { has(sessionId: string): boolean };
  syncDelegateLastText: Map<string, string>;
  sandboxEnabled: boolean;
  broadcastEvent: (
    eventName: string,
    data: Record<string, unknown>,
    filter?: Record<string, unknown>,
  ) => Promise<void>;
  broadcastSessionStatus: (sessionId: string, status: string) => void;
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>;
  handleSubagentChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleTodoChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleBashChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleLspChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleRulesChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleMemoryChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  handleLearningChannelData?: (sessionId: string, event: ChannelDataEvent) => void;
  handleSupervisorChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  now?: () => number;
}): void {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;

  if (options.event.type === "channel_data") {
    const ch = options.event as ChannelDataEvent;
    if (ch.name === "subagent") return options.handleSubagentChannelData(options.sessionId, ch);
    if (ch.name === "todo") return options.handleTodoChannelData(options.sessionId, ch);
    if (ch.name === "bash") return options.handleBashChannelData(options.sessionId, ch);
    if (ch.name === "lsp") return options.handleLspChannelData(options.sessionId, ch);
    if (ch.name === "rules-engine") return options.handleRulesChannelData(options.sessionId, ch);
    if (ch.name === "memory") return options.handleMemoryChannelData(options.sessionId, ch);
    if (ch.name === "learning") return options.handleLearningChannelData?.(options.sessionId, ch);
    if (ch.name === "supervisor") {
      return options.handleSupervisorChannelData(options.sessionId, ch);
    }
    if (ch.name === "coordinator") {
      log.warn(
        "coordinator channel_data reached handleEvent — should have been intercepted in start()",
        { sessionId: options.sessionId },
      );
      return;
    }
  }

  if (options.event.type === "extension_ui_request") {
    const ui = options.event as ExtensionUIRequestEvent;
    const action = classifyExtensionUiRequest(ui);
    if (action.type === "notify") {
      options
        .broadcastEvent(
          "agent.notify",
          {
            sessionId: options.sessionId,
            ...action.payload,
          },
          { sessionId: options.sessionId },
        )
        .catch((err: unknown) => {
          log.warn("broadcastEvent(agent.notify) error", {
            sessionId: options.sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }
    if (action.type === "ignore") return;
  }

  if (options.event.type === "agent_start") {
    managed.info.status = "streaming";
    managed.lastActiveAt = (options.now ?? Date.now)();
    options.broadcastSessionStatus(options.sessionId, "streaming");
  }

  if (options.event.type === "agent_end") {
    managed.info.status = "idle";
    managed.lastActiveAt = (options.now ?? Date.now)();
    options.broadcastSessionStatus(options.sessionId, "idle");

    managed.client
      ?.getTreeWithLeaf()
      .then((treeResult) => {
        if (treeResult.leafId) {
          options.leafIds.set(options.sessionId, treeResult.leafId);
        }
      })
      .catch(() => undefined);

    if (options.sandboxEnabled && managed.info.projectPath) {
      options
        .broadcastEvent(
          "file.changed",
          {
            changedPath: managed.info.projectPath,
            type: "create",
          },
          { sessionId: options.sessionId },
        )
        .catch(() => undefined);
    }

    const resolver = options.syncDelegateResolvers.get(options.sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      options.syncDelegateResolvers.delete(options.sessionId);
      options.subagentSyncChildren.delete(options.sessionId);
      const finalText = options.syncDelegateLastText.get(options.sessionId) ?? "(completed)";
      options.syncDelegateLastText.delete(options.sessionId);
      const outcome = classifyAgentEndOutcome((options.event as { reason?: unknown }).reason);
      resolver.resolve({
        sessionId: options.sessionId,
        status: outcome.status,
        exitCode: outcome.exitCode,
        finalText: finalText || "(completed)",
        error: outcome.error,
      });
    }
  }

  if (options.event.type === "session_info_changed") {
    const name = (options.event as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) {
      const projectPath = managed.info.projectPath;
      options
        .broadcastEvent(
          "agent.session_renamed",
          { sessionId: options.sessionId, projectPath, newName: name },
          {},
        )
        .catch((err: unknown) => {
          log.warn("broadcastEvent(session_renamed from info_changed) error", {
            sessionId: options.sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }
    return;
  }

  if (options.event.type === "message_end") {
    if (options.subagentSyncChildren.has(options.sessionId)) {
      const text = extractMessageEndText(options.event);
      if (text) options.syncDelegateLastText.set(options.sessionId, text);
    }
  }

  if (options.event.type === "message_update") {
    managed.info.status = "streaming";
  }

  const eventWithTool = options.event as {
    type: string;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    timestamp?: unknown;
  };

  if (
    eventWithTool.type === "tool_execution_start" &&
    typeof eventWithTool.toolCallId === "string"
  ) {
    const active = managed.info.activeToolExecutions ?? [];
    const existingIndex = active.findIndex((tool) => tool.toolCallId === eventWithTool.toolCallId);
    const startedAt =
      typeof eventWithTool.timestamp === "number" ? eventWithTool.timestamp : Date.now();
    const nextTool = {
      toolCallId: eventWithTool.toolCallId,
      toolName: eventWithTool.toolName ?? "unknown",
      args: eventWithTool.args,
      startedAt,
    };
    managed.info.activeToolExecutions =
      existingIndex >= 0
        ? active.map((tool, index) => (index === existingIndex ? nextTool : tool))
        : [...active, nextTool];
  } else if (
    eventWithTool.type === "tool_execution_end" &&
    typeof eventWithTool.toolCallId === "string"
  ) {
    managed.info.activeToolExecutions = (managed.info.activeToolExecutions ?? []).filter(
      (tool) => tool.toolCallId !== eventWithTool.toolCallId,
    );
  } else if (options.event.type === "agent_end") {
    managed.info.activeToolExecutions = [];
  }

  const sanitized = sanitizeEvent(options.event);

  const parentId = findParentSession(options.parentChildMap, options.sessionId);
  if (parentId) {
    options
      .broadcastEvent(
        "coordinator.session_event",
        {
          parentSessionId: parentId,
          childSessionId: options.sessionId,
          event: sanitized,
        },
        { parentSessionId: parentId },
      )
      .catch((err: unknown) => {
        log.warn("broadcastEvent(coordinator.session_event) error", {
          sessionId: options.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });

    if (
      options.subagentSyncChildren.has(options.sessionId) &&
      options.event.type !== "channel_data"
    ) {
      const parentManaged = options.clients.get(parentId);
      options
        .broadcastEvent(
          "subagent.event",
          {
            parentSessionId: parentId,
            parentSessionPath: parentManaged?.info.sessionPath ?? "",
            subSessionId: options.sessionId,
            event: sanitized,
          },
          { parentSessionId: parentId },
        )
        .catch(() => undefined);
    }
  }

  emitAgentEventThrottled(options.sessionId, sanitized, options.emitAgentEvent);
}
