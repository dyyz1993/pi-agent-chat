import { describe, expect, it } from "vitest";
import { buildSessionMentionItems } from "../../../src/mainview/lib/session-mention-items";
import type { ProjectTab, SessionMeta } from "../../../src/mainview/types";

const tabs: ProjectTab[] = [
  { id: "project-a", name: "项目 A", path: "/project-a" },
  { id: "project-b", name: "Project B", path: "/project-b" },
];

function session(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: "sess-a",
    name: "",
    sessionPath: "/sessions/sess-a.jsonl",
    projectPath: "/project-a",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

describe("buildSessionMentionItems", () => {
  it("builds current-project session references with Chinese searchable labels", () => {
    const items = buildSessionMentionItems({
      projectTabs: tabs,
      activeProjectId: "project-a",
      scope: "current",
      action: "reference",
      sessionsByProject: {
        "/project-a": [
          session({
            sessionId: "sess-cn",
            name: "中文验证会话",
            firstMessage: "中文验证内容",
            messageCount: 1,
            updatedAt: 20,
          }),
          session({ sessionId: "sess-old", firstMessage: "older", updatedAt: 10 }),
        ],
        "/project-b": [session({ sessionId: "sess-b", projectPath: "/project-b" })],
      },
    });

    expect(items.map((item) => item.sessionId)).toEqual(["sess-cn", "sess-old"]);
    expect(items[0]).toEqual(
      expect.objectContaining({
        label: "中文验证会话",
        insertText: "@session:sess-cn",
        description: expect.stringContaining("项目 A"),
      }),
    );
  });

  it("sorts recent sessions by interaction rank before last activity", () => {
    const items = buildSessionMentionItems({
      projectTabs: tabs,
      activeProjectId: "project-a",
      scope: "recent",
      action: "jump",
      sessionsByProject: {
        "/project-a": [
          session({ sessionId: "plain-newer", firstMessage: "plain", updatedAt: 100 }),
          session({
            sessionId: "delegate-older",
            name: "delegated",
            delegateType: "coordinator",
            delegateParentSessionId: "parent",
            updatedAt: 10,
          }),
        ],
      },
    });

    expect(items.map((item) => item.sessionId)).toEqual(["delegate-older", "plain-newer"]);
    expect(items[0].action).toBe("jump");
  });

  it("falls back to all sessions when recent has no interacted sessions", () => {
    const items = buildSessionMentionItems({
      projectTabs: tabs,
      activeProjectId: "project-a",
      scope: "recent",
      action: "reference",
      sessionsByProject: {
        "/project-a": [session({ sessionId: "blank-a", updatedAt: 2 })],
        "/project-b": [session({ sessionId: "blank-b", projectPath: "/project-b", updatedAt: 3 })],
      },
    });

    expect(items.map((item) => item.sessionId)).toEqual(["blank-b", "blank-a"]);
  });
});
