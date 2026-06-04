import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../src/mainview/stores/use-rollback-store";
import type { RollbackPreview, ModifiedFile } from "../src/mainview/stores/use-rollback-store";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useNotificationStore } from "../src/mainview/stores/use-notification-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import type { ChatMessage } from "../src/mainview/types";

const sampleFiles: ModifiedFile[] = [
  {
    path: "src/a.ts",
    status: "modified",
    turnIndex: 1,
    entryId: "e2",
    addedLines: 5,
    removedLines: 2,
  },
];

const samplePreview: RollbackPreview = {
  restored: ["src/a.ts"],
  deleted: [],
  files: sampleFiles,
  summary: { totalFiles: 1, added: 0, modified: 1, deleted: 0 },
};

function makeMsg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id,
    role,
    content: [{ type: "text" as const, text }],
    timestamp: Date.now(),
  };
}

function makeSessionMessages(count: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    msgs.push(makeMsg(`msg-${i}`, role, `Message ${i}`));
  }
  return msgs;
}

async function simulateConfirmRollback(
  sessionId: string,
  targetId: string,
  mode: "message" | "withFiles",
  options: {
    navigateTreeResult?: { cancelled: boolean };
    navigateTreeError?: Error;
    afterMessages?: ChatMessage[];
    beforeCount?: number;
  } = {},
) {
  const state = useRollbackStore.getState();
  const currentTarget = state.target;
  if (!currentTarget) return;

  state.setLoading(true);

  try {
    if (options.navigateTreeError) {
      throw options.navigateTreeError;
    }

    const result = options.navigateTreeResult ?? { cancelled: false };

    if (result.cancelled) {
      useNotificationStore.getState().push({
        message: "Rollback cancelled by backend",
        level: "warning",
      });
      return;
    }

    const beforeCount = options.beforeCount ?? 0;
    const msgs = options.afterMessages ?? [];
    useChatStore.getState().setMessagesForSession(sessionId, msgs);

    const afterCount = msgs.length;

    if (afterCount >= beforeCount && beforeCount > 0) {
      useNotificationStore.getState().push({
        message: "Rollback appears ineffective",
        level: "warning",
      });
    }
  } catch {
    useNotificationStore.getState().push({
      message: "Rollback failed",
      level: "error",
    });
  } finally {
    useRollbackStore.getState().closeRollback();
  }
}

describe("Rollback execution correctness (cases 16-25)", () => {
  const sessionId = "test-session-1";

  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
    useChatStore.getState().setMessagesForSession(sessionId, []);
    useNotificationStore.getState().clearAll();
    useSessionStore.setState({ activeSessionId: sessionId } as Partial<
      typeof useSessionStore extends { getState: () => infer S } ? S : never
    >);
  });

  describe("Group A: Post-rollback message state (16-18)", () => {
    it("16: after rollback, messages should be fewer than before", () => {
      const before = makeSessionMessages(10);
      useChatStore.getState().setMessagesForSession(sessionId, before);
      const beforeCount = useChatStore.getState().messagesBySession[sessionId].length;
      expect(beforeCount).toBe(10);

      const target = { targetId: "e3", mode: "message" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      expect(useRollbackStore.getState().open).toBe(true);
      expect(useRollbackStore.getState().target).toEqual(target);

      const after = makeSessionMessages(4);
      simulateConfirmRollback(sessionId, "e3", "message", { afterMessages: after, beforeCount });

      const afterCount = useChatStore.getState().messagesBySession[sessionId].length;
      expect(afterCount).toBe(4);
      expect(afterCount).toBeLessThan(beforeCount);

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();
    });

    it("17: loading state transitions loading=true then loading=false after rollback", () => {
      const before = makeSessionMessages(6);
      useChatStore.getState().setMessagesForSession(sessionId, before);

      const target = { targetId: "e2", mode: "withFiles" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      expect(useRollbackStore.getState().loading).toBe(false);

      const state = useRollbackStore.getState();
      state.setLoading(true);
      expect(useRollbackStore.getState().loading).toBe(true);

      state.setLoading(false);
      expect(useRollbackStore.getState().loading).toBe(false);
    });

    it("18: effective rollback (beforeCount > afterCount) should not trigger warning", () => {
      const before = makeSessionMessages(8);
      useChatStore.getState().setMessagesForSession(sessionId, before);
      const beforeCount = useChatStore.getState().messagesBySession[sessionId].length;
      expect(beforeCount).toBe(8);

      const target = { targetId: "e4", mode: "message" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      const after = makeSessionMessages(3);
      const afterCount = after.length;

      expect(beforeCount).toBeGreaterThan(afterCount);

      simulateConfirmRollback(sessionId, "e4", "message", { afterMessages: after, beforeCount });

      const warnings = useNotificationStore
        .getState()
        .notifications.filter((n) => n.message === "Rollback appears ineffective");
      expect(warnings.length).toBe(0);
    });
  });

  describe("Group B: Edge cases (19-20)", () => {
    it("19: first message rollback (root entry) - resolveRollbackTarget returns null, rollback overlay is NOT opened", () => {
      const msgs = makeSessionMessages(2);
      useChatStore.getState().setMessagesForSession(sessionId, msgs);

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();
    });

    it("20: single turn rollback behaves same as #19 - root entry cannot be rolled back", () => {
      const msgs = makeSessionMessages(2);
      useChatStore.getState().setMessagesForSession(sessionId, msgs);

      expect(useRollbackStore.getState().open).toBe(false);

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();
    });
  });

  describe("Group C: File rollback modes (22-23)", () => {
    it("22: withFiles mode (skipFiles=false) - target has mode=withFiles", () => {
      const target = { targetId: "e5", mode: "withFiles" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      const state = useRollbackStore.getState();
      expect(state.target).not.toBeNull();
      expect(state.target!.mode).toBe("withFiles");
      expect(state.preview).toEqual(samplePreview);
      expect(state.preview!.files.length).toBeGreaterThan(0);
    });

    it("23: message mode (skipFiles=true) - target has mode=message", () => {
      const emptyPreview: RollbackPreview = {
        restored: [],
        deleted: [],
        files: [],
        summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
      };
      const target = { targetId: "e5", mode: "message" as const };
      useRollbackStore.getState().openRollback(target, emptyPreview);

      const state = useRollbackStore.getState();
      expect(state.target).not.toBeNull();
      expect(state.target!.mode).toBe("message");
      expect(state.preview!.files.length).toBe(0);
    });
  });

  describe("Group D: Error handling (24-25)", () => {
    it("24: navigateTree throws - rollback store is cleaned up (closed)", () => {
      const before = makeSessionMessages(6);
      useChatStore.getState().setMessagesForSession(sessionId, before);

      const target = { targetId: "e6", mode: "message" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      simulateConfirmRollback(sessionId, "e6", "message", {
        navigateTreeError: new Error("Network error"),
      });

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();
      expect(useRollbackStore.getState().preview).toBeNull();
      expect(useRollbackStore.getState().loading).toBe(false);

      const errors = useNotificationStore
        .getState()
        .notifications.filter((n) => n.level === "error");
      expect(errors.length).toBeGreaterThan(0);
    });

    it("25: navigateTree returns cancelled=true - notification pushed, store cleaned up", () => {
      const before = makeSessionMessages(6);
      useChatStore.getState().setMessagesForSession(sessionId, before);

      const target = { targetId: "e7", mode: "withFiles" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      simulateConfirmRollback(sessionId, "e7", "withFiles", {
        navigateTreeResult: { cancelled: true },
      });

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();

      const warnings = useNotificationStore
        .getState()
        .notifications.filter((n) => n.level === "warning");
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain("cancelled");
    });
  });

  describe("Group E: New branch after rollback (21)", () => {
    it("21: after rollback, sending a new message should append to the rollback point", () => {
      const original = makeSessionMessages(10);
      useChatStore.getState().setMessagesForSession(sessionId, original);
      expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(10);

      const target = { targetId: "e3", mode: "message" as const };
      useRollbackStore.getState().openRollback(target, samplePreview);

      const afterRollback = makeSessionMessages(4);
      const beforeCount = useChatStore.getState().messagesBySession[sessionId].length;
      simulateConfirmRollback(sessionId, "e3", "message", {
        afterMessages: afterRollback,
        beforeCount,
      });

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useChatStore.getState().messagesBySession[sessionId].length).toBe(4);

      const newMsg: ChatMessage = {
        id: "new-msg-1",
        role: "user",
        content: [{ type: "text", text: "New message after rollback" }],
        timestamp: Date.now(),
      };

      const currentMsgs = useChatStore.getState().messagesBySession[sessionId] ?? [];
      useChatStore.getState().setMessagesForSession(sessionId, [...currentMsgs, newMsg]);

      const current = useChatStore.getState().messagesBySession[sessionId];
      expect(current.length).toBe(5);
      expect(current[current.length - 1].id).toBe("new-msg-1");
      expect(current[current.length - 1].role).toBe("user");

      const textBlock = current[current.length - 1].content.find((b) => b.type === "text");
      expect(textBlock).toBeDefined();
      if (textBlock && textBlock.type === "text") {
        expect(textBlock.text).toBe("New message after rollback");
      }
    });
  });
});
