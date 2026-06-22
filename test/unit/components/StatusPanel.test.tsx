import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { BashProcess } from "../../../src/shared/modules/bash";

let mockProcesses: BashProcess[] = [];
let mockBackgroundedIds: Set<string> = new Set();
let mockPermissionProfile = "normal";
const mockSetPermissionProfile = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-dom", () => ({
  createPortal: (children: React.ReactNode) => children,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({ lines: [], totalLines: 0, hasMore: false });
      }
      return Promise.resolve(undefined);
    }),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: () => {},
  },
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
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

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      collapsedSections: mockCollapsedSections,
      toggleSection: mockToggleSection,
      permissionProfile: mockPermissionProfile,
      permissionProfileLoading: false,
      setPermissionProfile: mockSetPermissionProfile,
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

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        activeSessionId: "test-session",
        refreshSessionResources: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSessionId: "test-session" }) },
  ),
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { activeSubsessionId: undefined };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { statusBySession: {} };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

import { StatusPanel } from "../../../src/mainview/components/status-panel/StatusPanel";

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
    mockPermissionProfile = "normal";
    mockCollapsedSections = new Set();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows idle when no background processes", () => {
    const { container } = render(<StatusPanel />);
    expect(container.textContent).toContain("idle");
    expect(container.textContent).not.toContain("npm test");
  });

  it("shows BashProcessCard for each backgrounded process", () => {
    const p1 = makeProcess({ toolCallId: "tc-1", command: "npm run build" });
    const p2 = makeProcess({ toolCallId: "tc-2", command: "npm test" });
    mockProcesses = [p1, p2];
    mockBackgroundedIds = new Set(["tc-1", "tc-2"]);

    const { container } = render(<StatusPanel />);
    expect(container.textContent).toContain("npm run build");
    expect(container.textContent).toContain("npm test");
  });

  it("does NOT show non-backgrounded processes", () => {
    const bg = makeProcess({ toolCallId: "tc-bg", command: "bg-cmd" });
    const fg = makeProcess({ toolCallId: "tc-fg", command: "fg-cmd" });
    mockProcesses = [bg, fg];
    mockBackgroundedIds = new Set(["tc-bg"]);

    const { container } = render(<StatusPanel />);
    expect(container.textContent).toContain("bg-cmd");
    expect(container.textContent).not.toContain("fg-cmd");
  });

  it("opens LogViewer when clicking View Log on a card", () => {
    const p = makeProcess({ toolCallId: "tc-log", logPath: "/tmp/test.log" });
    mockProcesses = [p];
    mockBackgroundedIds = new Set(["tc-log"]);

    const { container } = render(<StatusPanel />);
    expect(container.textContent).not.toContain("test.log");

    const viewLogBtn = container.querySelector('button[title="viewLog"]');
    expect(viewLogBtn).not.toBeNull();
    fireEvent.click(viewLogBtn!);

    expect(container.textContent).toContain("test.log");
  });

  it("closes LogViewer when clicking close", () => {
    const p = makeProcess({ toolCallId: "tc-close", logPath: "/tmp/close.log" });
    mockProcesses = [p];
    mockBackgroundedIds = new Set(["tc-close"]);

    const { container } = render(<StatusPanel />);

    fireEvent.click(container.querySelector('button[title="viewLog"]')!);
    expect(container.textContent).toContain("close.log");

    fireEvent.click(container.querySelector('button[title="close"]')!);
    expect(container.textContent).not.toContain("close.log");
  });

  it("collapsible section toggles on header click", () => {
    const { container } = render(<StatusPanel />);
    const shellBtn = findShellSectionButton(container);
    expect(shellBtn).not.toBeNull();

    fireEvent.click(shellBtn!);
    expect(mockToggleSection).toHaveBeenCalledWith("shell");
  });
});

describe("StatusPanel permission section", () => {
  beforeEach(() => {
    mockProcesses = [];
    mockBackgroundedIds = new Set();
    mockPermissionProfile = "normal";
    mockCollapsedSections = new Set();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the high-frequency permission presets", () => {
    const { container } = render(<StatusPanel />);

    expect(container.textContent).toContain("permissionPresetAsk");
    expect(container.textContent).toContain("permissionPresetAutopilot");
    expect(container.textContent).toContain("permissionPresetFull");
    expect(container.textContent).toContain("permissionPresetReadonly");
  });

  it("clicks available permission presets", () => {
    const { container } = render(<StatusPanel />);
    const buttons = Array.from(container.querySelectorAll("button"));

    fireEvent.click(buttons.find((button) => button.textContent?.includes("permissionPresetFull"))!);
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("yolo");

    fireEvent.click(buttons.find((button) => button.textContent?.includes("permissionPresetReadonly"))!);
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("readonly");
  });

  it("clicks autopilot permission preset", () => {
    const { container } = render(<StatusPanel />);
    const autopilotButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("permissionPresetAutopilot"),
    );

    expect(autopilotButton).toBeDefined();
    expect(autopilotButton).not.toBeDisabled();
    fireEvent.click(autopilotButton!);
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("autopilot");
  });

  it("expands advanced permission details", () => {
    const { container } = render(<StatusPanel />);
    expect(container.textContent).not.toContain("permissionAccessAxis");

    const advancedButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("permissionAdvancedShow"),
    );
    expect(advancedButton).toBeDefined();
    fireEvent.click(advancedButton!);

    expect(container.textContent).toContain("permissionAccessAxis");
    expect(container.textContent).toContain("permissionApprovalAxis");
    expect(container.textContent).toContain("permissionScopeAxis");
  });
});
