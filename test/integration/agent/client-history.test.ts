/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  cloneOperation,
  exportHtmlOperation,
  getBatchDiffsOperation,
  getFileDiffOperation,
  getForkMessagesOperation,
  getLastAssistantTextOperation,
  getModifiedFilesOperation,
  forkOperation,
  newSessionOperation,
  previewRollbackOperation,
  restoreFilesFromSnapshotOperation,
} from "../../../src/shared/agent/agent-client-history-operations";

function makeManaged(client: Record<string, unknown>) {
  return { client };
}

describe("agent client history operations", () => {
  it("returns text and fork messages with empty fallbacks", async () => {
    await expect(
      getLastAssistantTextOperation({ sessionId: "sess-1", getActiveManaged: () => null }),
    ).resolves.toEqual({ text: null });
    await expect(
      getForkMessagesOperation({ sessionId: "sess-1", getActiveManaged: () => null }),
    ).resolves.toEqual({ messages: [] });

    const managed = makeManaged({
      getLastAssistantText: vi.fn().mockResolvedValue("hello"),
      getForkMessages: vi.fn().mockResolvedValue([{ entryId: "e1", text: "hello" }]),
    });

    await expect(
      getLastAssistantTextOperation({ sessionId: "sess-1", getActiveManaged: () => managed }),
    ).resolves.toEqual({ text: "hello" });
    await expect(
      getForkMessagesOperation({ sessionId: "sess-1", getActiveManaged: () => managed }),
    ).resolves.toEqual({ messages: [{ entryId: "e1", text: "hello" }] });
  });

  it("forwards rollback preview and diff requests", async () => {
    const getModifiedFiles = vi.fn().mockResolvedValue({
      files: [{ path: "a.ts", status: "modified", turnIndex: 1, entryId: "e2" }],
      resolvedFromEntryId: "e1",
    });
    const getFileDiff = vi.fn().mockResolvedValue({
      path: "a.ts",
      oldContent: "a",
      newContent: "b",
      unifiedDiff: "@@",
    });
    const getBatchDiffs = vi.fn().mockResolvedValue({
      files: [],
      summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
    });
    const managed = makeManaged({
      previewRollback: vi.fn().mockResolvedValue({ restored: ["a.ts"], deleted: [] }),
      getModifiedFiles,
      getFileDiff,
      getBatchDiffs,
    });
    const getActiveManaged = () => managed;

    await expect(
      previewRollbackOperation({ sessionId: "sess-1", targetId: "e1", getActiveManaged }),
    ).resolves.toEqual({ restored: ["a.ts"], deleted: [] });
    await getModifiedFilesOperation({
      sessionId: "sess-1",
      fromEntryId: "e1",
      toEntryId: "e2",
      toUserMsgEntryId: "u2",
      getActiveManaged,
    });
    await getFileDiffOperation({
      sessionId: "sess-1",
      filePath: "a.ts",
      fromEntryId: "e1",
      toEntryId: "e2",
      getActiveManaged,
    });
    await getBatchDiffsOperation({
      sessionId: "sess-1",
      fromEntryId: "e1",
      toEntryId: "e2",
      getActiveManaged,
    });

    expect(getModifiedFiles).toHaveBeenCalledWith({
      fromEntryId: "e1",
      toEntryId: "e2",
      toUserMsgEntryId: "u2",
    });
    expect(getFileDiff).toHaveBeenCalledWith({
      filePath: "a.ts",
      fromEntryId: "e1",
      toEntryId: "e2",
    });
    expect(getBatchDiffs).toHaveBeenCalledWith({ fromEntryId: "e1", toEntryId: "e2" });
  });

  it("falls back to getBatchDiffs when getModifiedFiles returns an empty file list", async () => {
    const getModifiedFiles = vi.fn().mockResolvedValue({
      files: [],
      resolvedFromEntryId: "snap-2",
    });
    const getBatchDiffs = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/a.ts",
          status: "modified" as const,
          diff: {
            path: "src/a.ts",
            oldContent: "a",
            newContent: "b",
            unifiedDiff: "@@",
          },
        },
        {
          path: "src/b.ts",
          status: "added" as const,
          diff: null,
        },
      ],
      summary: { totalFiles: 2, added: 1, modified: 1, deleted: 0 },
    });

    const managed = makeManaged({
      getModifiedFiles,
      getBatchDiffs,
    });

    await expect(
      getModifiedFilesOperation({
        sessionId: "sess-1",
        fromEntryId: "snap-2",
        getActiveManaged: () => managed,
      }),
    ).resolves.toEqual({
      files: [
        { path: "src/a.ts", status: "modified", turnIndex: 0, entryId: "snap-2" },
        { path: "src/b.ts", status: "added", turnIndex: 1, entryId: "snap-2" },
      ],
      resolvedFromEntryId: "snap-2",
    });

    expect(getBatchDiffs).toHaveBeenCalledWith({ fromEntryId: "snap-2", toEntryId: undefined });
  });

  it("forks by copy-forking a branched session without switching the active client", async () => {
    const copyFork = vi.fn().mockResolvedValue({
      newSessionFile: "/tmp/forked.jsonl",
      newSessionId: "fork-session",
    });
    const fork = vi.fn().mockResolvedValue({ cancelled: false });
    const managed = makeManaged({ copyFork, fork });

    await expect(
      forkOperation({
        sessionId: "sess-1",
        entryId: "entry-1",
        forkOptions: { position: "at" },
        getActiveManaged: () => managed,
      }),
    ).resolves.toMatchObject({
      cancelled: false,
      newSessionFile: "/tmp/forked.jsonl",
      newSessionId: "fork-session",
    });

    expect(copyFork).toHaveBeenCalledWith("entry-1");
    expect(fork).not.toHaveBeenCalled();
  });

  it("restores snapshot files through the file-snapshot channel", async () => {
    const call = vi.fn().mockResolvedValue({ restored: ["src/app.tsx"] });
    const channel = vi.fn().mockReturnValue({ call });
    const managed = makeManaged({ channel });

    await expect(
      restoreFilesFromSnapshotOperation({
        sessionId: "sess-1",
        snapshotTreeHash: "abc",
        files: ["src/app.tsx"],
        getActiveManaged: () => managed,
      }),
    ).resolves.toEqual(["src/app.tsx"]);

    expect(channel).toHaveBeenCalledWith("file-snapshot");
    expect(call).toHaveBeenCalledWith("snapshot.restoreByHash", {
      snapshotTreeHash: "abc",
      files: ["src/app.tsx"],
    });
  });

  it("forwards clone, new session, and export calls", async () => {
    const client = {
      clone: vi.fn().mockResolvedValue({ cancelled: false }),
      newSession: vi.fn().mockResolvedValue({ cancelled: false }),
      exportHtml: vi.fn().mockResolvedValue({ path: "/tmp/session.html" }),
    };
    const managed = makeManaged(client);
    const getActiveManaged = () => managed;

    await expect(cloneOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual({
      cancelled: false,
    });
    await expect(
      newSessionOperation({ sessionId: "sess-1", parentSession: "parent", getActiveManaged }),
    ).resolves.toEqual({ cancelled: false });
    await expect(
      exportHtmlOperation({ sessionId: "sess-1", outputPath: "/tmp/session.html", getActiveManaged }),
    ).resolves.toEqual({ path: "/tmp/session.html" });

    expect(client.newSession).toHaveBeenCalledWith("parent");
    expect(client.exportHtml).toHaveBeenCalledWith("/tmp/session.html");
  });
});
