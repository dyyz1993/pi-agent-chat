import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

interface SessionLike {
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
  status?: "idle" | "running" | "streaming" | "compacting" | "permission" | "retrying";
}

interface MockSessionState {
  sessionsByProject: Record<string, SessionLike[]>;
  sessionStatusMap: Record<string, string>;
  updateSessionStatus: (sessionId: string, status: string) => void;
}

vi.mock("../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create<MockSessionState>((set) => ({
    sessionsByProject: {},
    sessionStatusMap: {},
    updateSessionStatus: (sessionId, status) =>
      set((s) => ({ sessionStatusMap: { ...s.sessionStatusMap, [sessionId]: status } })),
  }));
  return {
    useSessionStore,
    insertAfterPinned: vi.fn(),
    clearAgentStarted: () => {},
    clearStatusWatchdog: () => {},
  };
});

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
}));

import { apiClient } from "../src/mainview/lib/api-client";
import { setupProjectStatusSubscription } from "../src/mainview/stores/session-subscriptions";
import { useSessionStore } from "../src/mainview/stores/use-session-store";

type StatusPayload = { sessionId: string; projectPath: string; status: string };

let handler: (payload: StatusPayload) => void;

function seedSession(projectPath: string, session: SessionLike) {
  const existing = useSessionStore.getState().sessionsByProject[projectPath] || [];
  useSessionStore.setState({
    sessionsByProject: {
      ...useSessionStore.getState().sessionsByProject,
      [projectPath]: [...existing, session],
    },
  });
}

beforeAll(() => {
  setupProjectStatusSubscription();
  const calls = (apiClient.subscribe as ReturnType<typeof vi.fn>).mock.calls;
  const match = calls.find((c: unknown[]) => c[0] === "agent.session_status_changed");
  if (!match) throw new Error("agent.session_status_changed subscription not found");
  handler = match[1] as (payload: StatusPayload) => void;
});

beforeEach(() => {
  useSessionStore.setState({ sessionsByProject: {}, sessionStatusMap: {} });
});

describe("setupProjectStatusSubscription", () => {
  it("updates sessionStatusMap when a status change event is received", () => {
    handler({ sessionId: "sess-1", projectPath: "/project/a", status: "streaming" });

    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("streaming");
  });

  it("updates the session's status field when its project is in sessionsByProject", () => {
    seedSession("/project/a", {
      sessionId: "sess-1",
      name: "A Session",
      sessionPath: "/project/a/.sessions/sess-1",
      projectPath: "/project/a",
    });

    handler({ sessionId: "sess-1", projectPath: "/project/a", status: "permission" });

    const sessions = useSessionStore.getState().sessionsByProject["/project/a"];
    expect(sessions![0].status).toBe("permission");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("permission");
  });

  it("still updates sessionStatusMap when the session is in a non-active project (no project path entry yet)", () => {
    // Simulate the case where the project hasn't been loaded into
    // sessionsByProject yet (e.g., a project being added).
    handler({ sessionId: "sess-new", projectPath: "/project/unknown", status: "retrying" });

    // sessionStatusMap should still get updated
    expect(useSessionStore.getState().sessionStatusMap["sess-new"]).toBe("retrying");
  });

  it("does not throw or corrupt state if projectPath is unknown", () => {
    const before = JSON.parse(JSON.stringify(useSessionStore.getState().sessionsByProject));

    handler({ sessionId: "sess-1", projectPath: "/project/unknown", status: "idle" });

    expect(useSessionStore.getState().sessionsByProject).toEqual(before);
  });

  it("updates only the matching project when multiple projects share the same sessionId", () => {
    seedSession("/project/a", {
      sessionId: "sess-1",
      name: "A Session",
      sessionPath: "/project/a/.sessions/sess-1",
      projectPath: "/project/a",
    });
    seedSession("/project/b", {
      sessionId: "sess-1",
      name: "B Session",
      sessionPath: "/project/b/.sessions/sess-1",
      projectPath: "/project/b",
    });

    handler({ sessionId: "sess-1", projectPath: "/project/b", status: "compacting" });

    expect(useSessionStore.getState().sessionsByProject["/project/a"]![0].status).toBeUndefined();
    expect(useSessionStore.getState().sessionsByProject["/project/b"]![0].status).toBe("compacting");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("compacting");
  });

  it("does not subscribe again if already subscribed", () => {
    setupProjectStatusSubscription();
    setupProjectStatusSubscription();

    const subscribeCalls = (apiClient.subscribe as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "agent.session_status_changed",
    );
    expect(subscribeCalls).toHaveLength(1);
  });

  it("preserves other sessions in the same project", () => {
    seedSession("/project/a", {
      sessionId: "sess-1",
      name: "First",
      sessionPath: "/project/a/.sessions/sess-1",
      projectPath: "/project/a",
    });
    seedSession("/project/a", {
      sessionId: "sess-2",
      name: "Second",
      sessionPath: "/project/a/.sessions/sess-2",
      projectPath: "/project/a",
    });

    handler({ sessionId: "sess-1", projectPath: "/project/a", status: "running" });

    const sessions = useSessionStore.getState().sessionsByProject["/project/a"]!;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe("running");
    expect(sessions[1].status).toBeUndefined();
  });
});
