/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLoadSessionsForProjectAction,
} from "../src/mainview/stores/session-project-actions";
import {
  createRenameSessionAction,
  createUpdateSessionProjectPathAction,
} from "../src/mainview/stores/session-simple-actions";
import type { ProjectTab, SessionMeta } from "../src/mainview/types";

const apiCall = vi.fn();

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: (...args: unknown[]) => apiCall(...args),
    onReconnect: vi.fn(),
  },
}));

function makeSession(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: overrides.sessionId ?? "s1",
    name: overrides.name ?? "",
    sessionPath: overrides.sessionPath ?? `/tmp/${overrides.sessionId ?? "s1"}.jsonl`,
    projectPath: overrides.projectPath ?? "/tmp/project",
    parentSessionPath: overrides.parentSessionPath ?? null,
    delegateParentSessionId: overrides.delegateParentSessionId ?? null,
    delegateType: overrides.delegateType ?? null,
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "hello",
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    status: overrides.status ?? "idle",
    pinned: overrides.pinned,
  };
}

interface TestState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  sessionsByProject: Record<string, SessionMeta[]>;
  agentSubscriptions: Record<string, string>;
  batchSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  loading: boolean;
}

function createHarness(initial: Partial<TestState> = {}) {
  let state: TestState = {
    activeProjectId: "p1",
    activeSessionId: null,
    projectTabs: [{ id: "p1", name: "Project", path: "/tmp/project" }],
    sessionsByProject: {},
    agentSubscriptions: {},
    batchSubscriptions: {},
    subagentSubscriptions: {},
    projectStartFailed: {},
    projectStartError: {},
    loading: false,
    ...initial,
  };
  const get = () => state;
  const set = (
    patch: Partial<TestState> | ((current: TestState) => Partial<TestState>),
  ): void => {
    const next = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...next };
  };
  return { get, set };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  apiCall.mockReset();
  vi.clearAllMocks();
});

describe("session action factories", () => {
  it("deduplicates scanned sessions and removes older blank sessions", async () => {
    const existingBlank = makeSession({
      sessionId: "blank-old",
      sessionPath: "/tmp/blank-old.jsonl",
      messageCount: 0,
      firstMessage: "",
    });
    const diskBlank = makeSession({
      sessionId: "blank-new",
      sessionPath: "/tmp/blank-new.jsonl",
      messageCount: 0,
      firstMessage: "",
    });
    const diskDuplicate = makeSession({
      sessionId: "blank-new",
      sessionPath: "/tmp/blank-new.jsonl",
      messageCount: 0,
      firstMessage: "",
    });
    const harness = createHarness({
      sessionsByProject: { "/tmp/project": [existingBlank] },
    });
    apiCall.mockResolvedValue({});
    apiCall.mockResolvedValueOnce({ sessions: [diskBlank, diskDuplicate] });

    const loadSessions = createLoadSessionsForProjectAction({
      get: harness.get,
      set: harness.set,
      log,
    });
    const result = await loadSessions("/tmp/project");

    expect(result.map((s) => s.sessionId)).toEqual(["blank-new"]);
    expect(harness.get().sessionsByProject["/tmp/project"].map((s) => s.sessionId)).toEqual([
      "blank-new",
    ]);
    expect(apiCall).toHaveBeenCalledWith("session.delete", {
      sessionId: "blank-old",
      sessionPath: "/tmp/blank-old.jsonl",
    });
    expect(harness.get().loading).toBe(false);
  });

  it("updates a session project path and notifies persistence/runtime APIs", () => {
    const session = makeSession({ sessionId: "s1", sessionPath: "/tmp/s1.jsonl" });
    const harness = createHarness({
      sessionsByProject: { "/tmp/project": [session] },
    });
    apiCall.mockResolvedValue({});

    const updateProjectPath = createUpdateSessionProjectPathAction({
      set: harness.set,
      log,
    });
    updateProjectPath("s1", "/tmp/new-project");

    expect(harness.get().sessionsByProject["/tmp/project"][0].projectPath).toBe(
      "/tmp/new-project",
    );
    expect(apiCall).toHaveBeenCalledWith("session.updateCwd", {
      sessionPath: "/tmp/s1.jsonl",
      newCwd: "/tmp/new-project",
    });
    expect(apiCall).toHaveBeenCalledWith("agent.setCwd", {
      sessionId: "s1",
      cwd: "/tmp/new-project",
    });
  });

  it("renames a session locally and persists the new name", () => {
    const session = makeSession({ sessionId: "s1", sessionPath: "/tmp/s1.jsonl", name: "Old" });
    const harness = createHarness({
      sessionsByProject: { "/tmp/project": [session] },
    });
    apiCall.mockResolvedValue({});

    const renameSession = createRenameSessionAction({
      set: harness.set,
      log,
    });
    renameSession("s1", "  New Name  ");

    expect(harness.get().sessionsByProject["/tmp/project"][0].name).toBe("New Name");
    expect(apiCall).toHaveBeenCalledWith("session.rename", {
      sessionId: "s1",
      sessionPath: "/tmp/s1.jsonl",
      newName: "New Name",
    });
  });
});
