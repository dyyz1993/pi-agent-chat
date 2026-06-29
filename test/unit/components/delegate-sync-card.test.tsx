/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentBlock, SubagentSessionInfo } from "../../../src/mainview/types";

const hoisted = vi.hoisted(() => ({
  sub: null as SubagentSessionInfo | null,
  sessionStatus: undefined as string | undefined,
  messages: [] as Array<{ role: string; content: ContentBlock[]; isStreaming?: boolean }>,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "coordinator.completed": "Completed",
        "coordinator.running": "Running",
        "coordinator.error": "Failed",
        "coordinator.timeout": "Timed out",
        "coordinator.aborted": "Aborted",
        "coordinator.syncTask": "Subtask",
        "coordinator.idle": "Idle",
        "subagent.view": "View",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      subsessionsByParent: hoisted.sub ? { "/fake/parent.jsonl": [hoisted.sub] } : {},
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        activeSessionId: "sess_parent_001",
        sessionStatusMap: hoisted.sessionStatus
          ? { sess_sub_test_001: hoisted.sessionStatus }
          : {},
        sessionsByProject: {
          "/fake/project": [
            {
              sessionId: "sess_sub_test_001",
              sessionPath: "/fake/sub.jsonl",
            },
          ],
        },
        projectTabs: [{ id: "tab-1", path: "/fake/project" }],
        activeProjectId: "tab-1",
        setActiveProject: vi.fn(),
        setActiveSession: vi.fn(),
        loadSessionsForProject: vi.fn(),
      }),
    ),
    {
      getState: vi.fn(() => ({
        sessionsByProject: {
          "/fake/project": [
            {
              sessionId: "sess_sub_test_001",
              sessionPath: "/fake/sub.jsonl",
            },
          ],
        },
        projectTabs: [{ id: "tab-1", path: "/fake/project" }],
        activeProjectId: "tab-1",
        setActiveProject: vi.fn(),
        setActiveSession: vi.fn(),
        loadSessionsForProject: vi.fn(),
      })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        messagesBySession: hoisted.messages.length > 0 ? { sess_sub_test_001: hoisted.messages } : {},
      }),
    ),
    {
      getState: vi.fn(() => ({
        messagesBySession: {},
      })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: Object.assign(vi.fn(() => true), {
    getState: vi.fn(() => ({ collapseToolCards: true })),
    subscribe: vi.fn(),
  }),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
}));

import { DelegateSyncCard } from "../../../src/mainview/components/chat/tool-renderers/CoordinatorRenderer";

function makeSyncBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "tc-sync-001",
    toolName: "session_delegate_sync",
    args: JSON.stringify({
      title: "Read-only smoke test",
      task: "只读检查当前目录",
      agent: "explore",
    }),
    status: "done",
    output: JSON.stringify({
      sessionId: "sess_sub_test_001",
      status: "completed",
      exitCode: 0,
      finalText: "SUBTASK_SMOKE_OK",
    }),
    details: {
      sessionId: "sess_sub_test_001",
      status: "completed",
      exitCode: 0,
      finalText: "SUBTASK_SMOKE_OK",
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  hoisted.sub = null;
  hoisted.sessionStatus = undefined;
  hoisted.messages = [];
});

describe("DelegateSyncCard", () => {
  it("renders task, result, child session metadata, and a jump control when expanded", () => {
    hoisted.sub = {
      sessionId: "sess_sub_test_001",
      sessionPath: "/fake/sub.jsonl",
      description: "Read-only smoke test",
      instruction: "只读检查当前目录",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      finalText: "SUBTASK_SMOKE_OK",
    };

    render(<DelegateSyncCard block={makeSyncBlock()} />);

    fireEvent.click(screen.getByText("Read-only smoke test"));

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("只读检查当前目录")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("SUBTASK_SMOKE_OK")).toBeInTheDocument();
    expect(screen.getByText("Session sess_sub_test_001")).toBeInTheDocument();
    expect(screen.getByTitle("View")).toBeInTheDocument();
  });

  it("prefers terminal completion evidence over stale streaming session status", () => {
    hoisted.sessionStatus = "streaming";
    hoisted.sub = {
      sessionId: "sess_sub_test_001",
      sessionPath: "/fake/sub.jsonl",
      description: "Read-only smoke test",
      instruction: "只读检查当前目录",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      finalText: "SUBTASK_SMOKE_OK",
    };
    hoisted.messages = [
      {
        role: "assistant",
        isStreaming: true,
        content: [
          { type: "text", text: "已经完成" },
          {
            type: "toolExecution",
            toolCallId: "tool-1",
            toolName: "bash",
            args: "",
            status: "running",
          },
        ],
      },
    ];

    render(<DelegateSyncCard block={makeSyncBlock({ status: "running" })} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).toBeNull();

    fireEvent.click(screen.getByText("Read-only smoke test"));

    expect(screen.queryByText("Waiting for the delegated session to continue…")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("treats final markdown output as terminal even when the tool block is still marked running", () => {
    hoisted.sessionStatus = "streaming";
    render(
      <DelegateSyncCard
        block={makeSyncBlock({
          status: "running",
          output: "## 最终总结\n\n全部完成。",
          details: { sessionId: "sess_sub_test_001" },
        })}
      />,
    );

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).toBeNull();

    fireEvent.click(screen.getByText("Read-only smoke test"));

    expect(screen.queryByText("等待子任务继续响应...")).toBeNull();
    expect(screen.getByRole("heading", { name: "最终总结" })).toBeInTheDocument();
  });

  it("uses the shared dark-mode markdown styling for final output", () => {
    render(
      <DelegateSyncCard
        block={makeSyncBlock({
          output: "## 最终总结\n\n全部完成。",
          details: { sessionId: "sess_sub_test_001", status: "completed" },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Read-only smoke test"));

    const heading = screen.getByRole("heading", { name: "最终总结" });
    expect(heading.closest(".prose")).toHaveClass("dark:prose-invert");
  });
});
