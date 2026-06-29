/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentBlock, SessionMeta } from "../../../src/mainview/types";

const hoisted = vi.hoisted(() => ({
  delegateSessionStatus: undefined as string | undefined,
  forkSessionStatus: undefined as string | undefined,
}));

function session(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: "session-1",
    name: "Session",
    sessionPath: "/tmp/session-1.jsonl",
    projectPath: "/fake/project",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 1,
    firstMessage: "",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "coordinator.delegateTask": "Delegate task",
        "coordinator.forkTask": "Fork task",
        "coordinator.creating": "Creating",
        "coordinator.forking": "Forking",
        "coordinator.dispatched": "Dispatched",
        "coordinator.running": "Running",
        "coordinator.streaming": "Working",
        "coordinator.error": "Error",
        "coordinator.activity": "Activity",
        "coordinator.waitingNextEvent": "Waiting for the delegated session to continue…",
        "subagent.view": "View",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        activeSessionId: "parent-session",
        sessionStatusMap: {
          ...(hoisted.delegateSessionStatus
            ? { "delegate-session": hoisted.delegateSessionStatus }
            : {}),
          ...(hoisted.forkSessionStatus ? { "fork-session": hoisted.forkSessionStatus } : {}),
        },
        sessionsByProject: {
          "/fake/project": [
            session({ sessionId: "parent-session" }),
            session({
              sessionId: "delegate-session",
              name: "Long delegate task",
              firstMessage: "Long delegate task",
              delegateParentSessionId: "parent-session",
              delegateType: "coordinator",
            }),
            session({
              sessionId: "fork-session",
              name: "Long fork task",
              firstMessage: "Long fork task",
              delegateParentSessionId: "parent-session",
              delegateType: "fork",
            }),
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
            session({ sessionId: "parent-session" }),
            session({
              sessionId: "delegate-session",
              name: "Long delegate task",
              firstMessage: "Long delegate task",
              delegateParentSessionId: "parent-session",
              delegateType: "coordinator",
            }),
            session({
              sessionId: "fork-session",
              name: "Long fork task",
              firstMessage: "Long fork task",
              delegateParentSessionId: "parent-session",
              delegateType: "fork",
            }),
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

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      subsessionsByParent: {},
      subagentStatusMap: {},
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        messagesBySession: {},
      }),
    ),
    {
      getState: vi.fn(() => ({ messagesBySession: {} })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => true),
    {
      getState: vi.fn(() => ({ collapseToolCards: true })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-delegate-activity-store", () => ({
  useDelegateActivityStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      bySession: {},
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-agent-store", () => ({
  useAgentStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        agents: [
          { name: "build", source: "builtin", filePath: "", color: "orange" },
          { name: "explore", source: "builtin", filePath: "", color: "blue" },
        ],
        agentDetailBySession: {},
      }),
    ),
    {
      getState: vi.fn(() => ({ agents: [], agentDetailBySession: {} })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/components/chat/primitives/useJumpToSession", () => ({
  useJumpToSession: vi.fn(() => ({
    canJump: false,
    handleJump: vi.fn(),
  })),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
}));

import {
  DelegateCard,
  ForkCard,
} from "../../../src/mainview/components/chat/tool-renderers/CoordinatorRenderer";

function makeDelegateBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "delegate-call-1",
    toolName: "delegate",
    args: JSON.stringify({
      task: "Long delegate task",
      title: "Long delegate task",
      projectPath: "/fake/project",
    }),
    status: "done",
    output: "",
    details: {
      sessionId: "delegate-session",
    },
    ...overrides,
  };
}

function makeForkBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "fork-call-1",
    toolName: "fork",
    args: JSON.stringify({
      task: "Long fork task",
      title: "Long fork task",
    }),
    status: "done",
    output: "",
    details: {
      sessionId: "fork-session",
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  hoisted.delegateSessionStatus = undefined;
  hoisted.forkSessionStatus = undefined;
});

describe("DelegateCard", () => {
  it("shows the default build agent badge when no agent is specified", () => {
    const { container } = render(<DelegateCard block={makeDelegateBlock()} />);

    const badge = screen.getByText("build");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ color: "#F97316" });
    expect(container.textContent).toContain("Long delegate task");
  });

  it("keeps the card in running state when the delegate session is still streaming", () => {
    hoisted.delegateSessionStatus = "streaming";
    const { container } = render(<DelegateCard block={makeDelegateBlock()} />);

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();

    const icon = container.querySelector(".lucide-user-round-plus, .lucide-user-plus");
    expect(icon?.className).toContain("text-status-info");
  });
});

describe("ForkCard", () => {
  it("shows the default build agent badge when no agent is specified", () => {
    const { container } = render(<ForkCard block={makeForkBlock()} />);

    const badge = screen.getByText("build");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ color: "#F97316" });
    expect(container.textContent).toContain("Long fork task");
  });

  it("keeps the card in running state when the forked session is still streaming", () => {
    hoisted.forkSessionStatus = "streaming";
    const { container } = render(<ForkCard block={makeForkBlock()} />);

    expect(screen.getByText("Working")).toBeInTheDocument();

    const icon = container.querySelector(".lucide-git-fork");
    expect(icon?.className).toContain("text-status-info");
  });
});
