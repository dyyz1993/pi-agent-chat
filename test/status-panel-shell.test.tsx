import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { BashProcess } from "../src/shared/modules/bash";

let mockProcesses: BashProcess[] = [];
let mockBackgroundedIds: Set<string> = new Set();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-dom", () => ({
  createPortal: (children: React.ReactNode) => children,
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: () => {},
  },
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      processesBySession: { "test-session": mockProcesses },
      subscribedOutputs: new Set(),
      backgroundedIds: mockBackgroundedIds,
    };
    return selector ? selector(state) : state;
  },
  useShallow: (fn: (s: unknown) => unknown) => fn,
}));

let mockCollapsedSections: Set<string> = new Set();
const mockToggleSection = vi.fn();

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      collapsedSections: mockCollapsedSections,
      toggleSection: mockToggleSection,
      yoloEnabled: false,
      plugins: [],
      skills: [],
      expandedSkill: null,
      expandedPlugin: null,
      expandedMcpServer: null,
      toggleYolo: vi.fn(),
      toggleSkillExpanded: vi.fn(),
      toggleSkillEnabled: vi.fn(),
      togglePluginExpanded: vi.fn(),
      toggleMcpExpanded: vi.fn(),
      toggleMcpServer: vi.fn(),
      restartMcpServer: vi.fn(),
      mcpServers: [],
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        activeSessionId: "test-session",
        todosBySession: {},
        refreshSessionResources: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSessionId: "test-session" }) },
  ),
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { activeSubsessionId: undefined };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { statusBySession: {} };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../src/mainview/components/bash-panel/BashPanel", () => ({
  BashProcessCard: ({ process, onOpenLog }: { process: BashProcess; onOpenLog: () => void }) => (
    <div data-testid="bash-process-card" data-tool-call-id={process.toolCallId}>
      <span data-testid="card-command">{process.command}</span>
      <button data-testid="card-view-log" onClick={onOpenLog}>
        View Log
      </button>
    </div>
  ),
  LogViewer: ({
    logPath,
    toolCallId,
    onClose,
  }: {
    logPath: string;
    toolCallId: string;
    onClose: () => void;
  }) => (
    <div data-testid="log-viewer">
      <span data-testid="log-path">{logPath}</span>
      <span data-testid="log-toolcall">{toolCallId}</span>
      <button data-testid="log-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("../../utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

import { StatusPanel } from "../src/mainview/components/status-panel/StatusPanel";

function makeProcess(overrides: Partial<BashProcess> & { toolCallId: string }): BashProcess {
  return {
    command: "npm test",
    cwd: "/project",
    startedAt: Date.now() - 1000,
    output: "done",
    status: "done",
    ...overrides,
  };
}

function findShellSectionButton(container: HTMLElement): HTMLButtonElement | null {
  const buttons = container.querySelectorAll("button");
  for (const btn of buttons) {
    if (btn.textContent?.includes("shell")) return btn;
  }
  return null;
}

describe("StatusPanel shell section", () => {
  beforeEach(() => {
    mockProcesses = [];
    mockBackgroundedIds = new Set();
    mockCollapsedSections = new Set();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows idle when no background processes", () => {
    const { container } = render(<StatusPanel />);
    expect(container.textContent).toContain("idle");
    expect(container.querySelectorAll("[data-testid='bash-process-card']").length).toBe(0);
  });

  it("shows BashProcessCard for each backgrounded process", () => {
    const p1 = makeProcess({ toolCallId: "tc-1", command: "npm run build" });
    const p2 = makeProcess({ toolCallId: "tc-2", command: "npm test" });
    mockProcesses = [p1, p2];
    mockBackgroundedIds = new Set(["tc-1", "tc-2"]);

    const { container } = render(<StatusPanel />);
    const cards = container.querySelectorAll("[data-testid='bash-process-card']");
    expect(cards.length).toBe(2);

    const commands = container.querySelectorAll("[data-testid='card-command']");
    expect(commands[0]?.textContent).toBe("npm run build");
    expect(commands[1]?.textContent).toBe("npm test");
  });

  it("does NOT show non-backgrounded processes", () => {
    const bg = makeProcess({ toolCallId: "tc-bg", command: "bg-cmd" });
    const fg = makeProcess({ toolCallId: "tc-fg", command: "fg-cmd" });
    mockProcesses = [bg, fg];
    mockBackgroundedIds = new Set(["tc-bg"]);

    const { container } = render(<StatusPanel />);
    const cards = container.querySelectorAll("[data-testid='bash-process-card']");
    expect(cards.length).toBe(1);
    expect(cards[0]?.getAttribute("data-tool-call-id")).toBe("tc-bg");
  });

  it("opens LogViewer when clicking View Log on a card", () => {
    const p = makeProcess({ toolCallId: "tc-log", logPath: "/tmp/test.log" });
    mockProcesses = [p];
    mockBackgroundedIds = new Set(["tc-log"]);

    const { container } = render(<StatusPanel />);
    expect(container.querySelector("[data-testid='log-viewer']")).toBeNull();

    const viewLogBtn = container.querySelector("[data-testid='card-view-log']");
    expect(viewLogBtn).not.toBeNull();
    fireEvent.click(viewLogBtn!);

    const viewer = container.querySelector("[data-testid='log-viewer']");
    expect(viewer).not.toBeNull();
    expect(container.querySelector("[data-testid='log-path']")?.textContent).toBe("/tmp/test.log");
    expect(container.querySelector("[data-testid='log-toolcall']")?.textContent).toBe("tc-log");
  });

  it("closes LogViewer when clicking close", () => {
    const p = makeProcess({ toolCallId: "tc-close", logPath: "/tmp/close.log" });
    mockProcesses = [p];
    mockBackgroundedIds = new Set(["tc-close"]);

    const { container } = render(<StatusPanel />);

    fireEvent.click(container.querySelector("[data-testid='card-view-log']")!);
    expect(container.querySelector("[data-testid='log-viewer']")).not.toBeNull();

    fireEvent.click(container.querySelector("[data-testid='log-close']")!);
    expect(container.querySelector("[data-testid='log-viewer']")).toBeNull();
  });

  it("collapsible section toggles on header click", () => {
    const { container } = render(<StatusPanel />);
    const shellBtn = findShellSectionButton(container);
    expect(shellBtn).not.toBeNull();

    fireEvent.click(shellBtn!);
    expect(mockToggleSection).toHaveBeenCalledWith("shell");
  });
});
