import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: vi.fn(() => null),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { register } from "../../../src/shared/handlers/change-review";
import { getProcessManager } from "../../../src/shared/handlers/agent";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

function makeReviewTurnEntry(
  turnIndex: number,
  changes: Array<{ path: string; status: string }>,
  parentId = "root",
) {
  return JSON.stringify({
    type: "custom",
    customType: "file-review-turn",
    data: {
      turnIndex,
      timestamp: Date.now() + turnIndex * 1000,
      changes,
    },
    id: `turn-${turnIndex}-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    timestamp: new Date().toISOString(),
  });
}

function makeApprovalEntry(path: string, status: string, parentId = "turn-0-abc123") {
  return JSON.stringify({
    type: "custom",
    customType: "file-approval",
    data: {
      path,
      status,
      timestamp: Date.now(),
    },
    id: `approval-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    timestamp: new Date().toISOString(),
  });
}

describe("change-review handler", () => {
  let server: MockServer;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
    tempDir = join(
      tmpdir(),
      `change-review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("change-review.pending", () => {
    describe("with CLI process (channel call)", () => {
      it("should use channel call when agent process IS running", async () => {
        const callChannel = vi.fn(async () => [
          {
            turnIndex: 0,
            path: "src/a.ts",
            fileStatus: "modified",
            status: "pending",
            timestamp: Date.now(),
            oldContent: "old code",
            newContent: "new code",
            unifiedDiff: "--- a/src/a.ts\n+++ b/src/a.ts",
          },
          {
            turnIndex: 0,
            path: "src/b.ts",
            fileStatus: "added",
            status: "pending",
            timestamp: Date.now(),
            oldContent: null,
            newContent: "new file",
            unifiedDiff: "--- /dev/null\n+++ b/src/b.ts",
          },
        ]);

        (getProcessManager as Mock).mockReturnValue({
          hasSession: vi.fn(() => true),
          callChannel,
        } as unknown as ReturnType<typeof getProcessManager>);

        const handler = server.handlers.get("change-review.pending")!;
        const result = (await handler({
          sessionId: "test-session",
          sessionPath: "/some/path.jsonl",
        })) as { items: Array<{ path: string; oldContent: string | null; newContent: string | null; unifiedDiff?: string }>; totalCount: number; hasMore: boolean };

        expect(callChannel).toHaveBeenCalledWith(
          "test-session",
          "file-review",
          "review.pending",
          { sessionId: "test-session" },
        );
        expect(result.items).toHaveLength(2);
        expect(result.totalCount).toBe(2);
        expect(result.hasMore).toBe(false);
        expect(result.items[0].path).toBe("src/a.ts");
        expect(result.items[1].path).toBe("src/b.ts");
        expect(result.items[1].fileStatus).toBe("added");
      });

      it("should fall back to JSONL when channel call throws", async () => {
        const callChannel = vi.fn(async () => {
          throw new Error("channel timeout");
        });

        (getProcessManager as Mock).mockReturnValue({
          hasSession: vi.fn(() => true),
          callChannel,
        } as unknown as ReturnType<typeof getProcessManager>);

        const jsonlPath = join(tempDir, "session.jsonl");
        await writeFile(
          jsonlPath,
          makeReviewTurnEntry(0, [{ path: "src/fallback.ts", status: "added" }]) + "\n",
        );

        const handler = server.handlers.get("change-review.pending")!;
        const result = (await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        })) as { items: Array<{ path: string }>; totalCount: number; hasMore: boolean };

        expect(callChannel).toHaveBeenCalled();
        expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
        expect(result.items[0].path).toBe("src/fallback.ts");
      });
    });

    describe("without CLI process (JSONL fallback)", () => {
      it("should return pending changes from JSONL when agent process is not running", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        await writeFile(
          jsonlPath,
          makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "modified" }]) + "\n",
        );

        const handler = server.handlers.get("change-review.pending")!;
        const result = (await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        })) as { items: Array<{ path: string; fileStatus: string; status: string }>; totalCount: number; hasMore: boolean };

        expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
        expect(result.items[0].path).toBe("src/a.ts");
        expect(result.items[0].fileStatus).toBe("modified");
        expect(result.items[0].status).toBe("pending");
      });

      it("should exclude approved files", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        const turnLine = makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "modified" }]);
        const turnObj = JSON.parse(turnLine);
        const approvalLine = makeApprovalEntry("src/a.ts", "approved", turnObj.id);

        await writeFile(jsonlPath, turnLine + "\n" + approvalLine + "\n");

        const handler = server.handlers.get("change-review.pending")!;
        const result = await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        });

        expect(result.items).toEqual([]);
      });

      it("should exclude rejected files", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        const turnLine = makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "modified" }]);
        const turnObj = JSON.parse(turnLine);
        const approvalLine = makeApprovalEntry("src/a.ts", "rejected", turnObj.id);

        await writeFile(jsonlPath, turnLine + "\n" + approvalLine + "\n");

        const handler = server.handlers.get("change-review.pending")!;
        const result = await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        });

        expect(result.items).toEqual([]);
      });

      it("should return multiple pending files, excluding approved ones", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        const turnLine = makeReviewTurnEntry(0, [
          { path: "src/a.ts", status: "modified" },
          { path: "src/b.ts", status: "added" },
          { path: "src/c.ts", status: "deleted" },
        ]);
        const turnObj = JSON.parse(turnLine);
        const approvalLine = makeApprovalEntry("src/b.ts", "approved", turnObj.id);

        await writeFile(jsonlPath, turnLine + "\n" + approvalLine + "\n");

        const handler = server.handlers.get("change-review.pending")!;
        const result = (await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        })) as { items: Array<{ path: string; status: string }>; totalCount: number; hasMore: boolean };

        expect(result.items).toHaveLength(2);
        expect(result.totalCount).toBe(2);
        expect(result.hasMore).toBe(false);
        const paths = result.items.map((r) => r.path);
        expect(paths).toContain("src/a.ts");
        expect(paths).toContain("src/c.ts");
        expect(paths).not.toContain("src/b.ts");
        expect(result.items.every((r) => r.status === "pending")).toBe(true);
      });

      it("should apply net-zero rule: skip added-then-deleted without approval", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        const turn0 = makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "added" }], "root");
        const turn0Obj = JSON.parse(turn0);
        const turn2 = makeReviewTurnEntry(2, [{ path: "src/a.ts", status: "deleted" }], turn0Obj.id);

        await writeFile(jsonlPath, turn0 + "\n" + turn2 + "\n");

        const handler = server.handlers.get("change-review.pending")!;
        const result = await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        });

        expect(result.items).toEqual([]);
      });

      it("should NOT apply net-zero when file was previously approved", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const jsonlPath = join(tempDir, "session.jsonl");
        const turn0 = makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "added" }], "root");
        const turn0Obj = JSON.parse(turn0);
        const approval = makeApprovalEntry("src/a.ts", "approved", turn0Obj.id);
        const approvalObj = JSON.parse(approval);
        const turn2 = makeReviewTurnEntry(
          2,
          [{ path: "src/a.ts", status: "deleted" }],
          approvalObj.id,
        );

        await writeFile(jsonlPath, turn0 + "\n" + approval + "\n" + turn2 + "\n");

        const handler = server.handlers.get("change-review.pending")!;
        const result = (await handler({
          sessionId: "test-session",
          sessionPath: jsonlPath,
        })) as { items: Array<{ path: string; fileStatus: string; status: string }>; totalCount: number; hasMore: boolean };

        expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
        expect(result.items[0].path).toBe("src/a.ts");
        expect(result.items[0].fileStatus).toBe("deleted");
        expect(result.items[0].status).toBe("pending");
      });

      it("should return empty array when sessionPath is not provided", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const handler = server.handlers.get("change-review.pending")!;
        const result = await handler({
          sessionId: "test-session",
        });

        expect(result.items).toEqual([]);
      });

      it("should return empty array when JSONL file does not exist", async () => {
        (getProcessManager as Mock).mockReturnValue(null);

        const handler = server.handlers.get("change-review.pending")!;
        const result = await handler({
          sessionId: "test-session",
          sessionPath: "/no/such/path/session.jsonl",
        });

        expect(result.items).toEqual([]);
      });
    });
  });

  describe("change-review.approvals", () => {
    it("should use channel call when agent process is running", async () => {
      const callChannel = vi.fn(async () => [
        {
          turnIndex: -1,
          path: "src/a.ts",
          status: "approved",
          timestamp: Date.now(),
          snapshotEntryId: "snap-1",
        },
      ]);

      (getProcessManager as Mock).mockReturnValue({
        hasSession: vi.fn(() => true),
        callChannel,
      } as unknown as ReturnType<typeof getProcessManager>);

      const handler = server.handlers.get("change-review.approvals")!;
      const result = (await handler({
        sessionId: "test-session",
        status: "approved",
      })) as { items: Array<{ path: string; status: string; snapshotEntryId?: string }>; totalCount: number; hasMore: boolean };

      expect(callChannel).toHaveBeenCalledWith(
        "test-session",
        "file-review",
        "review.approvals",
        { status: "approved" },
      );
      expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        path: "src/a.ts",
        status: "approved",
        snapshotEntryId: "snap-1",
      });
    });

    it("should read approvals from JSONL fallback", async () => {
      (getProcessManager as Mock).mockReturnValue(null);

      const jsonlPath = join(tempDir, "session.jsonl");
      const turnLine = makeReviewTurnEntry(0, [{ path: "src/a.ts", status: "modified" }]);
      const turnObj = JSON.parse(turnLine);
      const approvalLine = JSON.stringify({
        type: "custom",
        customType: "file-approval",
        data: {
          path: "src/a.ts",
          status: "approved",
          timestamp: Date.now(),
          snapshotEntryId: "snap-2",
          snapshotTreeHash: "tree-2",
        },
        id: "approval-1",
        parentId: turnObj.id,
        timestamp: new Date().toISOString(),
      });

      await writeFile(jsonlPath, turnLine + "\n" + approvalLine + "\n");

      const handler = server.handlers.get("change-review.approvals")!;
      const result = (await handler({
        sessionId: "test-session",
        sessionPath: jsonlPath,
      })) as { items: Array<{ path: string; status: string; snapshotEntryId?: string; snapshotTreeHash?: string }>; totalCount: number; hasMore: boolean };

      expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        path: "src/a.ts",
        status: "approved",
        snapshotEntryId: "snap-2",
        snapshotTreeHash: "tree-2",
      });
    });

    it("should filter approvals by status in JSONL fallback", async () => {
      (getProcessManager as Mock).mockReturnValue(null);

      const jsonlPath = join(tempDir, "session.jsonl");
      await writeFile(
        jsonlPath,
        [
          makeApprovalEntry("src/a.ts", "approved"),
          makeApprovalEntry("src/b.ts", "rejected"),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("change-review.approvals")!;
      const result = (await handler({
        sessionId: "test-session",
        sessionPath: jsonlPath,
        status: "approved",
      })) as { items: Array<{ path: string; status: string }>; totalCount: number; hasMore: boolean };

      expect(result.items).toHaveLength(1);
        expect(result.totalCount).toBe(1);
        expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({ path: "src/a.ts", status: "approved" });
    });
  });
});
