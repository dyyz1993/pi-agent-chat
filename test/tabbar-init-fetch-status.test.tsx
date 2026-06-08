import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";

const sessionStoreState: Record<string, unknown> = {
  projectTabs: [],
  sessionsByProject: {},
  sessionStatusMap: {},
  activeProjectId: null,
  setActiveProject: vi.fn(),
  removeProjectTab: vi.fn(),
  reorderProjectTabs: vi.fn(),
  loadSessionsForProject: vi.fn(),
  fetchAllProjectsSessionsStatus: vi.fn().mockResolvedValue(undefined),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) =>
      selector ? selector(sessionStoreState) : sessionStoreState,
    {
      getState: () => sessionStoreState,
    },
  ),
}));

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ pending: [] }),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../src/mainview/components/settings/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));

let TabBar: typeof import("../src/mainview/components/tab-bar/TabBar").TabBar;

beforeAll(async () => {
  ({ TabBar } = await import("../src/mainview/components/tab-bar/TabBar"));
});

beforeEach(() => {
  vi.useRealTimers();
  sessionStoreState.projectTabs = [];
  sessionStoreState.sessionsByProject = {};
  sessionStoreState.sessionStatusMap = {};
  sessionStoreState.activeProjectId = null;
  (sessionStoreState.loadSessionsForProject as ReturnType<typeof vi.fn>).mockReset();
  (sessionStoreState.fetchAllProjectsSessionsStatus as ReturnType<typeof vi.fn>).mockReset();
  (sessionStoreState.fetchAllProjectsSessionsStatus as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  cleanup();
});

describe("TabBar init: no 3s delay, status comes from project.scanSessions", () => {
  it("loads non-active project sessions immediately on mount (no 3s delay)", async () => {
    sessionStoreState.projectTabs = [
      { id: "t1", name: "Project A", path: "/a" },
      { id: "t2", name: "Project B", path: "/b" },
    ];
    // Active project A already has its session list loaded
    sessionStoreState.sessionsByProject = {
      "/a": [{ sessionId: "s1", name: "S1" }],
    };
    sessionStoreState.activeProjectId = "t1";

    render(<TabBar onAddProject={vi.fn()} />);

    // loadSessionsForProject for /b should fire on the same tick — no 3s wait
    await waitFor(() => {
      expect(sessionStoreState.loadSessionsForProject).toHaveBeenCalledWith("/b");
    });

    // batch fetch is not used at all (redundant — status comes with scan)
    expect(sessionStoreState.fetchAllProjectsSessionsStatus).not.toHaveBeenCalled();
  });

  it("does not call loadSessionsForProject when all project lists are already cached", async () => {
    sessionStoreState.projectTabs = [{ id: "t1", name: "Project A", path: "/a" }];
    sessionStoreState.sessionsByProject = {
      "/a": [{ sessionId: "s1", name: "S1" }],
    };
    sessionStoreState.activeProjectId = "t1";

    render(<TabBar onAddProject={vi.fn()} />);

    // Give the init effect a chance to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(sessionStoreState.loadSessionsForProject).not.toHaveBeenCalled();
    expect(sessionStoreState.fetchAllProjectsSessionsStatus).not.toHaveBeenCalled();
  });

  it("does not call loadSessionsForProject when there are no project tabs", async () => {
    sessionStoreState.projectTabs = [];

    render(<TabBar onAddProject={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(sessionStoreState.loadSessionsForProject).not.toHaveBeenCalled();
    expect(sessionStoreState.fetchAllProjectsSessionsStatus).not.toHaveBeenCalled();
  });

  it("does not re-run the init effect on re-render (initializedRef guard)", async () => {
    sessionStoreState.projectTabs = [{ id: "t1", name: "Project A", path: "/a" }];
    sessionStoreState.sessionsByProject = {
      "/a": [{ sessionId: "s1", name: "S1" }],
    };
    sessionStoreState.activeProjectId = "t1";

    const { rerender } = render(<TabBar onAddProject={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(sessionStoreState.loadSessionsForProject).not.toHaveBeenCalled();

    // Re-render with a new project tab — guarded by initializedRef, should not load
    sessionStoreState.projectTabs = [
      { id: "t1", name: "Project A", path: "/a" },
      { id: "t2", name: "Project B", path: "/b" },
    ];
    rerender(<TabBar onAddProject={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    // init effect is guarded: no second call
    expect(sessionStoreState.loadSessionsForProject).not.toHaveBeenCalled();
    expect(sessionStoreState.fetchAllProjectsSessionsStatus).not.toHaveBeenCalled();
  });

  it("never calls fetchAllProjectsSessionsStatus (status comes from project.scanSessions)", async () => {
    sessionStoreState.projectTabs = [
      { id: "t1", name: "Project A", path: "/a" },
      { id: "t2", name: "Project B", path: "/b" },
    ];
    sessionStoreState.sessionsByProject = {
      "/a": [{ sessionId: "s1", name: "S1" }],
    };
    sessionStoreState.activeProjectId = "t1";

    render(<TabBar onAddProject={vi.fn()} />);
    await waitFor(() => {
      expect(sessionStoreState.loadSessionsForProject).toHaveBeenCalledWith("/b");
    });

    expect(sessionStoreState.fetchAllProjectsSessionsStatus).not.toHaveBeenCalled();
  });
});
