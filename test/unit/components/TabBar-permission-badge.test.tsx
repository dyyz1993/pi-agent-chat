import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ProjectTab, SessionMeta } from "../../../src/mainview/types";

const sessionStoreState: Record<string, unknown> = {};
const uiDialogStoreState: Record<string, unknown> = {};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(sessionStoreState),
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(uiDialogStoreState),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../../../src/mainview/components/settings/SettingsPanel", () => ({
  SettingsPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-panel">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { TabBar, formatTabName } from "../../../src/mainview/components/tab-bar/TabBar";

function setupStore(overrides: {
  tabs?: ProjectTab[];
  sessionsByProject?: Record<
    string,
    Array<Partial<SessionMeta> & { sessionId: string; name: string }>
  >;
  statusMap?: Record<string, string>;
  activeProjectId?: string;
  activeSessionId?: string;
  lastActiveSessionByProject?: Record<string, string>;
  allPending?: {
    requestId: string;
    sessionId: string;
    method: "confirm" | "input" | "select" | "editor";
  }[];
}) {
  Object.assign(sessionStoreState, {
    projectTabs: overrides.tabs ?? [],
    sessionsByProject: overrides.sessionsByProject ?? {},
    sessionStatusMap: overrides.statusMap ?? {},
    activeProjectId: overrides.activeProjectId ?? overrides.tabs?.[0]?.id ?? "",
    activeSessionId: overrides.activeSessionId ?? "",
    lastActiveSessionByProject: overrides.lastActiveSessionByProject ?? {},
    setActiveProject: vi.fn(),
    removeProjectTab: vi.fn(),
    reorderProjectTabs: vi.fn(),
    loadSessionsForProject: vi.fn(),
  });
  Object.assign(uiDialogStoreState, {
    pending: overrides.allPending ?? [],
  });
}

function countPermissionIcons() {
  return document.querySelectorAll("svg.lucide-message-circle-question-mark").length;
}

function getTabByName(tabName: string) {
  return screen.getAllByRole("tab").find((t) => t.textContent?.includes(tabName)) ?? null;
}

function getPermissionIconForTab(tabName: string) {
  const tab = getTabByName(tabName);
  return tab?.querySelector("svg.lucide-message-circle-question-mark") ?? null;
}

function getBadgeTextForTab(tabName: string): string | null {
  const icon = getPermissionIconForTab(tabName);
  if (!icon) return null;
  const badge = icon.parentElement?.querySelector("span.absolute");
  return badge?.textContent ?? null;
}

describe("TabBar permission icon badge", () => {
  afterEach(() => {
    cleanup();
  });

  it("middle-truncates long project names while preserving the tail", () => {
    const displayName = formatTabName("pi-agent-remote-ui-create-1782223074368");

    expect(displayName).toBe("pi-agent-remote***-1782223074368");
    expect(displayName.length).toBeLessThanOrEqual(32);
  });

  it("keeps the full project name in tab metadata when the label is shortened", () => {
    const longName = "pi-agent-remote-ui-create-1782223074368";
    setupStore({
      tabs: [{ id: "long", name: longName, path: "/long" }],
    });

    render(<TabBar onAddProject={vi.fn()} />);

    const tab = screen.getByRole("tab", { name: longName });
    expect(tab).toHaveAttribute("title", longName);
    expect(tab).toHaveTextContent("pi-agent-remote***-1782223074368");
    expect(tab).not.toHaveTextContent(longName);
  });

  it("shows no permission icon when no sessions have permission status", () => {
    setupStore({
      tabs: [
        { id: "t1", name: "Project A", path: "/a" },
        { id: "t2", name: "Project B", path: "/b" },
      ],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "Session 1" }],
        "/b": [{ sessionId: "s2", name: "Session 2" }],
      },
      statusMap: { s1: "idle", s2: "streaming" },
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(countPermissionIcons()).toBe(0);
  });

  it("shows a delegate identity badge for the visible delegate session", () => {
    setupStore({
      tabs: [{ id: "t1", name: "Project A", path: "/a" }],
      sessionsByProject: {
        "/a": [
          {
            sessionId: "sess_coord_123",
            name: "Delegate work",
            delegateParentSessionId: "sess_parent",
            delegateType: "coordinator",
          },
        ],
      },
      activeSessionId: "sess_coord_123",
      activeProjectId: "t1",
    });

    render(<TabBar onAddProject={vi.fn()} />);

    const badge = screen.getByTestId("tab-session-identity-badge");
    expect(badge).toHaveTextContent("委派");
    expect(badge).toHaveAttribute("data-session-kind", "delegate");
  });

  it("shows permission icon only on the tab with permission sessions", () => {
    setupStore({
      tabs: [
        { id: "t1", name: "Project A", path: "/a" },
        { id: "t2", name: "Project B", path: "/b" },
      ],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "Session 1" }],
        "/b": [{ sessionId: "s2", name: "Session 2" }],
      },
      statusMap: { s1: "permission", s2: "idle" },
      allPending: [{ requestId: "r1", sessionId: "s1", method: "confirm" }],
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(countPermissionIcons()).toBe(1);
    expect(getPermissionIconForTab("Project A")).not.toBeNull();
    expect(getPermissionIconForTab("Project B")).toBeNull();
  });

  it("shows permission icon on multiple tabs with respective counts", () => {
    setupStore({
      tabs: [
        { id: "t1", name: "Project A", path: "/a" },
        { id: "t2", name: "Project B", path: "/b" },
        { id: "t3", name: "Project C", path: "/c" },
      ],
      sessionsByProject: {
        "/a": [
          { sessionId: "s1", name: "S1" },
          { sessionId: "s1b", name: "S1b" },
        ],
        "/b": [{ sessionId: "s2", name: "S2" }],
        "/c": [{ sessionId: "s3", name: "S3" }],
      },
      statusMap: { s1: "permission", s1b: "permission", s2: "permission", s3: "idle" },
      allPending: [
        { requestId: "r1", sessionId: "s1", method: "confirm" },
        { requestId: "r1b", sessionId: "s1b", method: "input" },
        { requestId: "r2", sessionId: "s2", method: "select" },
      ],
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(countPermissionIcons()).toBe(2);
    expect(getBadgeTextForTab("Project A")).toBe("2");
    expect(getBadgeTextForTab("Project B")).toBe("1");
    expect(getPermissionIconForTab("Project C")).toBeNull();
  });

  it("shows 9+ when pending count exceeds 9", () => {
    setupStore({
      tabs: [{ id: "t1", name: "Project A", path: "/a" }],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "S1" }],
      },
      statusMap: { s1: "permission" },
      allPending: Array.from({ length: 12 }, (_, i) => ({
        requestId: `r${i}`,
        sessionId: "s1",
        method: "confirm" as const,
      })),
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(countPermissionIcons()).toBe(1);
    expect(getBadgeTextForTab("Project A")).toBe("9+");
  });

  it("shows exact number when count is exactly 9", () => {
    setupStore({
      tabs: [{ id: "t1", name: "Project A", path: "/a" }],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "S1" }],
      },
      statusMap: { s1: "permission" },
      allPending: Array.from({ length: 9 }, (_, i) => ({
        requestId: `r${i}`,
        sessionId: "s1",
        method: "confirm" as const,
      })),
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(getBadgeTextForTab("Project A")).toBe("9");
  });

  it("shows exact number when count is less than 9", () => {
    setupStore({
      tabs: [{ id: "t1", name: "Project A", path: "/a" }],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "S1" }],
      },
      statusMap: { s1: "permission" },
      allPending: Array.from({ length: 3 }, (_, i) => ({
        requestId: `r${i}`,
        sessionId: "s1",
        method: "confirm" as const,
      })),
    });

    render(<TabBar onAddProject={vi.fn()} />);
    expect(getBadgeTextForTab("Project A")).toBe("3");
  });

  it("places icon next to status dot", () => {
    setupStore({
      tabs: [{ id: "t1", name: "Project A", path: "/a" }],
      sessionsByProject: {
        "/a": [{ sessionId: "s1", name: "S1" }],
      },
      statusMap: { s1: "permission" },
      allPending: [{ requestId: "r1", sessionId: "s1", method: "confirm" }],
    });

    render(<TabBar onAddProject={vi.fn()} />);
    const tab = screen.getAllByRole("tab")[0];
    const dot = tab.querySelector("span.rounded-full.bg-status-error");
    const icon = tab.querySelector("svg.lucide-message-circle-question-mark");
    expect(dot).not.toBeNull();
    expect(icon).not.toBeNull();

    const children = Array.from(tab.childNodes);
    let dotIndex = -1;
    let iconContainerIndex = -1;
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      if (el === dot) dotIndex = i;
      if (el.contains(icon as Element)) iconContainerIndex = i;
    }
    expect(iconContainerIndex).toBeGreaterThan(dotIndex);
  });

  it("shows a cloud runtime indicator for standard SSH tabs before sessions load", () => {
    setupStore({
      tabs: [
        {
          id: "remote-standard",
          name: "Remote Standard",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-standard/project",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "remote-agent-child",
            profileId: "profile-standard",
            host: "ssh-box",
            remotePath: "/srv/project",
            localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-standard/project",
          },
        },
      ],
    });

    render(<TabBar onAddProject={vi.fn()} />);

    const indicator = screen.getByTestId("tab-remote-runtime-indicator");
    expect(indicator.getAttribute("data-runtime-kind")).toBe("remote-agent-child");
    expect(indicator.className).toContain("text-status-info");
    expect(indicator.querySelector("svg.lucide-cloud-cog")).not.toBeNull();
  });

  it("shows a cable runtime indicator for quick SSH sandbox tabs before sessions load", () => {
    setupStore({
      tabs: [
        {
          id: "remote-quick",
          name: "Remote Quick",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-quick/project",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "ssh-command",
            profileId: "profile-quick",
            host: "ssh-box",
            remotePath: "/tmp/project",
            localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-quick/project",
          },
        },
      ],
    });

    render(<TabBar onAddProject={vi.fn()} />);

    const indicator = screen.getByTestId("tab-remote-runtime-indicator");
    expect(indicator.getAttribute("data-runtime-kind")).toBe("ssh-command");
    expect(indicator.className).toContain("text-status-warning");
    expect(indicator.querySelector("svg.lucide-cable")).not.toBeNull();
  });

  it("shows a standard SSH indicator for legacy remote-project local paths", () => {
    setupStore({
      tabs: [
        {
          id: "legacy-remote",
          name: "Legacy Remote",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-legacy",
        },
      ],
    });

    render(<TabBar onAddProject={vi.fn()} />);

    const indicator = screen.getByTestId("tab-remote-runtime-indicator");
    expect(indicator.getAttribute("data-runtime-kind")).toBe("remote-agent-child");
    expect(indicator.className).toContain("text-status-info");
    expect(indicator.querySelector("svg.lucide-cloud-cog")).not.toBeNull();
  });
});
