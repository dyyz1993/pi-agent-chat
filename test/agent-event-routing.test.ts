/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "../src/shared/modules/agent";
import { handleAgentEventOperation } from "../src/shared/agent/agent-event-routing";
import type { SyncDelegateResolver } from "../src/shared/agent/coordinator-session-state";

interface ManagedFixture {
  client?: {
    getTreeWithLeaf: ReturnType<typeof vi.fn>;
  };
  info: {
    status: string;
    holdEvents: unknown[];
    projectPath: string;
    sessionPath?: string;
  };
  lastActiveAt: number;
}

function makeManaged(overrides: Partial<ManagedFixture> = {}): ManagedFixture {
  return {
    client: {
      getTreeWithLeaf: vi.fn().mockResolvedValue({ entries: [], leafId: "leaf-1" }),
    },
    info: {
      status: "idle",
      holdEvents: [],
      projectPath: "/repo/app",
      sessionPath: "/sessions/sess.jsonl",
    },
    lastActiveAt: 0,
    ...overrides,
  };
}

function makeOptions(overrides: {
  sessionId?: string;
  event?: AgentEvent;
  clients?: Map<string, ManagedFixture>;
  parentChildMap?: Map<string, Set<string>>;
  syncDelegateResolvers?: Map<string, SyncDelegateResolver>;
  subagentSyncChildren?: Map<string, string>;
  syncDelegateLastText?: Map<string, string>;
  broadcastEvent?: ReturnType<typeof vi.fn>;
  emitAgentEvent?: ReturnType<typeof vi.fn>;
} = {}) {
  const sessionId = overrides.sessionId ?? "sess-1";
  const clients = overrides.clients ?? new Map([[sessionId, makeManaged()]]);
  return {
    sessionId,
    event: overrides.event ?? ({ type: "agent_start" } as AgentEvent),
    getActiveManaged: (id: string) => clients.get(id) ?? null,
    clients,
    parentChildMap: overrides.parentChildMap ?? new Map(),
    leafIds: new Map<string, string | null>(),
    syncDelegateResolvers: overrides.syncDelegateResolvers ?? new Map(),
    subagentSyncChildren: overrides.subagentSyncChildren ?? new Map(),
    syncDelegateLastText: overrides.syncDelegateLastText ?? new Map(),
    sandboxEnabled: false,
    broadcastEvent: overrides.broadcastEvent ?? vi.fn().mockResolvedValue(undefined),
    broadcastSessionStatus: vi.fn(),
    emitAgentEvent: overrides.emitAgentEvent ?? vi.fn().mockResolvedValue(undefined),
    handleSubagentChannelData: vi.fn(),
    handleTodoChannelData: vi.fn(),
    handleBashChannelData: vi.fn(),
    handleLspChannelData: vi.fn(),
    handleRulesChannelData: vi.fn(),
    handleMemoryChannelData: vi.fn(),
    handleSupervisorChannelData: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("agent event routing", () => {
  it("routes notify extension UI requests without adding them to held chat events", async () => {
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const options = makeOptions({
      event: {
        type: "extension_ui_request",
        method: "notify",
        message: "Saved",
        notifyType: "success",
      } as unknown as AgentEvent,
      broadcastEvent,
      emitAgentEvent,
    });

    handleAgentEventOperation(options);
    await flushMicrotasks();

    expect(broadcastEvent).toHaveBeenCalledWith(
      "agent.notify",
      { sessionId: "sess-1", message: "Saved", notifyType: "success" },
      { sessionId: "sess-1" },
    );
    expect(emitAgentEvent).not.toHaveBeenCalled();
    expect(options.clients.get("sess-1")?.info.holdEvents).toEqual([]);
  });

  it("closes agent state, syncs leaf id, and resolves pending sync delegate on agent_end", async () => {
    const resolved: unknown[] = [];
    const timeout = setTimeout(() => undefined, 10_000);
    const syncDelegateResolvers = new Map<string, SyncDelegateResolver>([
      [
        "sess-1",
        {
          resolve: (value) => resolved.push(value),
          timeout,
          parentSessionId: "parent-1",
        },
      ],
    ]);
    const syncDelegateLastText = new Map([["sess-1", "final answer"]]);
    const options = makeOptions({
      event: { type: "agent_end" } as AgentEvent,
      syncDelegateResolvers,
      subagentSyncChildren: new Map([["sess-1", "parent-1"]]),
      syncDelegateLastText,
    });
    const managed = options.clients.get("sess-1");

    handleAgentEventOperation(options);
    await flushMicrotasks();

    expect(managed?.info.status).toBe("idle");
    expect(options.leafIds.get("sess-1")).toBe("leaf-1");
    expect(syncDelegateResolvers.has("sess-1")).toBe(false);
    expect(syncDelegateLastText.has("sess-1")).toBe(false);
    expect(resolved).toEqual([
      {
        sessionId: "sess-1",
        status: "completed",
        exitCode: 0,
        finalText: "final answer",
      },
    ]);
  });

  it("broadcasts child session events to the coordinator and sync subagent stream", () => {
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);
    const clients = new Map([
      ["parent-1", makeManaged({ info: { ...makeManaged().info, sessionPath: "/parent.jsonl" } })],
      ["child-1", makeManaged()],
    ]);
    const options = makeOptions({
      sessionId: "child-1",
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
        assistantMessageEvent: {},
      } as unknown as AgentEvent,
      clients,
      parentChildMap: new Map([["parent-1", new Set(["child-1"])]]),
      subagentSyncChildren: new Map([["child-1", "parent-1"]]),
      broadcastEvent,
    });

    handleAgentEventOperation(options);

    expect(broadcastEvent).toHaveBeenCalledWith(
      "coordinator.session_event",
      expect.objectContaining({
        parentSessionId: "parent-1",
        childSessionId: "child-1",
      }),
      { parentSessionId: "parent-1" },
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "subagent.event",
      expect.objectContaining({
        parentSessionId: "parent-1",
        parentSessionPath: "/parent.jsonl",
        subSessionId: "child-1",
      }),
      { parentSessionId: "parent-1" },
    );
  });
});
