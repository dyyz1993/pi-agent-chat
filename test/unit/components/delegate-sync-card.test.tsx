/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentBlock, SubagentSessionInfo } from "../../../src/mainview/types";

const hoisted = vi.hoisted(() => ({
  sub: null as SubagentSessionInfo | null,
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
        sessionStatusMap: {},
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
});
