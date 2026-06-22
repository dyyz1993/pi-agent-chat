import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { PermissionsPanel } from "../../../src/mainview/components/permissions-panel/PermissionsPanel";
import {
  usePermissionRulesStore,
  type PermissionRule,
} from "../../../src/mainview/stores/use-permission-rules-store";

const sessionState = {
  activeSessionId: null as string | null,
};

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
    {
      getState: () => sessionState,
      setState: (patch: Partial<typeof sessionState>) => Object.assign(sessionState, patch),
    },
  ),
}));

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

const hookRule: PermissionRule = {
  id: "hook-rule",
  provider: "pi-hooks",
  subject: "hook.approval",
  pattern: "PreToolUse|Bash|Bash|echo%20ok|*",
  action: "allow",
  scope: "project",
  createdAt: "2026-06-21T10:00:00.000Z",
  metadata: {
    command: "echo ok",
    hookCommand: "node hook.js",
    matchKind: "glob",
  },
};

const dangerousRule: PermissionRule = {
  id: "danger-rule",
  provider: "dangerous-command",
  subject: "bash.command",
  pattern: "rm -rf *",
  action: "deny",
  scope: "project",
  createdAt: "2026-06-21T10:05:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionState.activeSessionId = null;
  usePermissionRulesStore.setState({
    bySession: {},
    activeProvider: "all",
    pendingDeleteId: null,
  });
  mockCall.mockResolvedValue({ permissions: { rules: [] } });
});

afterEach(() => {
  cleanup();
});

describe("PermissionsPanel", () => {
  it("renders an empty state without an active session", () => {
    render(<PermissionsPanel />);

    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("No active session")).toBeInTheDocument();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("loads and displays permission rules for the active session", async () => {
    sessionState.activeSessionId = "sess-1";
    mockCall.mockResolvedValueOnce({ permissions: { rules: [hookRule, dangerousRule] } });

    render(<PermissionsPanel />);

    await waitFor(() => {
      expect(screen.getAllByText("pi-hooks").length).toBeGreaterThanOrEqual(1);
    });
    expect(mockCall).toHaveBeenCalledWith("agent.getSettings", {
      sessionId: "sess-1",
      scope: "project",
    });
    expect(screen.getAllByText("dangerous-command").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2 rules")).toBeInTheDocument();
    expect(screen.getByText("echo ok")).toBeInTheDocument();
  });

  it("filters rules by provider", async () => {
    sessionState.activeSessionId = "sess-1";
    mockCall.mockResolvedValueOnce({ permissions: { rules: [hookRule, dangerousRule] } });

    render(<PermissionsPanel />);

    await waitFor(() => {
      expect(screen.getAllByText("dangerous-command").length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "pi-hooks" }));

    expect(screen.getAllByText("pi-hooks").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("rm -rf *")).not.toBeInTheDocument();
  });

  it("deletes a rule after inline confirmation", async () => {
    sessionState.activeSessionId = "sess-1";
    mockCall.mockResolvedValueOnce({ permissions: { rules: [hookRule, dangerousRule] } });
    mockCall.mockResolvedValueOnce({ ok: true });

    render(<PermissionsPanel />);

    await waitFor(() => {
      expect(screen.getAllByText("pi-hooks").length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByTitle("Delete rule")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("agent.setSettings", {
        sessionId: "sess-1",
        scope: "project",
        settings: { permissions: { rules: [dangerousRule] } },
      });
    });
    expect(screen.queryByText("hook.approval")).not.toBeInTheDocument();
    expect(screen.getAllByText("dangerous-command").length).toBeGreaterThanOrEqual(1);
  });
});
