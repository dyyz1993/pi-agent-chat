import { describe, it, expect, beforeEach, mock } from "bun:test";

import * as actualMiddleware from "zustand/middleware";

mock.module("zustand/middleware", () => ({
  ...actualMiddleware,
  persist: (fn: unknown) => fn,
}));

mock.module("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mock().mockResolvedValue({}),
    onReconnect: mock(),
  },
}));

mock.module("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: mock(() => ({ addEntry: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: mock(() => ({
      loadSessionMessages: mock().mockResolvedValue(undefined),
      clearSessionMessages: mock(),
      messagesBySession: {},
    })),
    setState: mock(),
  },
}));

mock.module("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: mock(() => ({ addLog: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: {
    getState: mock(() => ({ setCurrentPath: mock(), listRootDir: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: mock(() => ({ setPlugins: mock(), setSkills: mock() })),
  },
  deriveSkillScope: mock(() => "project"),
  derivePluginScope: mock(() => "project"),
}));

mock.module("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: mock(() => ({ clearSessionUI: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: mock(() => ({ clearSessionUI: mock() })),
  },
}));

mock.module("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: mock(),
  cleanupSession: mock(),
  cleanupSessionData: mock(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    return {};
  },
  syncTabsToBackend: mock(),
}));

import { useSubagentStore } from "../src/mainview/stores/use-subagent-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { SubagentSessionInfo } from "../src/mainview/types";

const mockedCall = apiClient.call as ReturnType<typeof mock>;

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
  mock.clearAllMocks();
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
