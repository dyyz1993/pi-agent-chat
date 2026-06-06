import type { ChannelDataEvent } from "../modules/agent";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent } from "../modules/rules";
import type { TodoChannelEvent } from "../modules/todo";
import { createLogger } from "../lib/logger";
import {
  applyBashBackgroundToolState,
  buildLspLogData,
  createMemoryBroadcast,
  deriveLspState,
  type CachedLspState,
} from "./agent-channel-state";

const log = createLogger("agent");

type BroadcastEvent = (
  name: string,
  payload: Record<string, unknown>,
  filter: Record<string, unknown>,
) => Promise<void>;

interface ManagedChannelState {
  sessionPath: string;
  activeBackgroundTools: Set<string>;
}

export async function handleSubagentChannelDataOperation(options: {
  parentSessionId: string;
  channelMsg: ChannelDataEvent;
  getManagedState: (sessionId: string) => ManagedChannelState | null;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as unknown as
    | { event?: { type?: string; message?: unknown }; sessionId?: string }
    | undefined;
  if (!data) return;

  const { event: subEvent, sessionId: subSessionId } = data;
  if (!subEvent || !subSessionId) return;

  const eventType = subEvent.type as string;
  if (eventType === "response") return;

  const managed = options.getManagedState(options.parentSessionId);
  const sessionPath = managed?.sessionPath ?? "";

  if (eventType === "message_end" && subEvent.message) {
    const msg = subEvent.message as { content?: Array<{ type: string; text?: string }> };
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          log.info("Subagent final text", {
            parentSessionId: options.parentSessionId,
            subSessionId,
            textLength: part.text?.length,
          });
        }
      }
    }
  }

  await options.broadcastEvent(
    "subagent.event",
    {
      parentSessionId: options.parentSessionId,
      parentSessionPath: sessionPath,
      subSessionId,
      event: subEvent,
    },
    { parentSessionId: options.parentSessionId },
  );
}

export async function handleTodoChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as unknown as TodoChannelEvent | undefined;
  if (!data) return;

  log.info("Todo channel data", {
    sessionId: options.sessionId,
    action: data.action,
    count: data.todos?.length,
  });

  await options.broadcastEvent(
    "todo.event",
    {
      sessionId: options.sessionId,
      action: data.action,
      todos: data.todos,
      timestamp: data.timestamp,
    },
    { sessionId: options.sessionId },
  );
}

export async function handleBashChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  getManagedState: (sessionId: string) => ManagedChannelState | null;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as unknown as BashChannelEvent | undefined;
  if (!data) return;

  log.info("Bash channel data", {
    sessionId: options.sessionId,
    type: data.type,
    toolCallId: data.toolCallId,
  });

  const managed = options.getManagedState(options.sessionId);
  if (managed) {
    applyBashBackgroundToolState(managed.activeBackgroundTools, data);
  }

  await options.broadcastEvent(
    "bash.event",
    { sessionId: options.sessionId, event: data },
    {
      sessionId: options.sessionId,
    },
  );
}

export async function handleSupervisorChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as Record<string, unknown> | undefined;
  if (!data) return;

  log.info("Supervisor channel data", { sessionId: options.sessionId, type: data.type });

  await options.broadcastEvent(
    "supervisor.event",
    { sessionId: options.sessionId, event: data },
    { sessionId: options.sessionId },
  );
}

export async function handleLspChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  getCachedState: (sessionId: string) => CachedLspState | undefined;
  setCachedState: (sessionId: string, state: CachedLspState) => void;
}): Promise<void> {
  const data = options.channelMsg.data as unknown as LspChannelEvent | undefined;
  if (!data) return;

  log.info("LSP channel data", buildLspLogData(options.sessionId, data));

  const nextState = deriveLspState(options.getCachedState(options.sessionId), data);
  if (nextState) {
    options.setCachedState(options.sessionId, nextState);
  }
}

export async function handleRulesChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as RulesChannelEvent;
  if (!data) return;

  log.info("Rules channel data", { sessionId: options.sessionId, type: data.type });

  await options.broadcastEvent(
    "rules.event",
    { sessionId: options.sessionId, event: data },
    {
      sessionId: options.sessionId,
    },
  );
}

export async function handleMemoryChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
  now?: () => number;
}): Promise<void> {
  const data = options.channelMsg.data as Record<string, unknown> | undefined;
  if (!data) return;

  const eventType = data.type as string;
  log.info("Memory channel data", { sessionId: options.sessionId, type: eventType });

  const broadcast = createMemoryBroadcast(options.sessionId, data, (options.now ?? Date.now)());
  if (broadcast) {
    await options.broadcastEvent(broadcast.name, broadcast.payload, {
      sessionId: options.sessionId,
    });
  }
}
