/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
    sandboxEnabled: false,
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  AgentProcessManager,
  compactHoldEventsForReplay,
  type SanitizedEvent,
} from "../src/shared/agent/process-manager";

interface ManagedClientShape {
  client: Record<string, unknown>;
  info: {
    sessionId: string;
    projectPath: string;
    sessionPath: string;
    status: string;
    holdEvents: SanitizedEvent[];
  };
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

interface InternalAPM {
  clients: Map<string, ManagedClientShape>;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

function internals(manager: AgentProcessManager): InternalAPM {
  return manager as unknown as InternalAPM;
}

function event(type: string, extra: Record<string, unknown> = {}): SanitizedEvent {
  return { type, ...extra } as unknown as SanitizedEvent;
}

function messageUpdate(text: string): SanitizedEvent {
  return event("message_update", {
    message: { role: "assistant", content: [{ type: "text", text }] },
    assistantMessageEvent: {},
  });
}

function toolStart(toolCallId: string): SanitizedEvent {
  return event("tool_execution_start", {
    toolCallId,
    toolName: "bash",
    args: { command: "sleep 10" },
    timestamp: 1,
  });
}

function toolUpdate(toolCallId: string, partialResult: string): SanitizedEvent {
  return event("tool_execution_update", {
    toolCallId,
    toolName: "bash",
    args: { command: "sleep 10" },
    partialResult,
  });
}

function toolEnd(toolCallId: string, result: string): SanitizedEvent {
  return event("tool_execution_end", {
    toolCallId,
    toolName: "bash",
    result,
    isError: false,
    timestamp: 2,
    durationMs: 1000,
  });
}

function makeManaged(sessionId: string, holdEvents: SanitizedEvent[]): ManagedClientShape {
  return {
    client: {},
    info: {
      sessionId,
      projectPath: "/fake/project",
      sessionPath: `/fake/sessions/${sessionId}.jsonl`,
      status: "streaming",
      holdEvents,
    },
    unsubscribe: () => {},
    _activeSessionId: sessionId,
    lastActiveAt: Date.now(),
    activeBackgroundTools: new Set(),
  };
}

describe("compactHoldEventsForReplay", () => {
  it("keeps only the latest open message update while streaming", () => {
    const compacted = compactHoldEventsForReplay([
      event("agent_start"),
      event("message_start", { message: { role: "assistant", content: [] } }),
      messageUpdate("first"),
      messageUpdate("second"),
      messageUpdate("latest"),
    ]);

    const updates = compacted.filter((e) => e.type === "message_update");
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).toContain("latest");
  });

  it("drops replayed text updates once the message has ended", () => {
    const compacted = compactHoldEventsForReplay([
      event("agent_start"),
      event("message_start", { message: { role: "assistant", content: [] } }),
      messageUpdate("partial text that is already persisted"),
      event("message_end", { message: { role: "assistant", content: [] }, entryId: "entry-1" }),
    ]);

    expect(compacted.some((e) => e.type === "message_update")).toBe(false);
    expect(compacted.some((e) => e.type === "message_end")).toBe(true);
  });

  it("drops a stale open update when a new message starts", () => {
    const compacted = compactHoldEventsForReplay([
      event("message_start", { message: { role: "assistant", content: [] } }),
      messageUpdate("stale previous text"),
      event("message_start", { message: { role: "assistant", content: [] } }),
    ]);

    expect(compacted.some((e) => e.type === "message_update")).toBe(false);
    expect(compacted.filter((e) => e.type === "message_start")).toHaveLength(2);
  });

  it("keeps running tools resumable without replaying every partial update", () => {
    const compacted = compactHoldEventsForReplay([
      toolStart("tc-running"),
      toolUpdate("tc-running", "line 1"),
      toolUpdate("tc-running", "line 2"),
      toolUpdate("tc-running", "line 3"),
    ]);

    expect(compacted.map((e) => e.type)).toEqual([
      "tool_execution_start",
      "tool_execution_update",
    ]);
    expect(JSON.stringify(compacted[1])).toContain("line 3");
  });

  it("keeps terminal tools closed and ignores delayed updates after end", () => {
    const compacted = compactHoldEventsForReplay([
      toolStart("tc-done"),
      toolUpdate("tc-done", "running"),
      toolEnd("tc-done", "done"),
      toolUpdate("tc-done", "late stale output"),
    ]);

    expect(compacted.map((e) => e.type)).toEqual(["tool_execution_start", "tool_execution_end"]);
    expect(JSON.stringify(compacted)).toContain("done");
    expect(JSON.stringify(compacted)).not.toContain("late stale output");
  });
});

describe("AgentProcessManager.replayHoldEvents", () => {
  let manager: AgentProcessManager;
  let server: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new MockRPCServer();
    manager = new AgentProcessManager(server as unknown as ConstructorParameters<
      typeof AgentProcessManager
    >[0]);
  });

  it("replays a compact snapshot and shrinks the retained buffer", async () => {
    const sessionId = "sess-hold-events";
    const held = [
      event("agent_start"),
      event("message_start", { message: { role: "assistant", content: [] } }),
      ...Array.from({ length: 20 }, (_, index) => messageUpdate(`partial ${index}`)),
      toolStart("tc-1"),
      ...Array.from({ length: 20 }, (_, index) => toolUpdate("tc-1", `line ${index}`)),
      toolEnd("tc-1", "complete"),
      toolUpdate("tc-1", "late"),
      event("message_end", { message: { role: "assistant", content: [] }, entryId: "entry-1" }),
    ];

    internals(manager).clients.set(sessionId, makeManaged(sessionId, held));

    const result = await manager.replayHoldEvents(sessionId);
    const retained = internals(manager).clients.get(sessionId)?.info.holdEvents ?? [];

    expect(result.replayed).toBeLessThan(held.length);
    expect(retained).toHaveLength(result.replayed);
    expect(retained.some((e) => e.type === "message_update")).toBe(false);
    expect(retained.map((e) => e.type)).toContain("tool_execution_end");
    expect(server.emitEvent).toHaveBeenCalledTimes(result.replayed);
  });
});
