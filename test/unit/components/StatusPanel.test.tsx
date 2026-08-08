import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { BashProcess } from "../../../src/shared/modules/bash";
import type { ProjectTab } from "../../../src/mainview/types";
import type { RemoteProjectRef } from "../../../src/shared/modules/project";

let mockProcesses: BashProcess[] = [];
let mockBackgroundedIds: Set<string> = new Set();
let mockPermissionProfile = "normal";
const mockSetPermissionProfile = vi.fn();
let mockActiveSubsessionId: string | null = null;
let mockProjectTabs: ProjectTab[] = [];
let mockActiveProjectId: string | null = null;
let mockSessionsByProject: Record<string, unknown[]> = {};
let mockRemoteRuntimeBySession: Record<string, unknown> = {};
const mockSetRemoteRuntimeStatus = vi.fn();
const mockApiClient = vi.hoisted(() => ({
  call: vi.fn((method: string) => {
    if (method === "bash.readLog") {
      return Promise.resolve({ lines: [], totalLines: 0, hasMore: false });
    }
    if (method === "project.listRecent") {
      return Promise.resolve({ projects: [] });
    }
    return Promise.resolve(undefined);
  }),
}));
const mockApiCall = mockApiClient.call;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-dom", () => ({
  createPortal: (children: React.ReactNode) => children,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mockApiClient.call,
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
      projectTrust: { trusted: true },
      projectTrustLoading: false,
      trustCurrentProject: vi.fn(),
      executionSandbox: { mode: "off" },
      executionSandboxLoading: false,
      refreshExecutionSandbox: vi.fn(),
      setExecutionSandboxMode: vi.fn(),
      yoloEnabled: false,
      plugins: [],
      skills: [],
      expandedSkill: null,
      expandedPlugin: null,
      expandedMcpServer: null,
      remoteRuntimeBySession: mockRemoteRuntimeBySession,
      setRemoteRuntimeStatus: mockSetRemoteRuntimeStatus,
      toggleYolo: vi.fn(),
      toggleSkillExpanded: vi.fn(),
      toggleSkillEnabled: vi.fn(),
      togglePluginExpanded: vi.fn(),
      toggleMcpExpanded: vi.fn(),
      toggleMcpServer: vi.fn(),
      restartMcpServer: vi.fn(),
      mcpServersBySession: { "test-session": [] },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        activeSessionId: "test-session",
        projectTabs: mockProjectTabs,
        activeProjectId: mockActiveProjectId,
        sessionsByProject: mockSessionsByProject,
        refreshSessionResources: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSessionId: "test-session" }) },
  ),
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { activeSubsessionId: mockActiveSubsessionId };
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
    mockActiveSubsessionId = null;
    mockCollapsedSections = new Set();
    mockProjectTabs = [];
    mockActiveProjectId = null;
    mockSessionsByProject = {};
    mockRemoteRuntimeBySession = {};
    mockApiCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({ lines: [], totalLines: 0, hasMore: false });
      }
      if (method === "project.listRecent") {
        return Promise.resolve({ projects: [] });
      }
      return Promise.resolve(undefined);
    });
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

  it("applies permission changes to the visible subagent session", () => {
    mockActiveSubsessionId = "child-session";

    const { container } = render(<StatusPanel />);
    const fullAccessButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("permissionPresetFull"),
    );

    expect(fullAccessButton).toBeTruthy();
    fireEvent.click(fullAccessButton!);

    expect(mockSetPermissionProfile).toHaveBeenCalledWith("yolo", "child-session");
  });
});

describe("StatusPanel remote section", () => {
  beforeEach(() => {
    mockProcesses = [];
    mockBackgroundedIds = new Set();
    mockPermissionProfile = "normal";
    mockActiveSubsessionId = null;
    mockCollapsedSections = new Set();
    mockProjectTabs = [];
    mockActiveProjectId = null;
    mockSessionsByProject = {};
    mockRemoteRuntimeBySession = {};
    mockApiCall.mockImplementation((method: string) => {
      if (method === "project.listRecent") {
        return Promise.resolve({ projects: [] });
      }
      return Promise.resolve(undefined);
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Standard SSH from the active remote project tab", () => {
    const remote: RemoteProjectRef = {
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/44444",
      localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-xyz",
    };
    mockProjectTabs = [
      {
        id: "remote-tab",
        name: "44444",
        path: remote.localPath,
        runtime: "ssh",
        remote,
      },
    ];
    mockActiveProjectId = "remote-tab";

    const { container } = render(<StatusPanel />);

    expect(container.textContent).toContain("remoteStatusConnected");
    expect(container.textContent).toContain("xyz-mac");
    expect(container.textContent).toContain("remoteModeStandard");
    expect(container.textContent).toContain("/Users/xyz/Projects/44444");
    expect(container.textContent).not.toContain("remoteStatusLocal");
  });

  it("recovers remote project metadata from recent projects when a persisted tab is stale", async () => {
    const remote: RemoteProjectRef = {
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/44444",
      localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-xyz",
    };
    mockProjectTabs = [
      {
        id: "remote-tab",
        name: "44444",
        path: remote.localPath,
        runtime: "ssh",
      },
    ];
    mockActiveProjectId = "remote-tab";
    mockApiCall.mockImplementation((method: string) => {
      if (method === "project.listRecent") {
        return Promise.resolve({
          projects: [{ path: remote.localPath, name: "44444", remote }],
        });
      }
      return Promise.resolve(undefined);
    });

    const { container } = render(<StatusPanel />);

    await waitFor(() => {
      expect(container.textContent).toContain("xyz-mac");
    });
    expect(container.textContent).toContain("remoteModeStandard");
    expect(container.textContent).not.toContain("remoteStatusLocal");
  });

  it("shows Quick Sandbox when the remote tab uses ssh-command", () => {
    const remote: RemoteProjectRef = {
      runtime: "ssh",
      sshRuntimeKind: "ssh-command",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/44444",
      localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-xyz",
    };
    mockProjectTabs = [
      {
        id: "remote-tab",
        name: "44444",
        path: remote.localPath,
        runtime: "ssh",
        remote,
      },
    ];
    mockActiveProjectId = "remote-tab";

    const { container } = render(<StatusPanel />);

    expect(container.textContent).toContain("remoteModeQuick");
    expect(container.textContent).not.toContain("remoteStatusLocal");
  });

  it("hides the remote section for local projects even with stale remote session status", () => {
    mockProjectTabs = [{ id: "local-tab", name: "Local", path: "/Users/me/project" }];
    mockActiveProjectId = "local-tab";
    mockSessionsByProject = {
      "/Users/me/project": [{ sessionId: "test-session", name: "Local Session" }],
    };
    mockRemoteRuntimeBySession = {
      "test-session": {
        enabled: true,
        configured: true,
        status: "error",
        host: "old-remote",
        remoteCwd: "/srv/old",
      },
    };

    const { container } = render(<StatusPanel />);

    expect(container.textContent).not.toContain("remoteRuntime");
    expect(container.textContent).not.toContain("remoteStatusError");
    expect(container.textContent).not.toContain("old-remote");
  });

  it("actively rechecks SSH connectivity when the stored remote status is disconnected", async () => {
    const remote: RemoteProjectRef = {
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/44444",
      localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-xyz",
    };
    mockProjectTabs = [
      {
        id: "remote-tab",
        name: "44444",
        path: remote.localPath,
        runtime: "ssh",
        remote,
      },
    ];
    mockActiveProjectId = "remote-tab";
    mockApiCall.mockImplementation((method: string) => {
      if (method === "agent.remoteSshGetStatus") {
        return Promise.resolve({
          enabled: true,
          configured: true,
          status: "error",
          host: "xyz-mac",
          remoteCwd: "/Users/xyz/Projects/44444",
          localCwd: remote.localPath,
          error: "Agent process crashed",
        });
      }
      if (method === "agent.remoteSshTestConnection") {
        return Promise.resolve({
          ok: true,
          exitCode: 0,
          stdout: "connected",
          stderr: "",
          status: {
            enabled: true,
            configured: true,
            status: "connected",
            host: "xyz-mac",
            remoteCwd: "/Users/xyz/Projects/44444",
            localCwd: remote.localPath,
          },
        });
      }
      if (method === "project.listRecent") {
        return Promise.resolve({ projects: [] });
      }
      return Promise.resolve(undefined);
    });

    render(<StatusPanel />);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith("agent.remoteSshTestConnection", {
        sessionId: "test-session",
        host: "xyz-mac",
        remoteCwd: "/Users/xyz/Projects/44444",
      });
    });
    expect(mockSetRemoteRuntimeStatus).toHaveBeenLastCalledWith("test-session", {
      enabled: true,
      configured: true,
      status: "connected",
      host: "xyz-mac",
      remoteCwd: "/Users/xyz/Projects/44444",
      localCwd: remote.localPath,
    });
  });

  it("falls back to SSH testConnection when remote status lookup fails", async () => {
    const remote: RemoteProjectRef = {
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/44444",
      localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-xyz",
    };
    mockProjectTabs = [
      {
        id: "remote-tab",
        name: "44444",
        path: remote.localPath,
        runtime: "ssh",
        remote,
      },
    ];
    mockActiveProjectId = "remote-tab";
    mockApiCall.mockImplementation((method: string) => {
      if (method === "agent.remoteSshGetStatus") {
        return Promise.reject(new Error("Channel remote-ssh not found"));
      }
      if (method === "agent.remoteSshTestConnection") {
        return Promise.resolve({
          ok: true,
          exitCode: 0,
          stdout: "connected",
          stderr: "",
          status: {
            enabled: true,
            configured: true,
            status: "connected",
            host: "xyz-mac",
            remoteCwd: "/Users/xyz/Projects/44444",
            localCwd: remote.localPath,
          },
        });
      }
      if (method === "project.listRecent") {
        return Promise.resolve({ projects: [] });
      }
      return Promise.resolve(undefined);
    });

    render(<StatusPanel />);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith("agent.remoteSshTestConnection", {
        sessionId: "test-session",
        host: "xyz-mac",
        remoteCwd: "/Users/xyz/Projects/44444",
      });
    });
    expect(mockSetRemoteRuntimeStatus).toHaveBeenLastCalledWith("test-session", {
      enabled: true,
      configured: true,
      status: "connected",
      host: "xyz-mac",
      remoteCwd: "/Users/xyz/Projects/44444",
      localCwd: remote.localPath,
    });
  });
});

describe("StatusPanel permission section", () => {
  beforeEach(() => {
    mockProcesses = [];
    mockBackgroundedIds = new Set();
    mockPermissionProfile = "normal";
    mockActiveSubsessionId = null;
    mockCollapsedSections = new Set();
    mockProjectTabs = [];
    mockActiveProjectId = null;
    mockSessionsByProject = {};
    mockRemoteRuntimeBySession = {};
    mockApiCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({ lines: [], totalLines: 0, hasMore: false });
      }
      if (method === "project.listRecent") {
        return Promise.resolve({ projects: [] });
      }
      return Promise.resolve(undefined);
    });
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

    fireEvent.click(
      buttons.find((button) => button.textContent?.includes("permissionPresetFull"))!,
    );
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("yolo", "test-session");

    fireEvent.click(
      buttons.find((button) => button.textContent?.includes("permissionPresetReadonly"))!,
    );
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("readonly", "test-session");
  });

  it("clicks autopilot permission preset", () => {
    const { container } = render(<StatusPanel />);
    const autopilotButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("permissionPresetAutopilot"),
    );

    expect(autopilotButton).toBeDefined();
    expect(autopilotButton).not.toBeDisabled();
    fireEvent.click(autopilotButton!);
    expect(mockSetPermissionProfile).toHaveBeenCalledWith("autopilot", "test-session");
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
