import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({ activeSessionId: "test-session" }),
    subscribe: vi.fn(),
  },
}));

import { useMemoryStore } from "../src/mainview/stores/use-memory-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockReset();
  useMemoryStore.setState({
    eventsBySession: {},
    filesBySession: {},
    entrypointBySession: {},
    injectedBySession: {},
    expandedFileBySession: {},
    collapsedSections: new Set(["operations"]),
    bookmarkCreatingBySession: {},
    irrelevantMarkedBySession: {},
  });
});

describe("useMemoryStore", () => {
  const SID = "sess-1";

  it("initial state: eventsBySession={}, collapsedSections has 'operations'", () => {
    const s = useMemoryStore.getState();
    expect(s.eventsBySession).toEqual({});
    expect(s.collapsedSections.has("operations")).toBe(true);
  });

  it("addEvent adds to eventsBySession", () => {
    useMemoryStore.getState().addEvent(SID, {
      id: "e1",
      customType: "type-a",
      data: {},
      timestamp: 1000,
    });
    const events = useMemoryStore.getState().eventsBySession[SID];
    expect(events).toHaveLength(1);
    expect(events[0].customType).toBe("type-a");
  });

  it("addEvent: different events with same customType+timestamp should BOTH be kept", () => {
    useMemoryStore.getState().addEvent(SID, {
      id: "event-alpha",
      customType: "memory_prefetch_result",
      data: { summary: "第一次搜索结果", injectedBytes: 1024 },
      timestamp: 1000,
    });
    useMemoryStore.getState().addEvent(SID, {
      id: "event-beta",
      customType: "memory_prefetch_result",
      data: { summary: "第二次搜索结果", injectedBytes: 2048 },
      timestamp: 1000,
    });
    const events = useMemoryStore.getState().eventsBySession[SID];
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("event-alpha");
    expect(events[1].id).toBe("event-beta");
  });

  it("addEvent deduplicates by event id (same id = duplicate)", () => {
    useMemoryStore.getState().addEvent(SID, {
      id: "same-id",
      customType: "type-a",
      data: {},
      timestamp: 1000,
    });
    useMemoryStore.getState().addEvent(SID, {
      id: "same-id",
      customType: "type-a",
      data: { other: true },
      timestamp: 1000,
    });
    expect(useMemoryStore.getState().eventsBySession[SID]).toHaveLength(1);
  });

  it("loadFiles succeeds and sets filesBySession + entrypointBySession", async () => {
    const files = [
      { filename: "a.md", filePath: "/a.md", description: "desc", type: "md", mtimeMs: 1 },
    ];
    mockCall.mockResolvedValue({ files, entrypointContent: "entry" });

    await useMemoryStore.getState().loadFiles("/project", SID);
    await new Promise((r) => setTimeout(r, 150));

    expect(useMemoryStore.getState().filesBySession[SID]).toEqual(files);
    expect(useMemoryStore.getState().entrypointBySession[SID]).toBe("entry");
  });

  it("loadFiles failure does not crash", async () => {
    mockCall.mockRejectedValue(new Error("fail"));
    await useMemoryStore.getState().loadFiles("/project", SID);
    await new Promise((r) => setTimeout(r, 150));
    expect(useMemoryStore.getState().filesBySession[SID]).toBeUndefined();
  });

  it("addInjected adds to injectedBySession", () => {
    useMemoryStore.getState().addInjected(SID, {
      summary: "s1",
      snippet: "sn1",
    });
    const injected = useMemoryStore.getState().injectedBySession[SID];
    expect(injected).toHaveLength(1);
    expect(injected[0].summary).toBe("s1");
  });

  it("addInjected deduplicates by summary+snippet", () => {
    useMemoryStore.getState().addInjected(SID, { summary: "s1", snippet: "sn1" });
    useMemoryStore.getState().addInjected(SID, { summary: "s1", snippet: "sn1" });
    expect(useMemoryStore.getState().injectedBySession[SID]).toHaveLength(1);
  });

  it("setExpandedFile sets expandedFileBySession", () => {
    useMemoryStore.getState().setExpandedFile("/a.md");
    expect(useMemoryStore.getState().expandedFileBySession["test-session"]).toBe("/a.md");
  });

  it("toggleSection toggles", () => {
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(true);
    useMemoryStore.getState().toggleSection("operations");
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(false);
  });

  it("loadFiles debounces: rapid calls only trigger one RPC", async () => {
    mockCall.mockResolvedValue({ files: [], entrypointContent: null });

    useMemoryStore.getState().loadFiles("/project", SID);
    useMemoryStore.getState().loadFiles("/project", SID);
    useMemoryStore.getState().loadFiles("/project", SID);

    await new Promise((r) => setTimeout(r, 500));

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("clearSession removes all session data", () => {
    useMemoryStore.getState().addEvent(SID, {
      id: "e1",
      customType: "t",
      data: {},
      timestamp: 1,
    });
    useMemoryStore.getState().addInjected(SID, { summary: "s", snippet: "sn" });
    useMemoryStore.setState({
      filesBySession: { [SID]: [] },
      entrypointBySession: { [SID]: null },
      bookmarkCreatingBySession: { [SID]: false },
    });

    useMemoryStore.getState().clearSession(SID);

    const s = useMemoryStore.getState();
    expect(s.eventsBySession[SID]).toBeUndefined();
    expect(s.filesBySession[SID]).toBeUndefined();
    expect(s.injectedBySession[SID]).toBeUndefined();
    expect(s.entrypointBySession[SID]).toBeUndefined();
    expect(s.bookmarkCreatingBySession[SID]).toBeUndefined();
  });
});

describe("useMemoryStore — mark irrelevant", () => {
  const SID = "sess-irr";
  const SID2 = "sess-irr-2";

  describe("addIrrelevantMark", () => {
    it("adds blockId to empty set", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-a");
      const marked = useMemoryStore.getState().irrelevantMarkedBySession[SID];
      expect(marked).toBeDefined();
      expect(marked.size).toBe(1);
    });

    it("adds multiple blockIds to same session", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-a");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-b");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-c");
      const marked = useMemoryStore.getState().irrelevantMarkedBySession[SID];
      expect(marked.size).toBe(3);
    });

    it("does not duplicate if same blockId added twice", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-dup");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-dup");
      const marked = useMemoryStore.getState().irrelevantMarkedBySession[SID];
      expect(marked.size).toBe(1);
    });

    it("different sessions have independent sets", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-x");
      useMemoryStore.getState().addIrrelevantMark(SID2, "block-y");
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-x")).toBe(true);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-y")).toBe(false);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID2, "block-y")).toBe(true);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID2, "block-x")).toBe(false);
    });

    it("does not affect other session state (events, files, etc.)", () => {
      useMemoryStore.getState().addEvent(SID, {
        id: "ev-irr",
        customType: "t",
        data: {},
        timestamp: 1,
      });
      useMemoryStore.getState().addInjected(SID, { summary: "s", snippet: "sn" });
      useMemoryStore.setState({
        filesBySession: {
          [SID]: [
            { filename: "f.md", filePath: "/f.md", description: "d", type: "md", mtimeMs: 1 },
          ],
        },
      });

      useMemoryStore.getState().addIrrelevantMark(SID, ["safe.md"]);

      const s = useMemoryStore.getState();
      expect(s.eventsBySession[SID]).toHaveLength(1);
      expect(s.injectedBySession[SID]).toHaveLength(1);
      expect(s.filesBySession[SID]).toHaveLength(1);
    });
  });

  describe("isIrrelevantMarked", () => {
    it("returns false for non-existent session", () => {
      expect(useMemoryStore.getState().isIrrelevantMarked("no-such-session", "block-1")).toBe(
        false,
      );
    });

    it("returns false for existing session but non-existent blockId", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-exists");
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-nope")).toBe(false);
    });

    it("returns true after addIrrelevantMark", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-marked");
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-marked")).toBe(true);
    });

    it("returns false for different session's marks", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-only-a");
      expect(useMemoryStore.getState().isIrrelevantMarked(SID2, "block-only-a")).toBe(false);
    });

    it("handles multiple marks in same session", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-m1");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-m2");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-m3");
      const s = useMemoryStore.getState();
      expect(s.isIrrelevantMarked(SID, "block-m1")).toBe(true);
      expect(s.isIrrelevantMarked(SID, "block-m2")).toBe(true);
      expect(s.isIrrelevantMarked(SID, "block-m3")).toBe(true);
      expect(s.isIrrelevantMarked(SID, "block-m4")).toBe(false);
    });

    it("deduplicates same blockId", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-dup");
      useMemoryStore.getState().addIrrelevantMark(SID, "block-dup");
      const marks = useMemoryStore.getState().irrelevantMarkedBySession[SID];
      expect(marks).toBeDefined();
      expect([...marks!]).toEqual(["block-dup"]);
    });
  });

  describe("markIrrelevant", () => {
    it("calls apiClient.call with correct params", async () => {
      mockCall.mockResolvedValue({});
      await useMemoryStore.getState().markIrrelevant(SID, "block-rpc", "test query", ["a.ts"]);
      expect(mockCall).toHaveBeenCalledWith("memory.markIrrelevant", {
        sessionId: SID,
        query: "test query",
        selectedFiles: ["a.ts"],
      });
    });

    it("calls addIrrelevantMark after successful RPC", async () => {
      mockCall.mockResolvedValue({});
      await useMemoryStore.getState().markIrrelevant(SID, "block-after", "q", ["file.md"]);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-after")).toBe(true);
    });

    it("does not add mark if RPC fails (catches error)", async () => {
      mockCall.mockRejectedValue(new Error("rpc fail"));
      await useMemoryStore.getState().markIrrelevant(SID, "block-fail", "q", ["fail.md"]);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-fail")).toBe(false);
    });

    it("works with various query strings and file arrays", async () => {
      mockCall.mockResolvedValue({});
      await useMemoryStore
        .getState()
        .markIrrelevant(SID, "block-var", "complex query with spaces & symbols!", [
          "foo.ts",
          "bar.ts",
          "baz.ts",
        ]);
      expect(mockCall).toHaveBeenCalledWith("memory.markIrrelevant", {
        sessionId: SID,
        query: "complex query with spaces & symbols!",
        selectedFiles: ["foo.ts", "bar.ts", "baz.ts"],
      });
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-var")).toBe(true);
    });

    it("handles empty selectedFiles — still calls RPC and marks block", async () => {
      mockCall.mockResolvedValue({});
      await useMemoryStore.getState().markIrrelevant(SID, "block-empty", "q", []);
      expect(mockCall).toHaveBeenCalledWith("memory.markIrrelevant", {
        sessionId: SID,
        query: "q",
        selectedFiles: [],
      });
      expect(useMemoryStore.getState().isIrrelevantMarked(SID, "block-empty")).toBe(true);
    });
  });

  describe("clearSession — irrelevant marks", () => {
    it("clears irrelevantMarkedBySession for cleared session", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-clear");
      useMemoryStore.getState().clearSession(SID);
      expect(useMemoryStore.getState().irrelevantMarkedBySession[SID]).toBeUndefined();
    });

    it("does not clear other sessions' marks", () => {
      useMemoryStore.getState().addIrrelevantMark(SID, "block-a");
      useMemoryStore.getState().addIrrelevantMark(SID2, "block-b");
      useMemoryStore.getState().clearSession(SID);
      expect(useMemoryStore.getState().isIrrelevantMarked(SID2, "block-b")).toBe(true);
      expect(useMemoryStore.getState().irrelevantMarkedBySession[SID]).toBeUndefined();
    });
  });
});
