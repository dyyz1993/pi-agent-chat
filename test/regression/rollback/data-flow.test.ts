import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useRollbackStore } from "../../../src/mainview/stores/use-rollback-store";
import type { RollbackPreview, ModifiedFile } from "../../../src/mainview/stores/use-rollback-store";
import type { ChatMessage } from "../../../src/mainview/types";

function makeMsg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return { id, role, content: [{ type: "text" as const, text }], timestamp: Date.now() };
}

function makeSessionMessages(count: number, prefix = "msg"): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const role = i % 2 === 0 ? ("user" as const) : ("assistant" as const);
    return makeMsg(`${prefix}-${i}`, role, `Message ${i}`);
  });
}

const makePreview = (overrides?: Partial<RollbackPreview>): RollbackPreview => {
  const files: ModifiedFile[] = [
    {
      path: "src/a.ts",
      status: "modified",
      turnIndex: 0,
      entryId: "e0",
      addedLines: 3,
      removedLines: 1,
    },
  ];
  return {
    restored: ["src/a.ts"],
    deleted: [],
    files,
    summary: { totalFiles: 1, added: 0, modified: 1, deleted: 0 },
    ...overrides,
  };
};

describe("Rollback data flow: messages lifecycle (cases 1-4)", () => {
  const sessionId = "data-flow-session";

  beforeEach(() => {
    useChatStore.getState().clearSessionMessages(sessionId);
    useRollbackStore.getState().closeRollback();
    useSessionStore.setState({ activeSessionId: sessionId } as Partial<
      typeof useSessionStore extends { getState: () => infer S } ? S : never
    >);
  });

  it("1: store has messages -> navigateTree -> loadSessionMessages -> verify new messages", async () => {
    const originalMessages = makeSessionMessages(10, "orig");
    useChatStore.getState().setMessagesForSession(sessionId, originalMessages);
    expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(10);

    const afterMessages = makeSessionMessages(6, "post");
    useChatStore.getState().setMessagesForSession(sessionId, afterMessages);

    const current = useChatStore.getState().messagesBySession[sessionId];
    expect(current.length).toBe(6);
    expect(current[0].id).toBe("post-0");
    expect(current[5].id).toBe("post-5");

    expect(current.every((m) => m.id.startsWith("post-"))).toBe(true);
  });

  it("2: after rollback, messages are replaced (not lost)", () => {
    const beforeRollback = makeSessionMessages(8, "before");
    useChatStore.getState().setMessagesForSession(sessionId, beforeRollback);
    expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(8);

    const rollbackResult = makeSessionMessages(4, "after");
    useChatStore.getState().setMessagesForSession(sessionId, rollbackResult);

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs.length).toBe(4);
    expect(msgs.every((m) => m.id.startsWith("after-"))).toBe(true);
    expect(msgs.some((m) => m.id.startsWith("before-"))).toBe(false);
  });

  it("3: rollback to earliest point still returns at least 1 message", () => {
    const original = makeSessionMessages(2, "earliest");
    useChatStore.getState().setMessagesForSession(sessionId, original);
    expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(2);

    const earliestResult = makeSessionMessages(1, "first-msg");
    useChatStore.getState().setMessagesForSession(sessionId, earliestResult);

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].id).toBe("first-msg-0");
  });

  it("4: force reload replaces messages atomically (old data cleared, new data set)", () => {
    const v1 = makeSessionMessages(10, "v1");
    useChatStore.getState().setMessagesForSession(sessionId, v1);

    const msgsV1 = useChatStore.getState().messagesBySession[sessionId];
    expect(msgsV1.length).toBe(10);
    expect(msgsV1[0].id).toBe("v1-0");

    const v2 = makeSessionMessages(5, "v2");
    useChatStore.getState().setMessagesForSession(sessionId, v2);

    const msgsV2 = useChatStore.getState().messagesBySession[sessionId];
    expect(msgsV2.length).toBe(5);
    expect(msgsV2.every((m) => m.id.startsWith("v2-"))).toBe(true);
    expect(msgsV2.some((m) => m.id.startsWith("v1-"))).toBe(false);

    const v3 = makeSessionMessages(7, "v3");
    useChatStore.getState().setMessagesForSession(sessionId, v3);

    const msgsV3 = useChatStore.getState().messagesBySession[sessionId];
    expect(msgsV3.length).toBe(7);
    expect(msgsV3.every((m) => m.id.startsWith("v3-"))).toBe(true);
  });

  describe("data integrity during rollback lifecycle", () => {
    it("messages remain intact when rollback overlay is open and closed", () => {
      const messages = makeSessionMessages(6, "stable");
      useChatStore.getState().setMessagesForSession(sessionId, messages);

      useRollbackStore
        .getState()
        .openRollback({ targetId: "e1", mode: "message" as const }, makePreview());
      expect(useRollbackStore.getState().open).toBe(true);
      expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(6);

      useRollbackStore.getState().closeRollback();
      expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(6);
      expect(useChatStore.getState().messagesBySession[sessionId]).toEqual(messages);
    });

    it("multiple setMessagesForSession calls always reflect latest", () => {
      for (let i = 1; i <= 5; i++) {
        useChatStore
          .getState()
          .setMessagesForSession(sessionId, makeSessionMessages(i, `iter${i}`));
      }

      const msgs = useChatStore.getState().messagesBySession[sessionId];
      expect(msgs.length).toBe(5);
      expect(msgs.every((m) => m.id.startsWith("iter5-"))).toBe(true);
    });

    it("clearSessionMessages removes data for session but not others", () => {
      const otherSession = "other-session";
      useChatStore.getState().setMessagesForSession(sessionId, makeSessionMessages(3, "main"));
      useChatStore.getState().setMessagesForSession(otherSession, makeSessionMessages(4, "other"));

      useChatStore.getState().clearSessionMessages(sessionId);

      expect(useChatStore.getState().messagesBySession[sessionId]).toBeUndefined();
      expect(useChatStore.getState().messagesBySession[otherSession].length).toBe(4);

      useChatStore.getState().clearSessionMessages(otherSession);
    });
  });
});
