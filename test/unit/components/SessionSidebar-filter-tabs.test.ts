import { describe, expect, it } from "vitest";
import {
  getSidebarFocusForActiveSelection,
  getStandaloneSubagentItems,
  groupSessions,
  isSubagentSidebarItemActive,
  type SessionSidebarFilterType,
} from "../../../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta, SubagentSessionInfo } from "../../../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: "sess-main",
    name: "Main session",
    sessionPath: "/tmp/main.jsonl",
    projectPath: "/tmp/project",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 1,
    firstMessage: "hello",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

function makeSubagent(overrides: Partial<SubagentSessionInfo>): SubagentSessionInfo {
  return {
    sessionId: "sub-1",
    sessionPath: "/tmp/sub-1.jsonl",
    description: "Sub task",
    instruction: "Do work",
    startedAt: 1,
    ...overrides,
  };
}

describe("SessionSidebar filter tabs", () => {
  const main = makeSession({
    sessionId: "sess-main",
    name: "Main",
    sessionPath: "/tmp/main.jsonl",
  });
  const delegate = makeSession({
    sessionId: "sess_coord_1",
    name: "Delegate",
    sessionPath: "/tmp/delegate.jsonl",
  });
  const subagent = makeSession({
    sessionId: "sess_sub_1",
    name: "Sub task",
    sessionPath: "/tmp/sub.jsonl",
    parentSessionPath: "/tmp/main.jsonl",
  });

  it.each([
    ["main", ["sess-main"]],
    ["delegate", ["sess_coord_1"]],
    ["subagent", ["sess_sub_1"]],
  ] satisfies Array<[SessionSidebarFilterType, string[]]>)(
    "shows %s sessions without needing an all tab",
    (filterType, expectedIds) => {
      const { rootSessions } = groupSessions([main, delegate, subagent], "", filterType);

      expect(rootSessions.map((session) => session.sessionId)).toEqual(expectedIds);
    },
  );

  it("keeps parent sessions in the main tab even when they have subagent children", () => {
    const { rootSessions } = groupSessions([main, subagent], "", "main");

    expect(rootSessions.map((session) => session.sessionId)).toEqual(["sess-main"]);
  });

  it("flattens loaded live subagents for the subagent tab", () => {
    const items = getStandaloneSubagentItems(
      {
        "/tmp/main.jsonl": [makeSubagent({ sessionId: "sub-live", description: "Live sub" })],
      },
      [main],
      "",
    );

    expect(items).toEqual([
      expect.objectContaining({
        parentSessionId: "sess-main",
        sub: expect.objectContaining({ sessionId: "sub-live" }),
      }),
    ]);
  });

  it("filters loaded live subagents by description, instruction, or id", () => {
    const items = getStandaloneSubagentItems(
      {
        "/tmp/main.jsonl": [
          makeSubagent({ sessionId: "sub-live", description: "Live sub" }),
          makeSubagent({ sessionId: "sub-hidden", description: "Other" }),
        ],
      },
      [main],
      "live",
    );

    expect(items.map((item) => item.sub.sessionId)).toEqual(["sub-live"]);
  });

  it("sorts loaded live subagents by active sidebar state before start time", () => {
    const items = getStandaloneSubagentItems(
      {
        "/tmp/main.jsonl": [
          makeSubagent({ sessionId: "idle", description: "Idle", startedAt: 30, completedAt: 40 }),
          makeSubagent({ sessionId: "running", description: "Running", startedAt: 20 }),
          makeSubagent({ sessionId: "permission", description: "Permission", startedAt: 10 }),
        ],
      },
      [main],
      "",
      {
        idle: "idle",
        running: "streaming",
        permission: "permission",
      },
    );

    expect(items.map((item) => item.sub.sessionId)).toEqual(["permission", "running", "idle"]);
  });

  it("focuses the subagent tab when a live subagent is selected", () => {
    expect(
      getSidebarFocusForActiveSelection({
        activeSessionId: "sess-main",
        activeSubsessionId: "sub-live",
        sessions: [main],
      }),
    ).toEqual({
      filterType: "subagent",
      expandSessionId: "sess-main",
    });
  });

  it("focuses persisted subagent sessions in the subagent tab", () => {
    expect(
      getSidebarFocusForActiveSelection({
        activeSessionId: "sess_sub_1",
        activeSubsessionId: null,
        sessions: [main, subagent],
      }),
    ).toEqual({
      filterType: "subagent",
    });
  });

  it("focuses delegated sessions in the delegate tab", () => {
    expect(
      getSidebarFocusForActiveSelection({
        activeSessionId: "sess_coord_1",
        activeSubsessionId: null,
        sessions: [main, delegate],
      }),
    ).toEqual({
      filterType: "delegate",
    });
  });

  it("focuses and expands the selected main session", () => {
    expect(
      getSidebarFocusForActiveSelection({
        activeSessionId: "sess-main",
        activeSubsessionId: null,
        sessions: [main],
      }),
    ).toEqual({
      filterType: "main",
      expandSessionId: "sess-main",
    });
  });

  it("marks subagent rows active when either the subagent overlay or global session is selected", () => {
    expect(
      isSubagentSidebarItemActive({
        activeSessionId: "sess-main",
        activeSubsessionId: "sess_sub_1",
        subSessionId: "sess_sub_1",
      }),
    ).toBe(true);

    expect(
      isSubagentSidebarItemActive({
        activeSessionId: "sess_sub_1",
        activeSubsessionId: null,
        subSessionId: "sess_sub_1",
      }),
    ).toBe(true);

    expect(
      isSubagentSidebarItemActive({
        activeSessionId: "sess-main",
        activeSubsessionId: null,
        subSessionId: "sess_sub_1",
      }),
    ).toBe(false);
  });
});
