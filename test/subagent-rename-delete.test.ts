import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: {
    getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import { useSubagentStore } from "../src/mainview/stores/use-subagent-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { SubagentSessionInfo } from "../src/mainview/types";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

const PARENT_PATH = "/sessions/parent-1.jsonl";

function makeSub(overrides: Partial<SubagentSessionInfo> = {}): SubagentSessionInfo {
  return {
    sessionId: "sub-1",
    sessionPath: "/sessions/sub-1.jsonl",
    description: "Test subagent",
    instruction: "Do something",
    startedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSubagentStore.setState({
    subsessionsByParent: {},
    activeSubsessionId: null,
    messagesBySubsession: {},
    loadingByParent: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  });
});

describe("renameSubagent", () => {
  it("should update description in store and call backend RPC", () => {
    const sub = makeSub({ sessionId: "sub-1" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub] },
    });

    useSubagentStore.getState().renameSubagent(PARENT_PATH, "sub-1", "New Name");

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs[0].description).toBe("New Name");
    expect(mockedCall).toHaveBeenCalledWith("subagent.rename", {
      parentSessionPath: PARENT_PATH,
      subSessionId: "sub-1",
      newDescription: "New Name",
    });
  });

  it("should reject empty string rename", () => {
    const sub = makeSub({ sessionId: "sub-1", description: "Original" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub] },
    });

    useSubagentStore.getState().renameSubagent(PARENT_PATH, "sub-1", "");

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs[0].description).toBe("Original");
    expect(mockedCall).not.toHaveBeenCalledWith("subagent.rename", expect.anything());
  });

  it("should reject whitespace-only rename", () => {
    const sub = makeSub({ sessionId: "sub-1", description: "Original" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub] },
    });

    useSubagentStore.getState().renameSubagent(PARENT_PATH, "sub-1", "   ");

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs[0].description).toBe("Original");
  });
});

describe("deleteSubagent", () => {
  it("should remove subagent from store and call backend RPC", () => {
    const sub1 = makeSub({ sessionId: "sub-1" });
    const sub2 = makeSub({ sessionId: "sub-2" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub1, sub2] },
      activeSubsessionId: "sub-1",
    });

    useSubagentStore.getState().deleteSubagent(PARENT_PATH, "sub-1");

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs).toHaveLength(1);
    expect(subs[0].sessionId).toBe("sub-2");
    expect(useSubagentStore.getState().activeSubsessionId).toBeNull();
    expect(mockedCall).toHaveBeenCalledWith("subagent.delete", {
      parentSessionPath: PARENT_PATH,
      subSessionId: "sub-1",
    });
  });

  it("should not crash when deleting non-existent subagent", () => {
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [] },
    });

    expect(() => {
      useSubagentStore.getState().deleteSubagent(PARENT_PATH, "sub-nonexist");
    }).not.toThrow();
  });

  it("should not change activeSubsessionId when deleting a different subagent", () => {
    const sub1 = makeSub({ sessionId: "sub-1" });
    const sub2 = makeSub({ sessionId: "sub-2" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub1, sub2] },
      activeSubsessionId: "sub-1",
    });

    useSubagentStore.getState().deleteSubagent(PARENT_PATH, "sub-2");

    expect(useSubagentStore.getState().activeSubsessionId).toBe("sub-1");
  });

  it("should clear subagent messages on delete", () => {
    const sub1 = makeSub({ sessionId: "sub-1" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub1] },
      messagesBySubsession: { "sub-1": [{ id: "m1", role: "user", content: [], timestamp: 0 }] },
      activeSubsessionId: "sub-1",
    });

    useSubagentStore.getState().deleteSubagent(PARENT_PATH, "sub-1");

    expect(useSubagentStore.getState().messagesBySubsession["sub-1"]).toBeUndefined();
  });
});
