import { describe, expect, it } from "vitest";
import {
  getProjectDisplayName,
  getSessionIdentity,
} from "../../../src/mainview/lib/session-identity";
import type { SessionMeta } from "../../../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess_main",
    name: "Main session",
    sessionPath: "/tmp/project/.pi/sessions/sess_main.jsonl",
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

describe("session identity helpers", () => {
  it("returns null for normal sessions", () => {
    expect(getSessionIdentity(makeSession())).toBeNull();
  });

  it("identifies coordinator delegate sessions", () => {
    expect(
      getSessionIdentity(
        makeSession({
          sessionId: "sess_coord_123",
          delegateParentSessionId: "sess_parent",
          delegateType: "coordinator",
        }),
      ),
    ).toMatchObject({
      kind: "delegate",
      label: "委派",
      shortLabel: "委派",
    });
  });

  it("identifies subagent sessions", () => {
    expect(
      getSessionIdentity(
        makeSession({
          sessionId: "sess_sub_123",
          delegateParentSessionId: "sess_parent",
          delegateType: "subagent",
        }),
      ),
    ).toMatchObject({
      kind: "subagent",
      label: "子任务",
      shortLabel: "子任务",
    });
  });

  it("identifies forked delegate sessions separately", () => {
    expect(
      getSessionIdentity(
        makeSession({
          sessionId: "sess_coord_fork",
          delegateParentSessionId: "sess_parent",
          delegateType: "fork",
        }),
      ),
    ).toMatchObject({
      kind: "fork",
      label: "Fork",
      shortLabel: "Fork",
    });
  });

  it("formats project display names from paths", () => {
    expect(getProjectDisplayName("/Users/me/work/pi-agent-chat")).toBe("pi-agent-chat");
    expect(getProjectDisplayName("/")).toBe("/");
    expect(getProjectDisplayName("")).toBe("");
  });
});
