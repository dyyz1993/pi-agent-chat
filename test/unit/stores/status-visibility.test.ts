import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionStatus } from "../../../src/mainview/types";

const uiDialogMocks = vi.hoisted(() => ({
  registerUIRequest: vi.fn(),
  clearPendingBySession: vi.fn(),
}));

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: () => ({
      getCurrentTier: vi.fn(() => null),
      getTierModels: vi.fn(() => ({})),
      fetchTierConfig: vi.fn(() => Promise.resolve()),
      syncTierFromModel: vi.fn(),
      switchToTier: vi.fn(),
      setGlobalDefaults: vi.fn(),
      setSessionTierModels: vi.fn(),
      setSessionCurrentTier: vi.fn(),
      dataBySession: {},
      globalDefaults: {},
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: () => ({
      loadSessionMessages: vi.fn(() => Promise.resolve()),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
      setMessagesForSession: vi.fn(),
      incrementStreamVersion: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: () => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: () => ({ fetchWorktrees: vi.fn(), fetchStatus: vi.fn(), fetchBranches: vi.fn() }),
  },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: () => ({
      setPlugins: vi.fn(),
      setSkills: vi.fn(),
      setMcpServers: vi.fn(),
      setProjectTrustState: vi.fn(),
      applyPermissionProfileSnapshot: vi.fn(),
    }),
  },
  deriveSkillScope: () => "project" as const,
  derivePluginScope: () => "project" as const,
}));

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({ clearSessionUI: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({ clearSessionUI: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: () => ({ endRetry: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => s,
  syncTabsToBackend: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: vi.fn(() => ({ activeSubsessionId: null })) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      addEvent: vi.fn(),
      addInjected: vi.fn(),
      loadFiles: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: uiDialogMocks.registerUIRequest,
      clearPendingBySession: uiDialogMocks.clearPendingBySession,
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-change-review-store", () => ({
  useChangeReviewStore: {
    getState: vi.fn(() => ({ fetchPending: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/lib/message-batcher", () => ({
  batchMessageUpdate: (_sessionId: string, apply: () => void) => apply(),
  flushNow: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: (raw: Record<string, unknown>) => ({
    id: raw.id ?? `msg-${Date.now()}`,
    role: raw.role ?? "user",
    content: raw.content ?? [{ type: "text", text: raw.content ?? "" }],
    timestamp: raw.timestamp ?? Date.now(),
  }),
  extractTokenUsage: () => null,
}));

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { clearSessionFetchInitCache } from "../../../src/mainview/stores/session-initial-state";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";

const resetStore = () => {
  useSessionStore.setState({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    loading: false,
    agentSubscriptions: {},
    subagentSubscriptions: {},
    todoSubscriptions: {},
    bashSubscriptions: {},
    lspSubscriptions: {},
    rulesSubscriptions: {},
    notifySubscriptions: {},
    memorySubscriptions: {},
    coordinatorSubscriptions: {},
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    modelManuallySet: false,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  uiDialogMocks.registerUIRequest.mockClear();
  uiDialogMocks.clearPendingBySession.mockClear();
  clearSessionFetchInitCache("s1");
  resetStore();
});

describe("Level 1: Enter app - quickly see which projects are running", () => {
  it("fetchAllProjectsSessionsStatus batch-queries and fills sessionStatusMap", async () => {
    useSessionStore.setState({
      activeSessionId: null,
      sessionsByProject: {
        "/project-a": [
          { sessionId: "s1", name: "Session A1", projectPath: "/project-a", updatedAt: 1 },
        ],
        "/project-b": [
          { sessionId: "s2", name: "Session B1", projectPath: "/project-b", updatedAt: 2 },
        ],
      },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.batchGetSessionsStatus") {
        return Promise.resolve([
          { sessionId: "s1", status: "streaming" },
          { sessionId: "s2", status: "idle" },
        ]);
      }
      return Promise.resolve({});
    });

    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    const map = useSessionStore.getState().sessionStatusMap;
    expect(map["s1"]).toBe("streaming");
    expect(map["s2"]).toBe("idle");
  });

  it("fetchAllProjectsSessionsStatus skips activeSessionId", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionsByProject: {
        "/project-a": [
          { sessionId: "s1", name: "Active", projectPath: "/project-a", updatedAt: 1 },
          { sessionId: "s3", name: "Other", projectPath: "/project-a", updatedAt: 3 },
        ],
      },
    });

    const batchCall = vi.fn().mockResolvedValue([{ sessionId: "s3", status: "idle" }]);
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation(
      (method: string, args?: unknown) => {
        if (method === "agent.batchGetSessionsStatus") {
          return batchCall(method, args);
        }
        return Promise.resolve({});
      },
    );

    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    expect(batchCall).toHaveBeenCalledTimes(1);
    const calledArgs = batchCall.mock.calls[0][1] as { sessionIds: string[] };
    expect(calledArgs.sessionIds).not.toContain("s1");
    expect(calledArgs.sessionIds).toContain("s3");
  });

  it("fetchAllProjectsSessionsStatus handles empty sessions gracefully", async () => {
    useSessionStore.setState({
      sessionsByProject: {},
      activeSessionId: null,
    });

    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    expect(apiClient.call).not.toHaveBeenCalledWith(
      "agent.batchGetSessionsStatus",
      expect.anything(),
    );
  });
});

describe("Level 2: Enter a project - see which sessions are running", () => {
  it("sessionStatusMap reflects correct status for each session", () => {
    useSessionStore.setState({
      sessionStatusMap: {
        s1: "streaming",
        s2: "idle",
        s3: "compacting",
      },
    });

    const map = useSessionStore.getState().sessionStatusMap;
    expect(map["s1"]).toBe("streaming");
    expect(map["s2"]).toBe("idle");
    expect(map["s3"]).toBe("compacting");
  });

  it("updateSessionStatus changes status correctly", () => {
    useSessionStore.setState({
      sessionStatusMap: {
        s2: "idle",
      },
    });

    useSessionStore.getState().updateSessionStatus("s2", "streaming");

    expect(useSessionStore.getState().sessionStatusMap["s2"]).toBe("streaming");
  });

  it("updateSessionStatus does not affect other sessions", () => {
    useSessionStore.setState({
      sessionStatusMap: {
        s1: "streaming",
        s2: "idle",
        s3: "compacting",
      },
    });

    useSessionStore.getState().updateSessionStatus("s2", "streaming");

    const map = useSessionStore.getState().sessionStatusMap;
    expect(map["s1"]).toBe("streaming");
    expect(map["s2"]).toBe("streaming");
    expect(map["s3"]).toBe("compacting");
  });

  it("all valid statuses can be set", () => {
    const statuses: SessionStatus[] = ["idle", "streaming", "compacting", "permission", "retrying"];
    for (const status of statuses) {
      useSessionStore.getState().updateSessionStatus("sx", status);
      expect(useSessionStore.getState().sessionStatusMap["sx"]).toBe(status);
    }
  });
});

describe("Level 3: Enter a session - stop button reflects correct state", () => {
  it("shows streaming status when session is active and streaming", () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionStatusMap: { s1: "streaming" },
    });

    const status =
      useSessionStore.getState().sessionStatusMap[useSessionStore.getState().activeSessionId!];
    expect(status).toBe("streaming");
  });

  it("stop button would not show when status is idle", () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionStatusMap: { s1: "idle" },
    });

    const activeSessionId = useSessionStore.getState().activeSessionId!;
    const status = useSessionStore.getState().sessionStatusMap[activeSessionId];
    expect(status).toBe("idle");
    expect(status).not.toBe("streaming");
  });

  it("status transitions from idle to streaming via updateSessionStatus", () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionStatusMap: { s1: "idle" },
    });

    expect(
      useSessionStore.getState().sessionStatusMap[useSessionStore.getState().activeSessionId!],
    ).toBe("idle");

    useSessionStore.getState().updateSessionStatus("s1", "streaming");

    expect(
      useSessionStore.getState().sessionStatusMap[useSessionStore.getState().activeSessionId!],
    ).toBe("streaming");
  });

  it("status transitions from streaming back to idle", () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionStatusMap: { s1: "streaming" },
    });

    useSessionStore.getState().updateSessionStatus("s1", "idle");

    expect(
      useSessionStore.getState().sessionStatusMap[useSessionStore.getState().activeSessionId!],
    ).toBe("idle");
  });
});

describe("Level 4: message_update event syncs status", () => {
  it("updates status to streaming when current status is idle", () => {
    useSessionStore.setState({
      sessionStatusMap: { s1: "idle" },
    });

    handleAgentEvent("s1", {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });

    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");
  });

  it("does not change status when already streaming", () => {
    useSessionStore.setState({
      sessionStatusMap: { s1: "streaming" },
    });

    handleAgentEvent("s1", {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "more text" }],
      },
    });

    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");
  });

  it("updates status to streaming from compacting", () => {
    useSessionStore.setState({
      sessionStatusMap: { s1: "compacting" },
    });

    handleAgentEvent("s1", {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "resuming" }],
      },
    });

    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");
  });
});

describe("Level 5: fetchInitialState does NOT overwrite streaming status", () => {
  it("preserves streaming when agent.getState returns isStreaming=false", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: { s1: "streaming" },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("s1");
    await promise;

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");
    });
  });

  it("preserves compacting when agent.getState returns isStreaming=false and isCompacting=false", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: { s1: "compacting" },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("s1");
    await promise;

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("compacting");
    });
  });

  it("preserves retrying status when agent.getState returns idle", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: { s1: "retrying" },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("s1");
    await promise;

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("retrying");
    });
  });

  it("sets streaming when agent.getState reports isStreaming=true", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: { s1: "idle" },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: true,
          isCompacting: false,
          messageCount: 5,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: 100, contextWindow: 8000 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("s1");
    await promise;

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");
    });
  });

  it("restores pending UI requests from agent.getState before streaming status", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: { s1: "idle" },
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: true,
          isCompacting: false,
          messageCount: 5,
          pendingUIRequests: [
            {
              type: "extension_ui_request",
              id: "ui-1",
              method: "select",
              title: "Confirm command",
              message: "Run command flagged for recursive rm?",
              options: ["1. Allow once", "2. Always allow", "3. Deny once", "4. Always deny"],
              timeout: 60_000,
              toolCallId: "tool-1",
              permissionMeta: {
                type: "permission_runtime",
                requestId: "perm-1",
                provider: "dangerous-command",
                subject: "command.run",
                toolCallId: "tool-1",
                metadata: {
                  command: "rm -rf /tmp/data",
                },
              },
            },
          ],
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: 100, contextWindow: 8000 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    await useSessionStore.getState().fetchInitialState("s1");

    await vi.waitFor(() => {
      expect(uiDialogMocks.registerUIRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "ui-1",
          sessionId: "s1",
          method: "select",
          title: "Confirm command",
          message: "Run command flagged for recursive rm?",
          toolCallId: "tool-1",
          permissionMeta: expect.objectContaining({
            type: "permission_runtime",
            provider: "dangerous-command",
            subject: "command.run",
          }),
        }),
      );
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("permission");
    });
  });

  it("sets idle when no active status and agent.getState reports idle", async () => {
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionReady: { s1: true },
      sessionStatusMap: {},
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("s1");
    await promise;

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("idle");
    });
  });
});
