/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  handleBashChannelDataOperation,
  handleLspChannelDataOperation,
  handleMemoryChannelDataOperation,
  handleSubagentChannelDataOperation,
  handleTodoChannelDataOperation,
} from "../src/shared/agent/agent-channel-handlers";
import type { ChannelDataEvent } from "../src/shared/modules/agent";

function channelMsg(data: unknown): ChannelDataEvent {
  return { type: "channel_data", name: "test", data } as ChannelDataEvent;
}

describe("agent channel handlers", () => {
  it("broadcasts subagent events with parent session path", async () => {
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    await handleSubagentChannelDataOperation({
      parentSessionId: "parent",
      channelMsg: channelMsg({ sessionId: "child", event: { type: "message_start" } }),
      getManagedState: () => ({ sessionPath: "/sessions/parent.jsonl", activeBackgroundTools: new Set() }),
      broadcastEvent,
    });

    expect(broadcastEvent).toHaveBeenCalledWith(
      "subagent.event",
      {
        parentSessionId: "parent",
        parentSessionPath: "/sessions/parent.jsonl",
        subSessionId: "child",
        event: { type: "message_start" },
      },
      { parentSessionId: "parent" },
    );
  });

  it("updates bash background tool state and broadcasts bash events", async () => {
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);
    const activeBackgroundTools = new Set<string>();

    await handleBashChannelDataOperation({
      sessionId: "sess-1",
      channelMsg: channelMsg({ type: "background", toolCallId: "tool-1" }),
      getManagedState: () => ({ sessionPath: "", activeBackgroundTools }),
      broadcastEvent,
    });
    await handleBashChannelDataOperation({
      sessionId: "sess-1",
      channelMsg: channelMsg({ type: "terminated", toolCallId: "tool-1" }),
      getManagedState: () => ({ sessionPath: "", activeBackgroundTools }),
      broadcastEvent,
    });

    expect(activeBackgroundTools.has("tool-1")).toBe(false);
    expect(broadcastEvent).toHaveBeenCalledTimes(2);
  });

  it("broadcasts todo and memory channel events", async () => {
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    await handleTodoChannelDataOperation({
      sessionId: "sess-1",
      channelMsg: channelMsg({ action: "set", todos: [{ text: "ship" }], timestamp: 42 }),
      broadcastEvent,
    });
    await handleMemoryChannelDataOperation({
      sessionId: "sess-1",
      channelMsg: channelMsg({ type: "memory_updated", files: ["memory.md"] }),
      broadcastEvent,
      now: () => 100,
    });

    expect(broadcastEvent).toHaveBeenCalledWith(
      "todo.event",
      { sessionId: "sess-1", action: "set", todos: [{ text: "ship" }], timestamp: 42 },
      { sessionId: "sess-1" },
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "memory.updated",
      { sessionId: "sess-1", files: ["memory.md"], timestamp: 100 },
      { sessionId: "sess-1" },
    );
  });

  it("updates cached lsp state from status events", async () => {
    const states = new Map();

    await handleLspChannelDataOperation({
      sessionId: "sess-1",
      channelMsg: channelMsg({ event: "status_changed", servers: [{ state: "ready" }] }),
      getCachedState: (sessionId) => states.get(sessionId),
      setCachedState: (sessionId, state) => states.set(sessionId, state),
    });

    expect(states.get("sess-1")).toEqual({
      state: "ready",
      servers: [{ state: "ready" }],
      activeLanguages: [],
    });
  });
});
