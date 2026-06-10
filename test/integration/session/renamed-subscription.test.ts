import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

interface SessionLike {
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
}

interface MockSessionState {
  sessionsByProject: Record<string, SessionLike[]>;
}

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create<MockSessionState>(() => ({
    sessionsByProject: {},
  }));
  return { useSessionStore, insertAfterPinned: vi.fn(), clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { setupSessionRenamedSubscription } from "../../../src/mainview/stores/session-subscriptions";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

type RenamedPayload = { sessionId: string; projectPath: string; newName: string };

let handler: (payload: RenamedPayload) => void;

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
  setupSessionRenamedSubscription();
  const calls = (apiClient.subscribe as ReturnType<typeof vi.fn>).mock.calls;
  const match = calls.find((c: unknown[]) => c[0] === "agent.session_renamed");
  if (!match) throw new Error("agent.session_renamed subscription not found");
  handler = match[1] as (payload: RenamedPayload) => void;
});

beforeEach(() => {
  useSessionStore.setState({ sessionsByProject: {} });
});

describe("setupSessionRenamedSubscription", () => {
  it("should update session name in sessionsByProject when event received", async () => {
    seedSession("/project/a", {
      sessionId: "sess-1",
      name: "Old Title",
      sessionPath: "/project/a/.sessions/sess-1",
      projectPath: "/project/a",
    });

    handler({ sessionId: "sess-1", projectPath: "/project/a", newName: "New Title" });

    const sessions = useSessionStore.getState().sessionsByProject["/project/a"];
    expect(sessions).toBeDefined();
    expect(sessions![0].name).toBe("New Title");
  });

  it("should NOT update if projectPath not found in sessionsByProject", () => {
    const before = { ...useSessionStore.getState().sessionsByProject };

    handler({ sessionId: "sess-1", projectPath: "/project/unknown", newName: "New Title" });

    expect(useSessionStore.getState().sessionsByProject).toEqual(before);
  });

  it("should NOT update if sessionId not found in the project sessions", () => {
    seedSession("/project/a", {
      sessionId: "sess-other",
      name: "Other Session",
      sessionPath: "/project/a/.sessions/sess-other",
      projectPath: "/project/a",
    });

    const before = JSON.parse(JSON.stringify(useSessionStore.getState().sessionsByProject));

    handler({ sessionId: "sess-missing", projectPath: "/project/a", newName: "New Title" });

    expect(useSessionStore.getState().sessionsByProject).toEqual(before);
  });

  it("should update only the matching project when multiple projects exist", () => {
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

    handler({ sessionId: "sess-1", projectPath: "/project/b", newName: "Renamed B" });

    expect(useSessionStore.getState().sessionsByProject["/project/a"]![0].name).toBe("A Session");
    expect(useSessionStore.getState().sessionsByProject["/project/b"]![0].name).toBe("Renamed B");
  });

  it("should not subscribe again if already subscribed", () => {
    setupSessionRenamedSubscription();
    setupSessionRenamedSubscription();

    const subscribeCalls = (apiClient.subscribe as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "agent.session_renamed",
    );
    expect(subscribeCalls).toHaveLength(1);
  });

  it("should preserve other sessions in the same project", () => {
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

    handler({ sessionId: "sess-1", projectPath: "/project/a", newName: "Renamed First" });

    const sessions = useSessionStore.getState().sessionsByProject["/project/a"]!;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe("Renamed First");
    expect(sessions[1].name).toBe("Second");
  });
});
