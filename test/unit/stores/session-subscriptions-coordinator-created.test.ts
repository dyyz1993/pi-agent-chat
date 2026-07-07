import { describe, expect, it } from "vitest";
import {
  buildCoordinatorSessionCreatedUpdates,
  resolveCoordinatorSessionCreatedProjectPath,
} from "../../../src/mainview/stores/session-subscriptions";
import type { ProjectTab, SessionMeta } from "../../../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: "sess_parent",
    name: "Parent",
    sessionPath: "/sessions/parent.jsonl",
    projectPath: "/repo/main",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 1,
    firstMessage: "parent",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

describe("coordinator.session_created project ownership", () => {
  const parentProjectPath = "/repo/main";
  const workerProjectPath = "/repo/main-worktree";
  const parent = makeSession({
    sessionId: "sess_parent",
    sessionPath: "/sessions/parent.jsonl",
    projectPath: parentProjectPath,
  });
  const delegate = makeSession({
    sessionId: "sess_coord_worker",
    name: "Delegate worker",
    sessionPath: "/sessions/worker.jsonl",
    projectPath: workerProjectPath,
    delegateParentSessionId: "sess_parent",
    delegateType: "coordinator",
    messageCount: 0,
    firstMessage: "do delegated work",
    status: "running",
  });
  const projectTabs: ProjectTab[] = [{ id: "tab-main", name: "main", path: parentProjectPath }];

  it("resolves same-parent delegates to the parent project bucket", () => {
    const projectPath = resolveCoordinatorSessionCreatedProjectPath(
      { [parentProjectPath]: [parent] },
      { parentSessionId: "sess_parent", session: delegate },
    );

    expect(projectPath).toBe(parentProjectPath);
  });

  it("does not create a new project tab for same-project delegate workers", () => {
    const result = buildCoordinatorSessionCreatedUpdates(
      {
        activeProjectId: "tab-main",
        projectTabs,
        sessionsByProject: {
          [parentProjectPath]: [parent],
        },
      },
      { parentSessionId: "sess_parent", session: delegate },
      () => "tab-worker",
    );

    expect(result?.updates.projectTabs).toBeUndefined();
    expect(result?.tabsToSync).toBeNull();
    expect(
      result?.updates.sessionsByProject?.[parentProjectPath].map((s) => s.sessionId).sort(),
    ).toEqual(["sess_coord_worker", "sess_parent"]);
    expect(result?.updates.sessionsByProject?.[workerProjectPath]).toBeUndefined();
  });

  it("moves a previously misbucketed delegate into the parent project bucket", () => {
    const result = buildCoordinatorSessionCreatedUpdates(
      {
        activeProjectId: "tab-main",
        projectTabs,
        sessionsByProject: {
          [parentProjectPath]: [parent],
          [workerProjectPath]: [delegate],
        },
      },
      { parentSessionId: "sess_parent", session: delegate },
      () => "tab-worker",
    );

    expect(
      result?.updates.sessionsByProject?.[parentProjectPath].map((s) => s.sessionId).sort(),
    ).toEqual(["sess_coord_worker", "sess_parent"]);
    expect(result?.updates.sessionsByProject?.[workerProjectPath]).toEqual([]);
  });

  it("falls back to the child project path when the parent is unknown", () => {
    const result = buildCoordinatorSessionCreatedUpdates(
      {
        activeProjectId: "tab-main",
        projectTabs,
        sessionsByProject: {
          [parentProjectPath]: [],
        },
      },
      { parentSessionId: "missing_parent", session: delegate },
      () => "tab-worker",
    );

    expect(result?.updates.sessionsByProject?.[workerProjectPath].map((s) => s.sessionId)).toEqual([
      "sess_coord_worker",
    ]);
    expect(result?.updates.projectTabs).toEqual([
      projectTabs[0],
      { id: "tab-worker", name: "main-worktree", path: workerProjectPath },
    ]);
  });
});
