import type { ChannelDataEvent } from "../modules/agent";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent } from "../modules/rules";
import type { TodoChannelEvent } from "../modules/todo";
import { createLogger } from "../lib/logger";
import {
  applyBashBackgroundToolState,
  buildLspLogData,
  createLearningBroadcast,
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

// ── Bash output throttle ───────────────────────────────────────────────
// Bash tool output events arrive every ~5ms during compilation. Each one
// triggers broadcastEvent → emitEvent → transport.send which blocks Bun's
// single-threaded event loop. Throttle by buffering "output" events per
// (sessionId, toolCallId) and flushing every BASH_FLUSH_MS milliseconds.
const BASH_FLUSH_MS = 50;

interface PendingBashOutput {
  events: BashChannelEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingBashOutputs = new Map<string, PendingBashOutput>();

function bashOutputKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function flushBashOutput(key: string, sessionId: string, broadcastEvent: BroadcastEvent): void {
  const pending = pendingBashOutputs.get(key);
  if (!pending || pending.events.length === 0) {
    pendingBashOutputs.delete(key);
    return;
  }
  pendingBashOutputs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  // Merge buffered output events into a single broadcast.
  // Keep all fields from the last event but concatenate data text.
  const events = pending.events;
  if (events.length === 1) {
    broadcastEvent("bash.event", { sessionId, event: events[0] }, { sessionId }).catch(
      () => undefined,
    );
  } else {
    const merged: BashChannelEvent = { ...events[events.length - 1] };
    const allData = events.map((e) => e.data ?? "").join("");
    if (allData) merged.data = allData;
    broadcastEvent("bash.event", { sessionId, event: merged }, { sessionId }).catch(
      () => undefined,
    );
  }
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

  // Bash channel data is high-frequency (every ~5ms during compilation).
  // Only log start/end events at info; output events at debug.
  if (data.type === "output") {
    log.debug("Bash channel data", {
      sessionId: options.sessionId,
      type: data.type,
      toolCallId: data.toolCallId,
    });
  } else {
    log.info("Bash channel data", {
      sessionId: options.sessionId,
      type: data.type,
      toolCallId: data.toolCallId,
    });
  }

  const managed = options.getManagedState(options.sessionId);
  if (managed) {
    applyBashBackgroundToolState(managed.activeBackgroundTools, data);
  }

  // Throttle bash "output" events: buffer and flush every BASH_FLUSH_MS.
  // Non-output events (start/end/error) are sent immediately.
  const toolCallId = data.toolCallId;
  if (data.type === "output" && typeof toolCallId === "string") {
    const key = bashOutputKey(options.sessionId, toolCallId);
    const existing = pendingBashOutputs.get(key);
    if (existing) {
      existing.events.push(data);
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        flushBashOutput(key, options.sessionId, options.broadcastEvent);
      }, BASH_FLUSH_MS);
      return;
    }
    const pending: PendingBashOutput = { events: [data], timer: null };
    pending.timer = setTimeout(() => {
      flushBashOutput(key, options.sessionId, options.broadcastEvent);
    }, BASH_FLUSH_MS);
    pendingBashOutputs.set(key, pending);
    return;
  }

  // Flush any pending output for this tool before sending non-output event.
  if (typeof toolCallId === "string") {
    const key = bashOutputKey(options.sessionId, toolCallId);
    flushBashOutput(key, options.sessionId, options.broadcastEvent);
  }

  await options.broadcastEvent(
    "bash.event",
    { sessionId: options.sessionId, event: data },
    {
      sessionId: options.sessionId,
    },
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

export async function handleLearningChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
  now?: () => number;
}): Promise<void> {
  const data = options.channelMsg.data as Record<string, unknown> | undefined;
  if (!data) return;

  const eventType = data.type as string;
  log.info("Learning channel data", { sessionId: options.sessionId, type: eventType });

  const timestamp = (options.now ?? Date.now)();
  const broadcast = createLearningBroadcast(options.sessionId, data, timestamp);
  const memoryBroadcast = broadcast ?? createMemoryBroadcast(options.sessionId, data, timestamp);
  if (memoryBroadcast) {
    await options.broadcastEvent(memoryBroadcast.name, memoryBroadcast.payload, {
      sessionId: options.sessionId,
    });
  }
}

/** Loop Scheduler channel data → broadcast to frontend */
export async function handleLoopSchedulerChannelDataOperation(options: {
  sessionId: string;
  channelMsg: ChannelDataEvent;
  broadcastEvent: BroadcastEvent;
}): Promise<void> {
  const data = options.channelMsg.data as Record<string, unknown> | undefined;
  if (!data) return;

  log.info("Loop scheduler channel data", {
    sessionId: options.sessionId,
    type: data.type,
  });

  await options.broadcastEvent(
    "loop-scheduler.event",
    { sessionId: options.sessionId, ...data },
    { sessionId: options.sessionId },
  );
}
