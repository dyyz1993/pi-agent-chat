import { describe, expect, it } from "vitest";
import {
  getStandaloneSubagentItems,
  groupSessions,
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
});
