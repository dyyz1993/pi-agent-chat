import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const sessionState = {
  activeSessionId: null as string | null,
  sessionsByProject: {} as Record<string, unknown[]>,
  projectTabs: [] as Array<{
    id: string;
    name: string;
    path: string;
    active?: boolean;
    connected?: boolean;
  }>,
  activeProjectId: null as string | null,
};

const mockOpenFile = vi.hoisted(() => vi.fn());

function getSessionState() {
  return sessionState;
}

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue("sub-1"),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  function useSessionStore(selector: (s: ReturnType<typeof getSessionState>) => unknown) {
    return selector(getSessionState());
  }
  useSessionStore.getState = () => getSessionState();
  useSessionStore.setState = (p: Partial<ReturnType<typeof getSessionState>>) =>
    Object.assign(sessionState, p);
  return { useSessionStore };
});

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: (selector: (s: { openFile: typeof mockOpenFile }) => unknown) =>
    selector({ openFile: mockOpenFile }),
}));

import { useHooksStore } from "../../../src/mainview/stores/use-hooks-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { HooksPanel } from "../../../src/mainview/components/hooks-panel/HooksPanel";
import type {
  HookLogEntry,
  HookConfigSnapshot,
} from "../../../src/mainview/stores/use-hooks-store";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenFile.mockReset();
  mockCall.mockResolvedValue({
    entries: [],
    ruleStats: [],
    totalExecutions: 0,
    configSnapshot: null,
  });

  useHooksStore.setState({
    bySession: {},
    activeTab: "activity",
  });

  Object.assign(sessionState, {
    activeSessionId: null,
    sessionsByProject: {},
    projectTabs: [],
    activeProjectId: null,
  });
});

afterEach(() => {
  cleanup();
});

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

const mockConfigSnapshot: HookConfigSnapshot = {
  sources: [
    { path: "/Users/tester/.claude/settings.json", scope: "global", exists: true, disabled: false },
    { path: "/project/.claude/settings.json", scope: "project", exists: true, disabled: false },
    { path: ".pi/settings.json", scope: "pi-project", exists: true, disabled: false },
  ],
  events: [
    {
      name: "PreToolUse",
      groups: [
        {
          matcher: "Bash",
          source: "global",
          hooks: [{ type: "command", command: "bash ~/.claude/hooks/pre-tool-use.sh" }],
        },
        {
          matcher: "write",
          source: "pi-project",
          hooks: [{ type: "command", command: ".pi/hooks/guard-write.sh" }],
        },
      ],
    },
  ],
};

async function waitForInitialFetch() {
  await waitFor(() => {
    expect(mockCall).toHaveBeenCalledWith(
      "hooks.getLog",
      expect.objectContaining({ sessionId: "sess-1" }),
    );
  });
}

describe("HooksPanel", () => {
  it("renders Hooks header", () => {
    render(<HooksPanel />);
    expect(screen.getByText("Hooks")).toBeInTheDocument();
  });

  it("shows No hook activity empty state in Activity tab when no entries", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();
    expect(screen.getByText("No hook activity")).toBeInTheDocument();
  });

  it("shows execution count from totalExecutions", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    useHooksStore.setState({
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [],
          totalExecutions: 42,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("42 executions")).toBeInTheDocument();
    });
  });

  it("renders entry rows when entries exist", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    useHooksStore.setState({
      bySession: {
        "sess-1": {
          entries: [
            { ...mockEntry, id: 1, toolName: "Bash", decision: "allow", event: "PreToolUse" },
            {
              ...mockEntry,
              id: 2,
              toolName: "Read",
              decision: "block",
              event: "PostToolUse",
            },
          ],
          ruleStats: [],
          totalExecutions: 2,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Read")).toBeInTheDocument();
    });
    expect(screen.getByText("allow")).toBeInTheDocument();
    expect(screen.getByText("block")).toBeInTheDocument();
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
  });

  it("expanding an entry shows snippet and details", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    useHooksStore.setState({
      bySession: {
        "sess-1": {
          entries: [{ ...mockEntry, id: 1, snippet: "echo secret", command: "echo ok" }],
          ruleStats: [],
          totalExecutions: 1,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByText("Bash")[0]);

    await waitFor(() => {
      expect(screen.getByText("echo secret")).toBeInTheDocument();
    });
    expect(screen.getByText(/exit: 0/)).toBeInTheDocument();
  });

  it("renders hook command script path as the openable file link", async () => {
    Object.assign(sessionState, {
      activeSessionId: "sess-1",
      activeProjectId: "project-1",
      projectTabs: [{ id: "project-1", name: "Demo", path: "/project/测试 demo" }],
    });
    render(<HooksPanel />);
    await waitForInitialFetch();

    useHooksStore.setState({
      bySession: {
        "sess-1": {
          entries: [
            {
              ...mockEntry,
              id: 1,
              decision: "block",
              reason: "写入被拒绝: /opt/pi-agent-permission-test.txt 不在白名单内",
              snippet: "/opt/pi-agent-permission-test.txt",
              command: ".pi/hooks/guard-write.sh",
            },
          ],
          ruleStats: [],
          totalExecutions: 1,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByText("Bash")[0]);

    expect(screen.getByText("/opt/pi-agent-permission-test.txt")).toBeInTheDocument();
    expect(screen.queryByTitle("Open /opt/pi-agent-permission-test.txt")).not.toBeInTheDocument();

    const commandLink = await screen.findByTitle(
      "Open /project/测试 demo/.pi/hooks/guard-write.sh",
    );
    fireEvent.click(commandLink);

    expect(mockOpenFile).toHaveBeenCalledWith({
      name: "guard-write.sh",
      path: "/project/测试 demo/.pi/hooks/guard-write.sh",
      type: "file",
    });
  });

  it("filter dropdown changes trigger re-fetch", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    mockCall.mockResolvedValue({
      entries: [],
      ruleStats: [],
      totalExecutions: 0,
      configSnapshot: null,
    });
    render(<HooksPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Filter hook events" }));
    fireEvent.click(screen.getByRole("option", { name: "PreToolUse" }));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith(
        "hooks.getLog",
        expect.objectContaining({ event: "PreToolUse" }),
      );
    });
  });

  it("clear button calls clearLog", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    mockCall.mockResolvedValue(undefined);
    render(<HooksPanel />);
    await waitForInitialFetch();

    useHooksStore.setState({
      bySession: {
        "sess-1": {
          entries: [mockEntry],
          ruleStats: [],
          totalExecutions: 1,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTitle("Clear log")).toBeInTheDocument();
    });

    const clearBtn = screen.getByTitle("Clear log");
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("hooks.clear", { sessionId: "sess-1" });
    });
  });

  it("switching to Rules tab shows No rules configured when empty", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    await waitFor(() => {
      expect(screen.getByText("No rules configured")).toBeInTheDocument();
    });
  });

  it("Rules tab renders rule stats rows when data exists", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    useHooksStore.setState({
      activeTab: "rules",
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [
            {
              matcher: "Bash",
              event: "PreToolUse",
              hookType: "command",
              command: "echo ok",
              source: "project",
              allowCount: 5,
              blockCount: 1,
              askCount: 0,
            },
          ],
          totalExecutions: 6,
          configSnapshot: null,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Rule Stats")).toBeInTheDocument();
    });
    expect(screen.getByText("5 allow")).toBeInTheDocument();
    expect(screen.getByText("1 block")).toBeInTheDocument();
  });

  it("Rules tab renders config sources section", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    useHooksStore.setState({
      activeTab: "rules",
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [],
          totalExecutions: 0,
          configSnapshot: mockConfigSnapshot,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Config Sources")).toBeInTheDocument();
    });
    expect(screen.getByText("/project/.claude/settings.json")).toBeInTheDocument();
    expect(screen.getAllByText("project").length).toBeGreaterThanOrEqual(1);
  });

  it("Rules tab renders config events section", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    useHooksStore.setState({
      activeTab: "rules",
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [],
          totalExecutions: 0,
          configSnapshot: mockConfigSnapshot,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Configured Events")).toBeInTheDocument();
    });
    expect(screen.getByText("PreToolUse")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("~/.claude/hooks/pre-tool-use.sh")).toBeInTheDocument();
  });

  it("Rules tab opens rule commands, config sources, and configured hook commands", async () => {
    Object.assign(sessionState, {
      activeSessionId: "sess-1",
      activeProjectId: "project-1",
      projectTabs: [{ id: "project-1", name: "Demo", path: "/project/测试 demo" }],
    });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    useHooksStore.setState({
      activeTab: "rules",
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [
            {
              matcher: "write",
              event: "PreToolUse",
              hookType: "command",
              command: ".pi/hooks/guard-write.sh",
              source: "pi-project",
              allowCount: 0,
              blockCount: 1,
              askCount: 0,
            },
          ],
          totalExecutions: 1,
          configSnapshot: mockConfigSnapshot,
          loading: false,
          expandedEntry: null,
        },
      },
    });

    const ruleCommandLinks = await screen.findAllByTitle(
      "Open /project/测试 demo/.pi/hooks/guard-write.sh",
    );
    fireEvent.click(ruleCommandLinks[0]);
    expect(mockOpenFile).toHaveBeenLastCalledWith({
      name: "guard-write.sh",
      path: "/project/测试 demo/.pi/hooks/guard-write.sh",
      type: "file",
    });

    const projectSettingsLink = await screen.findByTitle(
      "Open /project/测试 demo/.pi/settings.json",
    );
    fireEvent.click(projectSettingsLink);
    expect(mockOpenFile).toHaveBeenLastCalledWith({
      name: "settings.json",
      path: "/project/测试 demo/.pi/settings.json",
      type: "file",
    });

    const globalHookLink = await screen.findByTitle(
      "Open /Users/tester/.claude/hooks/pre-tool-use.sh",
    );
    expect(
      screen.queryByTitle("Open bash ~/.claude/hooks/pre-tool-use.sh"),
    ).not.toBeInTheDocument();
    fireEvent.click(globalHookLink);
    expect(mockOpenFile).toHaveBeenLastCalledWith({
      name: "pre-tool-use.sh",
      path: "/Users/tester/.claude/hooks/pre-tool-use.sh",
      type: "file",
    });
  });

  it("keeps long hook commands readable on narrow screens", async () => {
    Object.assign(sessionState, {
      activeSessionId: "sess-1",
      activeProjectId: "project-1",
      projectTabs: [{ id: "project-1", name: "Demo", path: "/project/mobile hooks" }],
    });
    render(<HooksPanel />);
    await waitForInitialFetch();

    fireEvent.click(screen.getByText("Rules"));

    useHooksStore.setState({
      activeTab: "rules",
      bySession: {
        "sess-1": {
          entries: [],
          ruleStats: [
            {
              matcher: "Bash|RN|RM|VeryLongHookMatcherForMobile",
              event: "PreToolUse",
              hookType: "command",
              command: "bash .pi/hooks/mobile-readable-instructions-RN-renovate-RM-reinstall.sh",
              source: "pi-project",
              allowCount: 1,
              blockCount: 1,
              askCount: 1,
            },
          ],
          totalExecutions: 3,
          configSnapshot: {
            ...mockConfigSnapshot,
            events: [
              {
                name: "PreToolUse",
                groups: [
                  {
                    matcher: "Bash|RN|RM|VeryLongHookMatcherForMobile",
                    source: "pi-project",
                    hooks: [
                      {
                        type: "command",
                        command:
                          "bash .pi/hooks/mobile-readable-instructions-RN-renovate-RM-reinstall.sh",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          loading: false,
          expandedEntry: null,
        },
      },
    });

    const ruleCommand = await screen.findAllByTestId("hook-command-code");
    expect(ruleCommand[0]).toHaveClass("whitespace-normal");
    expect(ruleCommand[0]).toHaveClass("break-words");
    expect(ruleCommand[0]).not.toHaveClass("truncate");
    expect(
      screen.getAllByText(/mobile-readable-instructions-RN-renovate-RM-reinstall/).length,
    ).toBeGreaterThan(0);
  });

  it("refresh button calls fetchLog", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    mockCall.mockResolvedValue({
      entries: [],
      ruleStats: [],
      totalExecutions: 0,
      configSnapshot: null,
    });
    render(<HooksPanel />);

    const refreshBtn = screen.getByTitle("Refresh");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      const calls = mockCall.mock.calls.filter(
        (c: unknown[]) => (c as [string])[0] === "hooks.getLog",
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
