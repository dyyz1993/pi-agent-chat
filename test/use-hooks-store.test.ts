import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

import { useHooksStore } from "../src/mainview/stores/use-hooks-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { HookLogEntry, HookConfigSnapshot } from "../src/mainview/stores/use-hooks-store";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockReset();
  useHooksStore.setState({
    bySession: {},
    activeTab: "activity",
  });
});

describe("useHooksStore", () => {
  const SID = "sess-1";

  const mockEntry: HookLogEntry = {
    id: 1,
    timestamp: Date.now(),
    durationMs: 42,
    event: "PreToolUse",
    toolName: "Bash",
    matcher: "Bash",
    hookType: "command",
    command: "echo ok",
    decision: "allow",
    reason: "",
    exitCode: 0,
    source: "project",
    snippet: "echo hello",
  };

  it("initial state: bySession={}, activeTab=activity", () => {
    const s = useHooksStore.getState();
    expect(s.bySession).toEqual({});
    expect(s.activeTab).toBe("activity");
  });

  it("fetchLog calls apiClient.call with correct params", async () => {
    mockCall.mockResolvedValue({
      entries: [mockEntry],
      ruleStats: [],
      totalExecutions: 5,
      configSnapshot: null,
    });
    await useHooksStore.getState().fetchLog(SID);
    expect(mockCall).toHaveBeenCalledWith("hooks.getLog", {
      sessionId: SID,
      limit: undefined,
      event: undefined,
    });
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.entries).toHaveLength(1);
    expect(session?.totalExecutions).toBe(5);
    expect(session?.configSnapshot).toBeNull();
  });

  it("fetchLog with limit and event params", async () => {
    mockCall.mockResolvedValue({
      entries: [mockEntry],
      ruleStats: [],
      totalExecutions: 1,
      configSnapshot: null,
    });
    await useHooksStore.getState().fetchLog(SID, 50, "PreToolUse");
    expect(mockCall).toHaveBeenCalledWith("hooks.getLog", {
      sessionId: SID,
      limit: 50,
      event: "PreToolUse",
    });
  });

  it("fetchLog sets loading=true during fetch, loading=false after", async () => {
    let resolvePromise: (value: unknown) => void;
    mockCall.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );
    const p = useHooksStore.getState().fetchLog(SID);
    expect(useHooksStore.getState().bySession[SID]?.loading).toBe(true);
    resolvePromise!({
      entries: [],
      ruleStats: [],
      totalExecutions: 0,
      configSnapshot: null,
    });
    await p;
    expect(useHooksStore.getState().bySession[SID]?.loading).toBe(false);
  });

  it("fetchLog failure does not crash, sets loading=false", async () => {
    mockCall.mockRejectedValue(new Error("network fail"));
    await useHooksStore.getState().fetchLog(SID);
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.loading).toBe(false);
    expect(session?.entries).toEqual([]);
  });

  it("fetchConfig calls apiClient.call and updates ruleStats and configSnapshot", async () => {
    const configSnapshot: HookConfigSnapshot = {
      sources: [
        { path: "/project/.claude/settings.json", scope: "project", exists: true, disabled: false },
      ],
      events: [
        {
          name: "PreToolUse",
          groups: [
            {
              matcher: "Bash",
              source: "project",
              hooks: [{ type: "command", command: "echo ok" }],
            },
          ],
        },
      ],
    };
    mockCall.mockResolvedValue({
      ruleStats: [
        {
          matcher: "Bash",
          event: "PreToolUse",
          hookType: "command",
          command: "echo ok",
          source: "project",
          allowCount: 3,
          blockCount: 0,
          askCount: 1,
        },
      ],
      totalExecutions: 4,
      configSnapshot,
    });
    await useHooksStore.getState().fetchConfig(SID);
    expect(mockCall).toHaveBeenCalledWith("hooks.getConfig", { sessionId: SID });
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.ruleStats).toHaveLength(1);
    expect(session?.ruleStats[0].allowCount).toBe(3);
    expect(session?.configSnapshot).toEqual(configSnapshot);
  });

  it("clearLog calls apiClient.call and clears entries and totalExecutions", async () => {
    useHooksStore.setState({
      bySession: {
        [SID]: {
          entries: [mockEntry],
          ruleStats: [],
          totalExecutions: 10,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });
    mockCall.mockResolvedValue(undefined);
    await useHooksStore.getState().clearLog(SID);
    expect(mockCall).toHaveBeenCalledWith("hooks.clear", { sessionId: SID });
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.entries).toEqual([]);
    expect(session?.totalExecutions).toBe(0);
  });

  it("addEntry appends to existing session entries", () => {
    useHooksStore.setState({
      bySession: {
        [SID]: {
          entries: [{ ...mockEntry, id: 1 }],
          ruleStats: [],
          totalExecutions: 1,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });
    useHooksStore.getState().addEntry(SID, { ...mockEntry, id: 2 });
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.entries).toHaveLength(2);
    expect(session?.totalExecutions).toBe(2);
  });

  it("addEntry creates session data if not exists", () => {
    useHooksStore.getState().addEntry(SID, mockEntry);
    const session = useHooksStore.getState().bySession[SID];
    expect(session).toBeDefined();
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].toolName).toBe("Bash");
    expect(session?.totalExecutions).toBe(1);
  });

  it("addEntry deduplicates by entry id", () => {
    useHooksStore.getState().addEntry(SID, mockEntry);
    useHooksStore.getState().addEntry(SID, { ...mockEntry, toolName: "Read" });
    const session = useHooksStore.getState().bySession[SID];
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].toolName).toBe("Bash");
    expect(session?.totalExecutions).toBe(1);
  });

  it("setActiveTab toggles between activity and rules", () => {
    expect(useHooksStore.getState().activeTab).toBe("activity");
    useHooksStore.getState().setActiveTab("rules");
    expect(useHooksStore.getState().activeTab).toBe("rules");
    useHooksStore.getState().setActiveTab("activity");
    expect(useHooksStore.getState().activeTab).toBe("activity");
  });

  it("clearSession removes all data for a session", () => {
    useHooksStore.getState().addEntry(SID, mockEntry);
    useHooksStore.getState().clearSession(SID);
    expect(useHooksStore.getState().bySession[SID]).toBeUndefined();
  });

  it("multiple sessions are independent", () => {
    const SID2 = "sess-2";
    useHooksStore.getState().addEntry(SID, mockEntry);
    useHooksStore.getState().addEntry(SID2, { ...mockEntry, id: 99, toolName: "Read" });
    const s1 = useHooksStore.getState().bySession[SID];
    const s2 = useHooksStore.getState().bySession[SID2];
    expect(s1?.entries).toHaveLength(1);
    expect(s1?.entries[0].toolName).toBe("Bash");
    expect(s2?.entries).toHaveLength(1);
    expect(s2?.entries[0].toolName).toBe("Read");
    useHooksStore.getState().clearSession(SID);
    expect(useHooksStore.getState().bySession[SID]).toBeUndefined();
    expect(useHooksStore.getState().bySession[SID2]).toBeDefined();
  });
});
