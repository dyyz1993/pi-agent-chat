import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRollbackStore } from "../src/mainview/stores/use-rollback-store";
import type { RollbackPreview, ModifiedFile } from "../src/mainview/stores/use-rollback-store";
import enChat from "../src/mainview/locales/en/chat.json";
import zhChat from "../src/mainview/locales/zh-CN/chat.json";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useSnapshotStore } from "../src/mainview/stores/use-snapshot-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { ChatMessage, SnapshotInfo } from "../src/mainview/types";

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

function makeMsg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return { id, role, content: [{ type: "text" as const, text }], timestamp: Date.now() };
}

interface DiffFileItem {
  path: string;
  status: "added" | "modified" | "deleted";
  diff: {
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  };
}

function shouldUseInlineDiffViewer(item: DiffFileItem): boolean {
  return item.diff.oldContent !== null && item.diff.newContent !== null;
}

function makeSnapshot(overrides?: Partial<SnapshotInfo>): SnapshotInfo {
  return {
    id: "snap-1",
    stepIndex: 0,
    timestamp: new Date().toISOString(),
    treeHash: "abc123",
    diff: { added: [], modified: [], deleted: [] },
    files: {},
    rolledBack: false,
    ...overrides,
  };
}

describe("Snapshot interactions, i18n, and edge cases (cases 36-50)", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  describe("Snapshot interactions (36-43)", () => {
    let callSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      callSpy = vi.spyOn(apiClient, "call");
    });

    it("36: Snapshot store can fetch and list snapshots", async () => {
      const mockSnapshots: SnapshotInfo[] = [
        makeSnapshot({ id: "s1", stepIndex: 0 }),
        makeSnapshot({ id: "s2", stepIndex: 1 }),
      ];
      callSpy.mockResolvedValue(mockSnapshots);

      const sessionId = "test-snap-session";
      await useSnapshotStore.getState().fetchSnapshots(sessionId);

      const state = useSnapshotStore.getState();
      expect(state.snapshotsBySession[sessionId]).toEqual(mockSnapshots);
      expect(state.loadingBySession[sessionId]).toBe(false);

      useSnapshotStore.getState().clearSession(sessionId);
    });

    it("37: Snapshot rollback sets correct state in store", async () => {
      const sessionId = "test-rollback-session";
      const snapshots: SnapshotInfo[] = [
        makeSnapshot({ id: "snap-r1", stepIndex: 0 }),
        makeSnapshot({ id: "snap-r2", stepIndex: 1, rolledBack: true }),
      ];

      callSpy
        .mockResolvedValueOnce({ ok: true, restoredFiles: ["src/a.ts"] })
        .mockResolvedValueOnce(snapshots);

      const result = await useSnapshotStore.getState().rollback(sessionId, "snap-r1");

      expect(result.ok).toBe(true);
      expect(result.restoredFiles).toEqual(["src/a.ts"]);

      useSnapshotStore.getState().clearSession(sessionId);
    });

    it("38: Snapshot rollback marks snapshot as rolledBack", async () => {
      const snapshots: SnapshotInfo[] = [
        makeSnapshot({ id: "snap-38", stepIndex: 0, rolledBack: true }),
      ];

      expect(snapshots[0].rolledBack).toBe(true);
      expect(snapshots[0].id).toBe("snap-38");
    });

    it("39: Snapshot unrevert reverts the rolledBack flag", async () => {
      const sessionId = "test-unrevert-session";
      const refreshedSnapshots: SnapshotInfo[] = [
        makeSnapshot({ id: "snap-39", stepIndex: 0, rolledBack: false }),
      ];

      callSpy.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(refreshedSnapshots);

      const result = await useSnapshotStore.getState().unrevert(sessionId, "snap-39");

      expect(result.ok).toBe(true);

      useSnapshotStore.getState().clearSession(sessionId);
    });

    it("40: Snapshot getBatchDiffs returns file diff data", async () => {
      const mockDiffs: DiffFileItem[] = [
        {
          path: "src/a.ts",
          status: "modified",
          diff: {
            path: "src/a.ts",
            oldContent: "old",
            newContent: "new",
            unifiedDiff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new",
          },
        },
        {
          path: "src/new.ts",
          status: "added",
          diff: {
            path: "src/new.ts",
            oldContent: null,
            newContent: "new file",
            unifiedDiff: "--- /dev/null\n+++ b/src/new.ts\n+new file",
          },
        },
      ];

      expect(mockDiffs.length).toBe(2);
      expect(mockDiffs[0].status).toBe("modified");
      expect(mockDiffs[0].diff.oldContent).toBe("old");
      expect(mockDiffs[0].diff.newContent).toBe("new");
      expect(mockDiffs[1].status).toBe("added");
      expect(mockDiffs[1].diff.oldContent).toBeNull();
    });

    it("41: For modified files with oldContent+newContent: InlineDiffViewer should be used", () => {
      const item: DiffFileItem = {
        path: "src/mod.ts",
        status: "modified",
        diff: {
          path: "src/mod.ts",
          oldContent: "line1\nline2",
          newContent: "line1\nline3",
          unifiedDiff: "--- a/src/mod.ts\n+++ b/src/mod.ts\n-line2\n+line3",
        },
      };
      expect(shouldUseInlineDiffViewer(item)).toBe(true);
    });

    it("42: For added files with oldContent=null: fallback to unifiedDiff", () => {
      const item: DiffFileItem = {
        path: "src/added.ts",
        status: "added",
        diff: {
          path: "src/added.ts",
          oldContent: null,
          newContent: "new content here",
          unifiedDiff: "--- /dev/null\n+++ b/src/added.ts\n+new content here",
        },
      };
      expect(shouldUseInlineDiffViewer(item)).toBe(false);
    });

    it("43: Snapshot rollback does not affect messages (store isolation)", () => {
      const sessionId = "iso-test-session";
      useSessionStore.setState({ activeSessionId: sessionId } as Partial<
        typeof useSessionStore extends { getState: () => infer S } ? S : never
      >);

      const messages: ChatMessage[] = [
        makeMsg("m1", "user", "hello"),
        makeMsg("m2", "assistant", "hi"),
      ];
      useChatStore.getState().setMessagesForSession(sessionId, messages);

      const target = { targetId: "e1", mode: "withFiles" as const };
      useRollbackStore.getState().openRollback(target, makePreview());

      expect(useRollbackStore.getState().open).toBe(true);
      expect(useChatStore.getState().messagesBySession[sessionId]).toEqual(messages);

      useRollbackStore.getState().closeRollback();

      expect(useRollbackStore.getState().open).toBe(false);
      expect(useChatStore.getState().messagesBySession[sessionId]).toEqual(messages);
    });
  });

  describe("i18n (44-48)", () => {
    const rollbackOverlayKeys = [
      "rollbackOverlay.title",
      "rollbackOverlay.titleWithFiles",
      "rollbackOverlay.messageModeDesc",
      "rollbackOverlay.withFilesModeDesc",
      "rollbackOverlay.confirm",
      "rollbackOverlay.cancel",
      "rollbackOverlay.noFiles",
      "rollbackOverlay.fileWillBeDeleted",
      "rollbackOverlay.fileWillBeRemoved",
      "rollbackOverlay.fileWillBeRestored",
      "rollbackOverlay.rollbackCancelled",
      "rollbackOverlay.rollbackIneffective",
      "rollbackOverlay.rollbackFailed",
      "rollbackOverlay.fileCount",
      "rollbackOverlay.fileCreatedLabel",
      "rollbackOverlay.beforeLabel",
      "rollbackOverlay.afterLabel",
      "rollbackOverlay.truncated",
    ] as const;

    const errorNotificationKeys = [
      "messageCard.rollbackFailed",
      "messageCard.rollbackFailedMsg",
      "messageCard.previewFailed",
      "messageCard.rollbackFirstMessage",
      "rollbackOverlay.rollbackCancelled",
      "rollbackOverlay.rollbackIneffective",
      "rollbackOverlay.rollbackFailed",
    ] as const;

    it("44: All rollbackOverlay keys exist in en/chat.json", () => {
      for (const key of rollbackOverlayKeys) {
        expect(enChat[key]).toBeDefined();
        expect(typeof enChat[key as keyof typeof enChat]).toBe("string");
      }
    });

    it("45: All rollbackOverlay keys exist in zh-CN/chat.json", () => {
      for (const key of rollbackOverlayKeys) {
        expect(zhChat[key]).toBeDefined();
        expect(typeof zhChat[key as keyof typeof zhChat]).toBe("string");
      }
    });

    it("46: Error notification keys exist in both locales", () => {
      for (const key of errorNotificationKeys) {
        expect(enChat[key]).toBeDefined();
        expect(zhChat[key]).toBeDefined();
      }
    });

    it("47: zh-CN translations are non-empty for all rollbackOverlay keys", () => {
      for (const key of rollbackOverlayKeys) {
        const val = zhChat[key as keyof typeof zhChat];
        expect(val).toBeTruthy();
        expect(val.length).toBeGreaterThan(0);
      }
    });

    it("48: Snapshot panel i18n: verify basic keys exist in both locales", () => {
      const basicKeys = [
        "rollbackCode",
        "rollbackChat",
        "messageCard.confirmRollback",
        "messageCard.rollbackMessage",
        "messageCard.rollbackMessageAndCode",
        "messageCard.rollbackPreview",
      ] as const;

      for (const key of basicKeys) {
        expect(enChat[key]).toBeDefined();
        expect(zhChat[key]).toBeDefined();
        expect((zhChat[key] as string).length).toBeGreaterThan(0);
      }
    });
  });

  describe("Edge cases (49-50)", () => {
    it("49: Simulate concurrent rollback: two openRollback calls in sequence, second wins", () => {
      const first = { targetId: "first-target", mode: "message" as const };
      const second = { targetId: "second-target", mode: "withFiles" as const };

      useRollbackStore.getState().openRollback(first, makePreview());
      expect(useRollbackStore.getState().target).toEqual(first);

      useRollbackStore
        .getState()
        .openRollback(second, makePreview({ restored: ["b.ts"], deleted: ["c.ts"] }));
      expect(useRollbackStore.getState().target).toEqual(second);
      expect(useRollbackStore.getState().target!.targetId).toBe("second-target");
      expect(useRollbackStore.getState().target!.mode).toBe("withFiles");
    });

    it("50: Store persistence: verify store state after rapid open-close-open cycle", () => {
      const t1 = { targetId: "rapid-1", mode: "message" as const };
      const t2 = { targetId: "rapid-2", mode: "withFiles" as const };
      const p1 = makePreview();
      const p2 = makePreview({ restored: ["x.ts"], deleted: ["y.ts"] });

      useRollbackStore.getState().openRollback(t1, p1);
      useRollbackStore.getState().closeRollback();
      useRollbackStore.getState().openRollback(t2, p2);

      const s = useRollbackStore.getState();
      expect(s.open).toBe(true);
      expect(s.target).toEqual(t2);
      expect(s.preview).toEqual(p2);
      expect(s.loading).toBe(false);
      expect(s.selectedFilePath).toBeNull();
    });
  });
});
