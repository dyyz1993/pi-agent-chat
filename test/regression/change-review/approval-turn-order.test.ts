import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

interface TurnEntryData {
  turnIndex: number;
  timestamp: number;
  changes: Array<{ path: string; status: string }>;
}

interface ApprovalEntryData {
  path: string;
  status: string;
  timestamp: number;
  snapshotEntryId?: string;
  snapshotTreeHash?: string;
}

function makeTurnLine(data: TurnEntryData): string {
  return JSON.stringify({
    type: "custom",
    customType: "file-review-turn",
    data,
    id: `turn-${data.turnIndex}-${Math.random().toString(36).slice(2, 8)}`,
    parentId: "root",
    timestamp: new Date(data.timestamp).toISOString(),
  });
}

function makeApprovalLine(data: ApprovalEntryData): string {
  return JSON.stringify({
    type: "custom",
    customType: "file-approval",
    data,
    id: `approval-${Math.random().toString(36).slice(2, 8)}`,
    parentId: "root",
    timestamp: new Date(data.timestamp).toISOString(),
  });
}

/**
 * Regression for issue #162: approval panel did not reflect latest code changes
 * after CLI restart. Root cause was `readReviewStateFromJsonl` computing
 * `maxTurnIndexAtLastApproval` from physical line order — which is corrupted
 * by compaction, CLI restart re-writes, or any out-of-order flush.
 *
 * Fix computes the value from timestamps instead, making it robust to physical
 * line ordering.
 */
describe("change-review approval-turn ordering regression (#162)", () => {
  let server: MockServer;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    (getProcessManager as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
    tempDir = join(
      tmpdir(),
      `cr-order-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("normal order: turn written before approval -> file correctly excluded", async () => {
    const jsonlPath = join(tempDir, "session.jsonl");
    const T0 = 1_000_000;
    const lines = [
      makeTurnLine({
        turnIndex: 0,
        timestamp: T0,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
      makeApprovalLine({ path: "src/a.ts", status: "approved", timestamp: T0 + 500 }),
    ];
    await writeFile(jsonlPath, lines.join("\n") + "\n");

    const handler = server.handlers.get("change-review.pending")!;
    const result = await handler({ sessionId: "s", sessionPath: jsonlPath });
    expect(result.items).toEqual([]);
  });

  /**
   * KEY REGRESSION CASE: approval line written BEFORE the turn line (e.g. CLI
   * restart re-flushes approval log first, then turn log). Old code would
   * capture `currentMaxTurn=-1` at approval time and the file would NOT be
   * excluded — appearing as "pending" forever even though it was approved.
   *
   * With timestamp-based computation, this works regardless of line order.
   */
  it("abnormal order: approval written BEFORE turn -> still correctly excluded", async () => {
    const jsonlPath = join(tempDir, "session.jsonl");
    const T0 = 1_000_000;
    const lines = [
      // approval line FIRST (out of order)
      makeApprovalLine({ path: "src/a.ts", status: "approved", timestamp: T0 + 500 }),
      // turn line SECOND
      makeTurnLine({
        turnIndex: 0,
        timestamp: T0,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
    ];
    await writeFile(jsonlPath, lines.join("\n") + "\n");

    const handler = server.handlers.get("change-review.pending")!;
    const result = await handler({ sessionId: "s", sessionPath: jsonlPath });
    expect(result.items).toEqual([]);
  });

  /**
   * Post-compaction scenario: a turn at turnIndex=5 was previously approved
   * at turnIndex=3, but compaction rewrote the approval entry AFTER the
   * turn-5 entry in the file. Old code would set approvalTurn=5 (from
   * currentMaxTurn at the approval line), causing `latestTurnIndex(5) <= 5`
   * to be TRUE and wrongly skipping a file that actually has pending
   * changes since the approval.
   *
   * Fix: approvalTurn is computed from approval.timestamp, so it stays at 3
   * (the highest turnIndex with timestamp <= approval timestamp). File with
   * latestTurnIndex=5 should NOT be skipped.
   */
  it("post-compaction: approval written after later turn -> newer turn still shown pending", async () => {
    const jsonlPath = join(tempDir, "session.jsonl");
    const T0 = 1_000_000;
    const lines = [
      makeTurnLine({
        turnIndex: 3,
        timestamp: T0,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
      makeTurnLine({
        turnIndex: 5,
        timestamp: T0 + 10_000,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
      // approval log was rewritten AFTER turn-5 due to compaction, but its
      // timestamp reflects when approval actually happened (between turn 3 and 5)
      makeApprovalLine({ path: "src/a.ts", status: "approved", timestamp: T0 + 5_000 }),
    ];
    await writeFile(jsonlPath, lines.join("\n") + "\n");

    const handler = server.handlers.get("change-review.pending")!;
    const result = (await handler({
      sessionId: "s",
      sessionPath: jsonlPath,
    })) as { items: Array<{ path: string; turnIndex: number; status: string }>; totalCount: number; hasMore: boolean };
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe("src/a.ts");
    expect(result.items[0].turnIndex).toBe(5);
    expect(result.items[0].status).toBe("pending");
  });

  /**
   * Sanity: file approved at turn 5, no later turn — file should be excluded
   * (no false positive pending).
   */
  it("approval timestamp after the latest turn -> file correctly excluded", async () => {
    const jsonlPath = join(tempDir, "session.jsonl");
    const T0 = 1_000_000;
    const lines = [
      makeTurnLine({
        turnIndex: 5,
        timestamp: T0,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
      makeApprovalLine({ path: "src/a.ts", status: "approved", timestamp: T0 + 5_000 }),
    ];
    await writeFile(jsonlPath, lines.join("\n") + "\n");

    const handler = server.handlers.get("change-review.pending")!;
    const result = await handler({ sessionId: "s", sessionPath: jsonlPath });
    expect(result.items).toEqual([]);
  });

  /**
   * Multiple files, mixed order. Verifies per-path computation is independent.
   */
  it("multiple files interleaved out-of-order -> each path resolved independently", async () => {
    const jsonlPath = join(tempDir, "session.jsonl");
    const T0 = 1_000_000;
    const lines = [
      // a.ts: approved after turn 0, no further changes -> excluded
      makeApprovalLine({ path: "src/a.ts", status: "approved", timestamp: T0 + 500 }),
      makeTurnLine({
        turnIndex: 0,
        timestamp: T0,
        changes: [{ path: "src/a.ts", status: "modified" }],
      }),
      // b.ts: turn 0 then turn 2, approval at turn 0 only -> turn 2 still pending
      makeTurnLine({
        turnIndex: 0,
        timestamp: T0,
        changes: [{ path: "src/b.ts", status: "modified" }],
      }),
      makeApprovalLine({ path: "src/b.ts", status: "approved", timestamp: T0 + 500 }),
      makeTurnLine({
        turnIndex: 2,
        timestamp: T0 + 20_000,
        changes: [{ path: "src/b.ts", status: "modified" }],
      }),
    ];
    await writeFile(jsonlPath, lines.join("\n") + "\n");

    const handler = server.handlers.get("change-review.pending")!;
    const result = (await handler({
      sessionId: "s",
      sessionPath: jsonlPath,
    })) as { items: Array<{ path: string; turnIndex: number }>; totalCount: number; hasMore: boolean };
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe("src/b.ts");
    expect(result.items[0].turnIndex).toBe(2);
  });
});
