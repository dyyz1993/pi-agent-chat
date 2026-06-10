/**
 * @vitest-environment node
 *
 * 集成测试（store 层）：验证 loadSessionsForProject → project.scanSessions 一次 RPC
 * 就把 sessions 和 status 一起带回并写入 store sessionStatusMap，
 * 不再依赖 fetchAllProjectsSessionsStatus / agent.batchGetSessionsStatus。
 * 这是对「无需 3s 延迟，状态与列表同源」设计的端到端验证。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionMeta } from "../../../src/mainview/types";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

const apiCallMock = vi.fn();
vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: (...args: unknown[]) => apiCallMock(...args),
    subscribe: vi.fn().mockResolvedValue("sub-id"),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: () => ({
      getCurrentTier: vi.fn(() => null),
      getTierModels: vi.fn(() => ({})),
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
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
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
  useGitStore: { getState: () => ({ fetchWorktrees: vi.fn(), fetchStatus: vi.fn(), fetchBranches: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: () => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() }) },
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

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: () => ({ addEntry: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({}) },
  clearSubagentToolNames: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: () => ({}) },
  handleBashEvent: vi.fn(),
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

vi.mock("../../../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: { getState: () => ({ notify: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/agent-event-handler", () => ({
  handleAgentEvent: vi.fn(),
  toolCallNameMap: {},
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete s.agentSubscriptions;
    delete s.batchSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
  requestRulesSnapshot: vi.fn(),
}));

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  const sid = overrides.sessionId ?? "sess-" + Math.random().toString(36).slice(2, 8);
  return {
    sessionId: sid,
    name: "",
    sessionPath: "/sessions/" + sid + ".jsonl",
    projectPath: "/project-a",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    pinned: false,
    ...overrides,
  };
}

const TEST_DEFAULT = {
  activeSessionId: null as string | null,
  projectTabs: [] as Array<{ id: string; name: string; path: string }>,
  activeProjectId: null as string | null,
  loading: false,
  agentSubscriptions: {} as Record<string, unknown>,
  batchSubscriptions: {} as Record<string, unknown>,
  subagentSubscriptions: {} as Record<string, unknown>,
  todoSubscriptions: {} as Record<string, unknown>,
  bashSubscriptions: {} as Record<string, unknown>,
  lspSubscriptions: {} as Record<string, unknown>,
  rulesSubscriptions: {} as Record<string, unknown>,
  notifySubscriptions: {} as Record<string, unknown>,
  memorySubscriptions: {} as Record<string, unknown>,
  supervisorSubscriptions: {} as Record<string, unknown>,
  coordinatorSubscriptions: {} as Record<string, unknown>,
  sessionReady: {} as Record<string, boolean>,
  todosBySession: {} as Record<string, unknown>,
  sessionContextMap: {} as Record<string, unknown>,
  sessionStatusMap: {} as Record<string, string>,
  queueBySession: {} as Record<string, unknown>,
  currentModel: null,
  currentThinkingLevel: "medium" as const,
  availableModels: [] as unknown[],
  projectStartFailed: {} as Record<string, unknown>,
  projectStartError: {} as Record<string, unknown>,
  _projectVersion: 0,
};

beforeEach(() => {
  apiCallMock.mockReset();
  useSessionStore.setState({ ...TEST_DEFAULT });
});

describe("TabBar 集成验证：跨项目状态真的能拉到并写入 store", () => {
  it("3 秒后跨项目 status 通过 batchGetSessionsStatus 真实拉取并写入 sessionStatusMap", async () => {
    const activeSess = makeSession({ sessionId: "a1", projectPath: "/project-a" });
    // 给非活跃 session 真实内容，避免 loadSessionsForProject 的 blank cleanup 误删
    const otherSess1 = makeSession({
      sessionId: "b1",
      projectPath: "/project-b",
      messageCount: 3,
      firstMessage: "first b1",
    });
    const otherSess2 = makeSession({
      sessionId: "b2",
      projectPath: "/project-b",
      messageCount: 5,
      firstMessage: "first b2",
    });

    // 模拟 restore 完成后的初始状态：活跃项目已加载列表
    useSessionStore.setState({
      projectTabs: [
        { id: "tab-a", name: "Project A", path: "/project-a" },
        { id: "tab-b", name: "Project B", path: "/project-b" },
      ],
      activeProjectId: "tab-a",
      activeSessionId: "a1",
      sessionsByProject: {
        "/project-a": [activeSess],
        // /project-b 故意空，模拟「列表还没加载」的真实场景
      },
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(async (method: string, params: { projectPath?: string; sessionIds?: string[] }) => {
      if (method === "project.scanSessions") {
        if (params?.projectPath === "/project-b") return { sessions: [otherSess1, otherSess2] };
        return { sessions: [] };
      }
      if (method === "agent.batchGetSessionsStatus") {
        const statusMap: Record<string, string> = { b1: "streaming", b2: "permission" };
        return (params?.sessionIds || []).map((id) => ({
          sessionId: id,
          status: statusMap[id] || "idle",
        }));
      }
      return {};
    });

    // 模拟 TabBar 3s init 末尾的真实行为：
    // 1) 先 await loadSessionsForProject 把非活跃项目列表加载进 store
    await useSessionStore.getState().loadSessionsForProject("/project-b");
    // 2) 再调 fetchAllProjectsSessionsStatus 批量拉所有非活跃 session 状态
    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    // 关键断言 1：apiClient.call 真的发了 batchGetSessionsStatus
    const batchCalls = apiCallMock.mock.calls.filter((c) => c[0] === "agent.batchGetSessionsStatus");
    expect(batchCalls).toHaveLength(1);
    // 关键断言 2：请求里只包含非活跃 session（即 b1、b2，不包含 a1）
    const requestIds = (batchCalls[0][1] as { sessionIds: string[] }).sessionIds;
    expect(requestIds.sort()).toEqual(["b1", "b2"]);
    // 关键断言 3：写入 store 的 status 正确
    const map = useSessionStore.getState().sessionStatusMap;
    expect(map["b1"]).toBe("streaming");
    expect(map["b2"]).toBe("permission");
  });

  it("activeSessionId 会被 batch 过滤掉，不会被重复请求", async () => {
    const activeSess = makeSession({ sessionId: "a1", projectPath: "/project-a" });
    const otherSess = makeSession({
      sessionId: "b1",
      projectPath: "/project-b",
      messageCount: 1,
      firstMessage: "first b1",
    });

    useSessionStore.setState({
      projectTabs: [
        { id: "tab-a", name: "Project A", path: "/project-a" },
        { id: "tab-b", name: "Project B", path: "/project-b" },
      ],
      activeProjectId: "tab-a",
      activeSessionId: "a1",
      sessionsByProject: {
        "/project-a": [activeSess],
        "/project-b": [otherSess],
      },
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(async (method: string, params: { sessionIds?: string[] }) => {
      if (method === "agent.batchGetSessionsStatus") {
        return (params?.sessionIds || []).map((id) => ({ sessionId: id, status: "idle" }));
      }
      return {};
    });

    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    const batchCalls = apiCallMock.mock.calls.filter((c) => c[0] === "agent.batchGetSessionsStatus");
    expect(batchCalls).toHaveLength(1);
    const requestIds = (batchCalls[0][1] as { sessionIds: string[] }).sessionIds;
    // a1 是活跃 session，被过滤
    expect(requestIds).not.toContain("a1");
    expect(requestIds).toEqual(["b1"]);
  });

  it("没有任何 session 时，batch 不发请求（no-op）", async () => {
    useSessionStore.setState({
      projectTabs: [],
      activeProjectId: null,
      sessionsByProject: {},
      sessionStatusMap: {},
    });

    await useSessionStore.getState().fetchAllProjectsSessionsStatus();

    const batchCalls = apiCallMock.mock.calls.filter((c) => c[0] === "agent.batchGetSessionsStatus");
    expect(batchCalls).toHaveLength(0);
  });

  it("batch RPC 失败时 store 状态保持不变（容错）", async () => {
    const sess = makeSession({
      sessionId: "b1",
      projectPath: "/project-b",
      messageCount: 1,
      firstMessage: "first b1",
    });
    useSessionStore.setState({
      projectTabs: [{ id: "tab-b", name: "Project B", path: "/project-b" }],
      activeProjectId: "tab-b",
      activeSessionId: "some-other", // b1 不是 active
      sessionsByProject: { "/project-b": [sess] },
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(async (method: string) => {
      if (method === "agent.batchGetSessionsStatus") {
        throw new Error("network error");
      }
      return {};
    });

    await expect(
      useSessionStore.getState().fetchAllProjectsSessionsStatus(),
    ).resolves.not.toThrow();

    // store 没有写入失败的状态
    expect(useSessionStore.getState().sessionStatusMap).toEqual({});
  });
});

describe("project.scanSessions 一次 RPC 同时返回 sessions 和 statuses（无延迟、无 batch）", () => {
  it("loadSessionsForProject 写入 sessions 和 status 到 store，不调 agent.batchGetSessionsStatus", async () => {
    const sess1 = makeSession({
      sessionId: "x1",
      projectPath: "/project-x",
      messageCount: 2,
      firstMessage: "first x1",
    });
    const sess2 = makeSession({
      sessionId: "x2",
      projectPath: "/project-x",
      messageCount: 4,
      firstMessage: "first x2",
    });

    useSessionStore.setState({
      projectTabs: [{ id: "tab-x", name: "Project X", path: "/project-x" }],
      activeProjectId: "tab-x",
      sessionsByProject: {},
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions" && params?.projectPath === "/project-x") {
          // 关键：statuses 字段与 sessions 字段同源
          return {
            sessions: [sess1, sess2],
            statuses: [
              { sessionId: "x1", status: "streaming" },
              { sessionId: "x2", status: "permission" },
            ],
          };
        }
        return {};
      },
    );

    await useSessionStore.getState().loadSessionsForProject("/project-x");

    const state = useSessionStore.getState();

    // sessions 写入了
    expect(state.sessionsByProject["/project-x"].map((s) => s.sessionId).sort()).toEqual([
      "x1",
      "x2",
    ]);
    // statuses 写入了
    expect(state.sessionStatusMap["x1"]).toBe("streaming");
    expect(state.sessionStatusMap["x2"]).toBe("permission");
    // 没有再调 agent.batchGetSessionsStatus（statuses 已经从 scan 带回来）
    const batchCalls = apiCallMock.mock.calls.filter(
      (c) => c[0] === "agent.batchGetSessionsStatus",
    );
    expect(batchCalls).toHaveLength(0);
  });

  it("statuses 字段缺失时，sessionStatusMap 保持空（容错，不写入）", async () => {
    const sess = makeSession({
      sessionId: "y1",
      projectPath: "/project-y",
      messageCount: 1,
      firstMessage: "first y1",
    });

    useSessionStore.setState({
      projectTabs: [{ id: "tab-y", name: "Project Y", path: "/project-y" }],
      activeProjectId: "tab-y",
      sessionsByProject: {},
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions" && params?.projectPath === "/project-y") {
          return { sessions: [sess] }; // 没有 statuses 字段
        }
        return {};
      },
    );

    await useSessionStore.getState().loadSessionsForProject("/project-y");

    const state = useSessionStore.getState();
    expect(state.sessionsByProject["/project-y"]).toHaveLength(1);
    // 没有 statuses，不写 map
    expect(state.sessionStatusMap).toEqual({});
  });

  it("statuses 边界职责：server 已把进程池的 stopped 映射成 idle，client 不再校验白名单", async () => {
    const sess = makeSession({
      sessionId: "z1",
      projectPath: "/project-z",
      messageCount: 1,
      firstMessage: "first z1",
    });

    useSessionStore.setState({
      projectTabs: [{ id: "tab-z", name: "Project Z", path: "/project-z" }],
      activeProjectId: "tab-z",
      sessionsByProject: {},
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions" && params?.projectPath === "/project-z") {
          // 模拟「已通过 server 边界处理」的 schema 形态：status 严格是 SessionStatus，
          // 不会出现 "stopped"（那是进程池内部状态，在 server handler 中已映射成 "idle"）。
          return {
            sessions: [sess],
            statuses: [
              { sessionId: "z1", status: "streaming" },
              { sessionId: "z1", status: "compacting" }, // 后写覆盖前写
              { sessionId: "z1", status: "idle" }, // 再次覆盖
            ],
          };
        }
        return {};
      },
    );

    await useSessionStore.getState().loadSessionsForProject("/project-z");

    const map = useSessionStore.getState().sessionStatusMap;
    // 严格按 schema 写入，client 不做白名单校验；最后一条合法 SessionStatus 生效。
    expect(map["z1"]).toBe("idle");
  });

  it("statuses 中 sessionId 缺失/非 string 的条目直接忽略（schema 之外的防御）", async () => {
    const sess = makeSession({
      sessionId: "w1",
      projectPath: "/project-w",
      messageCount: 1,
      firstMessage: "first w1",
    });

    useSessionStore.setState({
      projectTabs: [{ id: "tab-w", name: "Project W", path: "/project-w" }],
      activeProjectId: "tab-w",
      sessionsByProject: {},
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions" && params?.projectPath === "/project-w") {
          return {
            sessions: [sess],
            statuses: [
              null, // 防御：实际不会发生，但 RPC 边界外仍可能传错
              { sessionId: 123, status: "idle" }, // sessionId 不是 string
              { sessionId: "w1", status: "permission" },
            ],
          };
        }
        return {};
      },
    );

    await useSessionStore.getState().loadSessionsForProject("/project-w");

    const map = useSessionStore.getState().sessionStatusMap;
    // 只接受 sessionId 是 string 的条目，w1 正确写入
    expect(map["w1"]).toBe("permission");
    expect(Object.keys(map)).toEqual(["w1"]);
  });
});
