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

import { useHooksStore } from "../../../src/mainview/stores/use-hooks-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { HooksPanel } from "../../../src/mainview/components/hooks-panel/HooksPanel";
import type { HookLogEntry, HookConfigSnapshot } from "../../../src/mainview/stores/use-hooks-store";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
    { path: "/project/.claude/settings.json", scope: "project", exists: true, disabled: false },
  ],
  events: [
    {
      name: "PreToolUse",
      groups: [
        { matcher: "Bash", source: "project", hooks: [{ type: "command", command: "echo ok" }] },
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

  it("filter dropdown changes trigger re-fetch", async () => {
    Object.assign(sessionState, { activeSessionId: "sess-1" });
    mockCall.mockResolvedValue({
      entries: [],
      ruleStats: [],
      totalExecutions: 0,
      configSnapshot: null,
    });
    render(<HooksPanel />);

    const select = screen.getByDisplayValue("All events");
    fireEvent.change(select, { target: { value: "PreToolUse" } });

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
    expect(screen.getByText("echo ok")).toBeInTheDocument();
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
