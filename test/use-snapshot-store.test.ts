import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall },
}));

import { useSnapshotStore } from "../src/mainview/stores/use-snapshot-store";
import type { SnapshotInfo } from "../src/mainview/types";

const SID = "sess-1";

function makeSnapshot(overrides: Partial<SnapshotInfo> = {}): SnapshotInfo {
  return {
    id: "snap-1",
    stepIndex: 0,
    timestamp: "2024-01-01T00:00:00Z",
    treeHash: "abc",
    diff: { added: [], modified: [], deleted: [] },
    files: {},
    rolledBack: false,
    ...overrides,
  };
}

describe("useSnapshotStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSnapshotStore.setState({
      snapshotsBySession: {},
      treeEntriesBySession: {},
      currentTreePath: {},
      fileContentBySession: {},
      loading: false,
      error: null,
    });
  });

  it("has correct initial state", () => {
    const s = useSnapshotStore.getState();
    expect(s.snapshotsBySession).toEqual({});
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("fetchSnapshots success sets snapshotsBySession[sessionId]", async () => {
    const snaps = [makeSnapshot(), makeSnapshot({ id: "snap-2" })];
    mockCall.mockResolvedValueOnce(snaps);
    await useSnapshotStore.getState().fetchSnapshots(SID);
    expect(useSnapshotStore.getState().snapshotsBySession[SID]).toEqual(snaps);
    expect(useSnapshotStore.getState().loading).toBe(false);
  });

  it("fetchSnapshots failure sets error", async () => {
    mockCall.mockRejectedValueOnce(new Error("list fail"));
    await useSnapshotStore.getState().fetchSnapshots(SID);
    expect(useSnapshotStore.getState().error).toBe("list fail");
    expect(useSnapshotStore.getState().loading).toBe(false);
  });

  it("getSnapshot success returns snapshot", async () => {
    const snap = makeSnapshot();
    mockCall.mockResolvedValueOnce(snap);
    const result = await useSnapshotStore.getState().getSnapshot(SID, "snap-1");
    expect(result).toEqual(snap);
  });

  it("getSnapshot failure returns null and sets error", async () => {
    mockCall.mockRejectedValueOnce(new Error("get fail"));
    const result = await useSnapshotStore.getState().getSnapshot(SID, "snap-1");
    expect(result).toBeNull();
    expect(useSnapshotStore.getState().error).toBe("get fail");
  });

  it("rollback success with ok=true auto-fetches snapshots", async () => {
    const snaps = [makeSnapshot()];
    mockCall
      .mockResolvedValueOnce({ ok: true, restoredFiles: ["a.ts"] })
      .mockResolvedValueOnce(snaps);
    const result = await useSnapshotStore.getState().rollback(SID, "snap-1");
    expect(result.ok).toBe(true);
    expect(result.restoredFiles).toEqual(["a.ts"]);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("rollback failure returns { ok: false, error }", async () => {
    mockCall.mockRejectedValueOnce(new Error("rb fail"));
    const result = await useSnapshotStore.getState().rollback(SID, "snap-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("rb fail");
  });

  it("unrevert success auto-fetches snapshots", async () => {
    mockCall.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce([]);
    const result = await useSnapshotStore.getState().unrevert(SID, "snap-1");
    expect(result.ok).toBe(true);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("navigateTree success sets treeEntriesBySession and currentTreePath", async () => {
    const entries = [{ name: "src", path: "src", type: "directory" as const }];
    mockCall.mockResolvedValueOnce({ entries, currentPath: "src" });
    await useSnapshotStore.getState().navigateTree(SID, "snap-1", "src");
    const s = useSnapshotStore.getState();
    expect(s.treeEntriesBySession[SID]).toEqual(entries);
    expect(s.currentTreePath[SID]).toBe("src");
    expect(s.loading).toBe(false);
  });

  it("getFileContent success sets fileContentBySession", async () => {
    const content = { path: "a.ts", content: "hello", contentHash: "h1" };
    mockCall.mockResolvedValueOnce(content);
    await useSnapshotStore.getState().getFileContent(SID, "snap-1", "a.ts");
    expect(useSnapshotStore.getState().fileContentBySession[SID]).toEqual(content);
  });

  it("clearSession removes all session data", async () => {
    const snaps = [makeSnapshot()];
    mockCall.mockResolvedValueOnce(snaps);
    await useSnapshotStore.getState().fetchSnapshots(SID);

    useSnapshotStore.getState().clearSession(SID);
    const s = useSnapshotStore.getState();
    expect(s.snapshotsBySession[SID]).toBeUndefined();
    expect(s.treeEntriesBySession[SID]).toBeUndefined();
    expect(s.currentTreePath[SID]).toBeUndefined();
    expect(s.fileContentBySession[SID]).toBeUndefined();
  });

  it("multiple sessions are stored independently", async () => {
    const snap1 = makeSnapshot({ id: "s1" });
    const snap2 = makeSnapshot({ id: "s2" });
    mockCall.mockResolvedValueOnce([snap1]).mockResolvedValueOnce([snap2]);

    await useSnapshotStore.getState().fetchSnapshots("sess-a");
    await useSnapshotStore.getState().fetchSnapshots("sess-b");

    const s = useSnapshotStore.getState();
    expect(s.snapshotsBySession["sess-a"]).toEqual([snap1]);
    expect(s.snapshotsBySession["sess-b"]).toEqual([snap2]);
  });
});
