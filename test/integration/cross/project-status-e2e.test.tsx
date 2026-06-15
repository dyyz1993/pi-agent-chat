/**
 * @vitest-environment happy-dom
 *
 * E2E 测试（DOM 层）：渲染真实 TabBar + 真实 store + mock apiClient，
 * 验证非活跃项目的 status 与 sessions 在 project.scanSessions 一次 RPC 后
 * 立刻反映到 DOM 上（无 3s 延迟，无 batchGetSessionsStatus）。
 * 这是「status 与列表同源，刷新即正确」的最强证明。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

vi.mock("../../../src/mainview/lib/agent-event-handler", () => ({
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

vi.mock("../../../src/mainview/components/settings/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { TabBar } from "../../../src/mainview/components/tab-bar/TabBar";

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

afterEach(() => {
  cleanup();
});

/**
 * 找包含指定项目名的 tab 元素，并返回其内部 status dot 的 className。
 * 找到第一个匹配 class 包含 bg-status-* 的元素。
 */
function getTabDotClass(tabName: string): string | null {
  // TabBar 的 tab 是带 role=tab 的 button，里面包含项目名
  const candidates = document.querySelectorAll('[role="tab"], [data-tab-id], button');
  for (const t of Array.from(candidates)) {
    if (t.textContent?.includes(tabName)) {
      const dot = t.querySelector('[class*="bg-status-"]');
      if (dot) return dot.className;
    }
  }
  return null;
}

describe("TabBar E2E：project.scanSessions 同源返回 status，dot 立即反映（无 3s 延迟）", () => {
  it("非活跃项目有 streaming session 时，scan 返回的 statuses 立刻让 dot 变 warning 黄色", async () => {
    const activeSess = makeSession({
      sessionId: "a1",
      projectPath: "/project-a",
      messageCount: 1,
      firstMessage: "hi",
    });
    const bSess = makeSession({
      sessionId: "b1",
      projectPath: "/project-b",
      messageCount: 3,
      firstMessage: "first b",
    });

    useSessionStore.setState({
      projectTabs: [
        { id: "tab-a", name: "Alpha", path: "/project-a" },
        { id: "tab-b", name: "Beta", path: "/project-b" },
      ],
      activeProjectId: "tab-a",
      activeSessionId: "a1",
      sessionsByProject: { "/project-a": [activeSess] }, // /project-b 故意空
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions") {
          if (params?.projectPath === "/project-b") {
            // 关键：statuses 与 sessions 同一 RPC 返回
            return {
              sessions: [bSess],
              statuses: [{ sessionId: "b1", status: "streaming" }],
            };
          }
          return { sessions: [] };
        }
        return {};
      },
    );

    render(<TabBar onAddProject={vi.fn()} />);

    // 等待 microtask 跑完（loadSessionsForProject 是 Promise.all 触发的）
    await waitFor(() => {
      const dot = getTabDotClass("Beta");
      expect(dot, "Beta tab should have a status dot").not.toBeNull();
      expect(dot, "Beta dot should be warning yellow immediately").toContain("bg-status-warning");
      expect(dot, "Beta dot should pulse while streaming").toContain("animate-pulse");
    });

    // 不应再调 batchGetSessionsStatus（status 已从 scan 同源带回）
    const batchCalls = apiCallMock.mock.calls.filter(
      (c) => c[0] === "agent.batchGetSessionsStatus",
    );
    expect(batchCalls).toHaveLength(0);

    // 只发了 1 次 project.scanSessions（针对 /project-b）
    const scanCalls = apiCallMock.mock.calls.filter((c) => c[0] === "project.scanSessions");
    expect(scanCalls).toHaveLength(1);
  });

  it("非活跃项目有 permission session 时，scan 返回的 statuses 立刻让 tab 出现权限角标", async () => {
    const activeSess = makeSession({
      sessionId: "a1",
      projectPath: "/project-a",
      messageCount: 1,
      firstMessage: "hi",
    });
    const bSess = makeSession({
      sessionId: "b1",
      projectPath: "/project-b",
      messageCount: 3,
      firstMessage: "first b",
    });

    useSessionStore.setState({
      projectTabs: [
        { id: "tab-a", name: "Alpha", path: "/project-a" },
        { id: "tab-b", name: "Beta", path: "/project-b" },
      ],
      activeProjectId: "tab-a",
      activeSessionId: "a1",
      sessionsByProject: { "/project-a": [activeSess] },
      sessionStatusMap: {},
    });

    apiCallMock.mockImplementation(
      async (method: string, params: { projectPath?: string }) => {
        if (method === "project.scanSessions") {
          if (params?.projectPath === "/project-b") {
            return {
              sessions: [bSess],
              statuses: [{ sessionId: "b1", status: "permission" }],
            };
          }
          return { sessions: [] };
        }
        return {};
      },
    );

    render(<TabBar onAddProject={vi.fn()} />);

    // 立即等待 permission icon 出现
    await waitFor(() => {
      const betaTabs = Array.from(
        document.querySelectorAll('[role="tab"], [data-tab-id], button'),
      ).filter((t) => t.textContent?.includes("Beta"));
      expect(betaTabs.length).toBeGreaterThan(0);
      const betaWithBadge = betaTabs.find((t) =>
        t.querySelector("svg.lucide-message-circle-question-mark"),
      );
      expect(
        betaWithBadge,
        "Beta tab should display a permission icon immediately when status comes from scan",
      ).toBeTruthy();
    });

    // 没有 batch RPC
    const batchCalls = apiCallMock.mock.calls.filter(
      (c) => c[0] === "agent.batchGetSessionsStatus",
    );
    expect(batchCalls).toHaveLength(0);
  });

  it("未加载的项目（scan 还没返回）dot 应该是中性色（淡灰），不能是绿/黄/红", async () => {
    // 防 flicker 关键断言：首屏进入时 sessionsByProject 还没填上，
    // 此时如果直接用 idle 的绿点，用户看到的是「绿一下又变绿然后变黄」strobe。
    // 修复后，未加载的项目 dot 用 bg-text-tertiary/40（淡灰），与 idle 区分开。
    const activeSess = makeSession({
      sessionId: "a1",
      projectPath: "/project-a",
      messageCount: 1,
      firstMessage: "hi",
    });

    useSessionStore.setState({
      projectTabs: [
        { id: "tab-a", name: "Alpha", path: "/project-a" },
        { id: "tab-b", name: "Beta", path: "/project-b" },
      ],
      activeProjectId: "tab-a",
      activeSessionId: "a1",
      // 关键：/project-a 已加载（绿点），/project-b 故意没填（即 sessionsByProject["/project-b"] === undefined）
      sessionsByProject: { "/project-a": [activeSess] },
      sessionStatusMap: { a1: "idle" },
    });

    // scan API 还没 resolve 时，beta tab 仍应该是中性色，不能是绿（idle 默认）
    render(<TabBar onAddProject={vi.fn()} />);

    // 用 querySelector 找到 Beta tab 的 dot span
    // Beta tab 的文字节点包含 "Beta"，紧邻的 w-2 h-2 rounded-full span 就是 dot
    const betaTab = Array.from(
      document.querySelectorAll('[role="tab"], [data-tab-id], button'),
    ).find((t) => t.textContent?.includes("Beta"));
    expect(betaTab, "Beta tab should be in DOM").toBeTruthy();
    const betaDot = betaTab?.querySelector("span.w-2.h-2.rounded-full");
    expect(betaDot, "Beta tab should have a dot span").toBeTruthy();
    const betaClass = betaDot?.className ?? "";
    // 未加载 → 中性淡灰
    expect(
      betaClass.includes("bg-text-tertiary/40") ||
        betaClass.includes("bg-text-tertiary") ||
        betaClass.includes("text-tertiary"),
      `Beta dot must be neutral gray when not loaded, got: ${betaClass}`,
    ).toBe(true);
    // 显式断言不是绿/黄/红（这三种是 streaming/idle/permission，会让人误判）
    expect(betaClass, "Beta dot must not be green when unknown").not.toContain(
      "bg-status-success",
    );
    expect(betaClass, "Beta dot must not be yellow when unknown").not.toContain(
      "bg-status-warning",
    );
    expect(betaClass, "Beta dot must not be red when unknown").not.toContain(
      "bg-status-error",
    );
    // 也不应该有 pulse 动画
    expect(betaClass).not.toContain("animate-pulse");
  });
});
