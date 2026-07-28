import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionMeta } from "../../../src/mainview/types";

const handleAgentEventMock = vi.hoisted(() => vi.fn());
const handleSubagentEventMock = vi.hoisted(() => vi.fn());
const delegateActivityHandleEventMock = vi.hoisted(() => vi.fn());
const updateSessionStatusMock = vi.hoisted(() => vi.fn());
const upsertLiveSubagentMock = vi.hoisted(() => vi.fn());
const setSubMessagesMock = vi.hoisted(() => vi.fn());
const setRemoteRuntimeStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/lib/agent-event-handler", () => ({
  handleAgentEvent: handleAgentEventMock,
  toolCallNameMap: {},
  toolCallArgsMap: {},
  cleanupEventHandlerMaps: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: vi.fn(),
  clearStatusWatchdog: vi.fn(),
  insertAfterPinned: (sessions: SessionMeta[], session: SessionMeta) => [...sessions, session],
  useSessionStore: {
    getState: () => ({
      sessionsByProject: {
        "/project": [
          {
            sessionId: "child-1",
            name: "Child",
            projectPath: "/project",
            sessionPath: "/sessions/child-1.jsonl",
            status: "running",
          },
        ],
      },
      projectTabs: [
        {
          id: "remote-tab",
          name: "Remote",
          path: "/remote-shadow",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            id: "remote-tab",
            name: "Remote",
            host: "devbox",
            remotePath: "/srv/project",
            localPath: "/remote-shadow",
          },
        },
      ],
      updateSessionStatus: updateSessionStatusMock,
    }),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-delegate-activity-store", () => ({
  useDelegateActivityStore: {
    getState: () => ({ handleEvent: delegateActivityHandleEventMock }),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  clearBackgroundRefreshGeneration: vi.fn(),
  useChatStore: {
    getState: () => ({
      messagesBySession: {
        "sub-1": [
          {
            id: "msg-sub-1",
            role: "assistant",
            content: [{ type: "text", text: "working" }],
            timestamp: 1,
          },
        ],
      },
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  handleSubagentEvent: handleSubagentEventMock,
  useSubagentStore: {
    getState: () => ({
      subsessionsByParent: {},
      upsertLiveSubagent: upsertLiveSubagentMock,
      setSubMessages: setSubMessagesMock,
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
  handleBashEvent: vi.fn(),
  useBashStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-learning-store", () => ({
  useLearningStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: () => ({ setRemoteRuntimeStatus: setRemoteRuntimeStatusMock }) },
}));

vi.mock("../../../src/mainview/stores/use-change-review-store", () => ({
  useChangeReviewStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/session-initial-state", () => ({
  clearSessionFetchInitCache: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  clearRetrySession: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-hooks-store", () => ({
  useHooksStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-snapshot-store", () => ({
  useSnapshotStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-agent-store", () => ({
  useAgentStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-session-todo-store", () => ({
  useSessionTodoStore: { getState: () => ({}) },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import {
  deriveProjectTabConnectedFromRemoteStatus,
  doesProjectTabMatchRemoteRuntime,
  setupProjectStatusSubscription,
  setupSubscriptions,
  type SubscriptionMaps,
} from "../../../src/mainview/stores/session-subscriptions";

function makeState(): SubscriptionMaps & { projectTabs: []; activeProjectId: null } {
  return {
    agentSubscriptions: { "parent-1": "agent-sub" },
    subagentSubscriptions: { "parent-1": "subagent-sub" },
    todoSubscriptions: { "parent-1": "todo-sub" },
    bashSubscriptions: { "parent-1": "bash-sub" },
    lspSubscriptions: { "parent-1": "lsp-sub" },
    rulesSubscriptions: { "parent-1": "rules-sub" },
    notifySubscriptions: { "parent-1": "notify-sub" },
    memorySubscriptions: { "parent-1": ["memory-sub"] },
    coordinatorSubscriptions: {},
    supervisorSubscriptions: { "parent-1": "supervisor-sub" },
    goalSubscriptions: {},
    projectTabs: [],
    activeProjectId: null,
  };
}

describe("coordinator.session_event UI request forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards child extension UI request and resolution events through the normal agent event handler", () => {
    const state = makeState();
    const set = vi.fn((updater: (s: SubscriptionMaps) => Partial<SubscriptionMaps>) => {
      Object.assign(state, updater(state));
    });

    setupSubscriptions(state, set, "parent-1", {
      sessionId: "parent-1",
      name: "Parent",
      projectPath: "/project",
      sessionPath: "/sessions/parent-1.jsonl",
    });

    const subscribeCalls = vi.mocked(apiClient.subscribe).mock.calls;
    const eventSub = subscribeCalls.find((call) => call[0] === "coordinator.session_event");
    expect(eventSub).toBeTruthy();

    const callback = eventSub![1] as (payload: {
      parentSessionId: string;
      childSessionId: string;
      event: unknown;
    }) => void;

    const requestEvent = {
      type: "extension_ui_request",
      id: "ui-1",
      method: "select",
      title: "Allow command?",
      message: "Run risky command?",
      options: ["Allow", "Deny"],
    };
    callback({ parentSessionId: "parent-1", childSessionId: "child-1", event: requestEvent });

    expect(updateSessionStatusMock).toHaveBeenCalledWith("child-1", "permission");
    expect(handleAgentEventMock).toHaveBeenCalledWith("child-1", requestEvent);
    expect(delegateActivityHandleEventMock).toHaveBeenCalledWith("child-1", requestEvent);

    const resolvedEvent = { type: "extension_ui_resolved", id: "ui-1", reason: "responded" };
    callback({ parentSessionId: "parent-1", childSessionId: "child-1", event: resolvedEvent });

    expect(handleAgentEventMock).toHaveBeenCalledWith("child-1", resolvedEvent);
  });
});

describe("project status subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives transient project tab connection state from remote runtime status", () => {
    expect(deriveProjectTabConnectedFromRemoteStatus("connected")).toBe(true);
    expect(deriveProjectTabConnectedFromRemoteStatus("disconnected")).toBe(false);
    expect(deriveProjectTabConnectedFromRemoteStatus("error")).toBe(false);
    expect(deriveProjectTabConnectedFromRemoteStatus("connecting")).toBeUndefined();
  });

  it("matches remote tabs by local shadow path or remote cwd", () => {
    expect(
      doesProjectTabMatchRemoteRuntime(
        {
          id: "remote-tab",
          name: "Remote",
          path: "/remote-shadow",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            id: "remote-tab",
            name: "Remote",
            host: "devbox",
            localPath: "/remote-shadow",
            remotePath: "/srv/project",
          },
        },
        "/other-shadow",
        {
          enabled: true,
          configured: true,
          status: "disconnected",
          remoteCwd: "/srv/project",
        },
      ),
    ).toBe(true);
  });

  it("routes SSH connection changes into the status store", () => {
    setupProjectStatusSubscription();

    const subscribeCalls = vi.mocked(apiClient.subscribe).mock.calls;
    const sshSub = subscribeCalls.find((call) => call[0] === "agent.ssh_connection_changed");
    expect(sshSub).toBeTruthy();

    const callback = sshSub![1] as (payload: {
      sessionId: string;
      projectPath: string;
      status: {
        enabled: boolean;
        configured: boolean;
        status: "connecting" | "connected" | "disconnected" | "error";
        host?: string;
        remoteCwd?: string;
      };
    }) => void;

    callback({
      sessionId: "sess-ssh",
      projectPath: "/remote-shadow",
      status: {
        enabled: true,
        configured: true,
        status: "connecting",
        host: "devbox",
        remoteCwd: "/srv/project",
      },
    });

    expect(setRemoteRuntimeStatusMock).toHaveBeenCalledWith("sess-ssh", {
      enabled: true,
      configured: true,
      status: "connecting",
      host: "devbox",
      remoteCwd: "/srv/project",
    });

    callback({
      sessionId: "sess-ssh",
      projectPath: "/remote-shadow",
      status: {
        enabled: true,
        configured: true,
        status: "disconnected",
        host: "devbox",
        remoteCwd: "/srv/project",
      },
    });

    expect(vi.mocked(useSessionStore.setState)).toHaveBeenCalledWith({
      projectTabs: [
        expect.objectContaining({
          id: "remote-tab",
          connected: false,
        }),
      ],
    });
  });
});

describe("subagent.event message forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes subagent stream events through the normal agent event handler", () => {
    const state = { ...makeState(), subagentSubscriptions: {} };
    const set = vi.fn((updater: (s: SubscriptionMaps) => Partial<SubscriptionMaps>) => {
      Object.assign(state, updater(state));
    });

    setupSubscriptions(state, set, "parent-1", {
      sessionId: "parent-1",
      name: "Parent",
      projectPath: "/project",
      sessionPath: "/sessions/parent-1.jsonl",
    });

    const subscribeCalls = vi.mocked(apiClient.subscribe).mock.calls;
    const eventSub = subscribeCalls.find((call) => call[0] === "subagent.event");
    expect(eventSub).toBeTruthy();

    const callback = eventSub![1] as (payload: {
      parentSessionId: string;
      parentSessionPath?: string;
      subSessionId: string;
      event: unknown;
    }) => void;
    const updateEvent = {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
      },
    };

    callback({
      parentSessionId: "parent-1",
      parentSessionPath: "/sessions/parent-1.jsonl",
      subSessionId: "sub-1",
      event: updateEvent,
    });

    expect(handleAgentEventMock).toHaveBeenCalledWith("sub-1", updateEvent);
    expect(handleSubagentEventMock).toHaveBeenCalledWith(
      "sub-1",
      updateEvent,
      "parent-1",
      expect.objectContaining({
        skipUIRegistration: true,
        skipMessageMirroring: true,
      }),
    );
    expect(setSubMessagesMock).toHaveBeenCalledWith("sub-1", [
      {
        id: "msg-sub-1",
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        timestamp: 1,
      },
    ]);
  });

  it("does not stamp child subagent agent_end with a fake success exit code after a crash", () => {
    const state = { ...makeState(), subagentSubscriptions: {} };
    const set = vi.fn((updater: (s: SubscriptionMaps) => Partial<SubscriptionMaps>) => {
      Object.assign(state, updater(state));
    });

    setupSubscriptions(state, set, "parent-1", {
      sessionId: "parent-1",
      name: "Parent",
      projectPath: "/project",
      sessionPath: "/sessions/parent-1.jsonl",
    });

    const subscribeCalls = vi.mocked(apiClient.subscribe).mock.calls;
    const eventSub = subscribeCalls.find((call) => call[0] === "subagent.event");
    expect(eventSub).toBeTruthy();

    const callback = eventSub![1] as (payload: {
      parentSessionId: string;
      parentSessionPath?: string;
      subSessionId: string;
      event: unknown;
    }) => void;

    callback({
      parentSessionId: "parent-1",
      parentSessionPath: "/sessions/parent-1.jsonl",
      subSessionId: "sub-1",
      event: { type: "agent_end", reason: "crashed" },
    });

    expect(upsertLiveSubagentMock).toHaveBeenCalledWith(
      "/sessions/parent-1.jsonl",
      "sub-1",
      expect.not.objectContaining({ exitCode: 0 }),
    );
  });
});
