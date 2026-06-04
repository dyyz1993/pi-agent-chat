import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: "test-session" })),
  },
}));

import { useMemoryStore } from "../src/mainview/stores/use-memory-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  const { setState } = useMemoryStore;
  setState({
    eventsBySession: {},
    filesBySession: {},
    entrypointBySession: {},
    injectedBySession: {},
    expandedFileBySession: {},
    collapsedSections: new Set(["operations"]),
  });
});

describe("addEvent", () => {
  it("adds event to correct session", () => {
    const event = {
      id: "e1",
      customType: "memory.write",
      data: { foo: "bar" },
      timestamp: Date.now(),
    };
    useMemoryStore.getState().addEvent("sess-1", event);

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0]).toEqual(event);
  });

  it("does not affect other sessions", () => {
    const event1 = { id: "e1", customType: "a", data: null, timestamp: 1 };
    const event2 = { id: "e2", customType: "b", data: null, timestamp: 2 };

    useMemoryStore.getState().addEvent("sess-1", event1);
    useMemoryStore.getState().addEvent("sess-2", event2);

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].id).toBe("e1");
    expect(state.eventsBySession["sess-2"]).toHaveLength(1);
    expect(state.eventsBySession["sess-2"][0].id).toBe("e2");
  });

  it("appends multiple events to same session", () => {
    const e1 = { id: "e1", customType: "a", data: null, timestamp: 1 };
    const e2 = { id: "e2", customType: "b", data: null, timestamp: 2 };

    useMemoryStore.getState().addEvent("sess-1", e1);
    useMemoryStore.getState().addEvent("sess-1", e2);

    expect(useMemoryStore.getState().eventsBySession["sess-1"]).toHaveLength(2);
  });
});

describe("loadFiles", () => {
  it("updates files and entrypoint on success", async () => {
    const files = [
      {
        filename: "pref.md",
        filePath: "/a/pref.md",
        description: "desc",
        type: "user",
        mtimeMs: 1000,
        size: 50,
      },
    ];
    mockedCall.mockResolvedValueOnce({
      files,
      entrypointContent: "# Memory",
      memoryDir: "/memory/dir",
    });

    await useMemoryStore.getState().loadFiles("/project", "sess-1");
    await new Promise((r) => setTimeout(r, 150));

    const state = useMemoryStore.getState();
    expect(state.filesBySession["sess-1"]).toEqual(files);
    expect(state.entrypointBySession["sess-1"]).toBe("# Memory");
    expect(mockedCall).toHaveBeenCalledWith("memory.listFiles", { projectPath: "/project" });
  });

  it("handles error gracefully", async () => {
    mockedCall.mockRejectedValueOnce(new Error("RPC fail"));

    await useMemoryStore.getState().loadFiles("/project", "sess-1");
    await new Promise((r) => setTimeout(r, 150));

    const state = useMemoryStore.getState();
    expect(state.filesBySession["sess-1"]).toBeUndefined();
    expect(state.entrypointBySession["sess-1"]).toBeUndefined();
  });
});

describe("addInjected", () => {
  it("adds injected memory", () => {
    useMemoryStore.getState().addInjected("sess-1", { summary: "sum", snippet: "snip" });

    const state = useMemoryStore.getState();
    expect(state.injectedBySession["sess-1"]).toHaveLength(1);
    expect(state.injectedBySession["sess-1"][0]).toEqual({ summary: "sum", snippet: "snip" });
  });

  it("appends multiple injected memories", () => {
    useMemoryStore.getState().addInjected("sess-1", { summary: "a", snippet: "a1" });
    useMemoryStore.getState().addInjected("sess-1", { summary: "b", snippet: "b1" });

    expect(useMemoryStore.getState().injectedBySession["sess-1"]).toHaveLength(2);
  });
});

describe("setExpandedFile", () => {
  it("sets expanded file", () => {
    useMemoryStore.getState().setExpandedFile("/path/to/file.md");
    expect(useMemoryStore.getState().expandedFileBySession["test-session"]).toBe(
      "/path/to/file.md",
    );
  });

  it("clears expanded file with null", () => {
    useMemoryStore.getState().setExpandedFile("/path/to/file.md");
    useMemoryStore.getState().setExpandedFile(null);
    expect(useMemoryStore.getState().expandedFileBySession["test-session"]).toBeNull();
  });
});

describe("toggleSection", () => {
  it("toggles collapsed state", () => {
    const initial = useMemoryStore.getState().collapsedSections;
    expect(initial.has("operations")).toBe(true);

    useMemoryStore.getState().toggleSection("operations");
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(false);

    useMemoryStore.getState().toggleSection("operations");
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(true);
  });

  it("adds new section to collapsed", () => {
    expect(useMemoryStore.getState().collapsedSections.has("files")).toBe(false);
    useMemoryStore.getState().toggleSection("files");
    expect(useMemoryStore.getState().collapsedSections.has("files")).toBe(true);
  });
});

describe("addEvent does not auto-add injected", () => {
  it("addEvent with memory_prefetch_result does NOT auto-add to injected", () => {
    useMemoryStore.getState().addEvent("sess-1", {
      id: "e1",
      customType: "memory_prefetch_result",
      data: { summary: "test", snippet: "snippet text" },
      timestamp: Date.now(),
    });

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.injectedBySession["sess-1"]).toBeUndefined();
  });
});

describe("multiple sessions coexist independently", () => {
  it("events/files/injected for session A do not leak to session B", async () => {
    useMemoryStore
      .getState()
      .addEvent("sess-a", { id: "ea", customType: "memory_extract", data: null, timestamp: 1 });
    useMemoryStore.getState().addInjected("sess-a", { summary: "a-only", snippet: "snip" });
    mockedCall.mockResolvedValueOnce({
      files: [
        {
          filename: "a.md",
          filePath: "/a.md",
          description: "a file",
          type: "user",
          mtimeMs: 1,
          size: 10,
        },
      ],
      entrypointContent: null,
    });
    await useMemoryStore.getState().loadFiles("/project-a", "sess-a");
    await new Promise((r) => setTimeout(r, 150));

    useMemoryStore
      .getState()
      .addEvent("sess-b", { id: "eb", customType: "memory_prefetch", data: null, timestamp: 2 });
    mockedCall.mockResolvedValueOnce({
      files: [
        {
          filename: "b.md",
          filePath: "/b.md",
          description: "b file",
          type: "feedback",
          mtimeMs: 2,
          size: 20,
        },
      ],
      entrypointContent: "entrypoint-b",
    });
    await useMemoryStore.getState().loadFiles("/project-b", "sess-b");
    await new Promise((r) => setTimeout(r, 150));

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-a"]).toHaveLength(1);
    expect(state.eventsBySession["sess-a"][0].id).toBe("ea");
    expect(state.eventsBySession["sess-b"]).toHaveLength(1);
    expect(state.eventsBySession["sess-b"][0].id).toBe("eb");

    expect(state.filesBySession["sess-a"]).toHaveLength(1);
    expect(state.filesBySession["sess-a"][0].filename).toBe("a.md");
    expect(state.filesBySession["sess-b"]).toHaveLength(1);
    expect(state.filesBySession["sess-b"][0].filename).toBe("b.md");

    expect(state.injectedBySession["sess-a"]).toHaveLength(1);
    expect(state.injectedBySession["sess-b"]).toBeUndefined();

    expect(state.entrypointBySession["sess-a"]).toBeNull();
    expect(state.entrypointBySession["sess-b"]).toBe("entrypoint-b");
  });
});

describe("loadFiles edge cases", () => {
  it("loadFiles with empty result", async () => {
    mockedCall.mockResolvedValueOnce({ files: [], entrypointContent: null });
    await useMemoryStore.getState().loadFiles("/project", "sess-1");
    await new Promise((r) => setTimeout(r, 150));

    const state = useMemoryStore.getState();
    expect(state.filesBySession["sess-1"]).toEqual([]);
    expect(state.entrypointBySession["sess-1"]).toBeNull();
  });

  it("loadFiles with entrypointContent", async () => {
    mockedCall.mockResolvedValueOnce({
      files: [],
      entrypointContent: "# Memory Index\n\nSome content here",
    });
    await useMemoryStore.getState().loadFiles("/project", "sess-1");
    await new Promise((r) => setTimeout(r, 150));

    const state = useMemoryStore.getState();
    expect(state.entrypointBySession["sess-1"]).toBe("# Memory Index\n\nSome content here");
  });
});

describe("collapsedSections default", () => {
  it("default starts with operations collapsed", () => {
    const state = useMemoryStore.getState();
    expect(state.collapsedSections.has("operations")).toBe(true);
    expect(state.collapsedSections.has("files")).toBe(false);
    expect(state.collapsedSections.has("injected")).toBe(false);
  });
});

describe("addEvent with large data", () => {
  it("handles very large data without crash", () => {
    const largeString = "x".repeat(10 * 1024);
    useMemoryStore.getState().addEvent("sess-1", {
      id: "e-large",
      customType: "memory_prefetch_result",
      data: { content: largeString },
      timestamp: Date.now(),
    });

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect((state.eventsBySession["sess-1"][0].data as { content: string }).content).toHaveLength(
      10 * 1024,
    );
  });
});

describe("toggleSection with multiple sections", () => {
  it("toggles files and injected independently", () => {
    useMemoryStore.getState().toggleSection("files");
    expect(useMemoryStore.getState().collapsedSections.has("files")).toBe(true);
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(true);

    useMemoryStore.getState().toggleSection("injected");
    expect(useMemoryStore.getState().collapsedSections.has("injected")).toBe(true);
    expect(useMemoryStore.getState().collapsedSections.has("files")).toBe(true);
    expect(useMemoryStore.getState().collapsedSections.has("operations")).toBe(true);

    useMemoryStore.getState().toggleSection("files");
    expect(useMemoryStore.getState().collapsedSections.has("files")).toBe(false);
    expect(useMemoryStore.getState().collapsedSections.has("injected")).toBe(true);
  });
});

describe("clearSession", () => {
  it("removes all data for a session", () => {
    useMemoryStore
      .getState()
      .addEvent("sess-1", { id: "e1", customType: "a", data: null, timestamp: 1 });
    useMemoryStore.getState().addInjected("sess-1", { summary: "s", snippet: "sn" });
    useMemoryStore.getState().loadFiles("/p", "sess-1");

    useMemoryStore.getState().clearSession("sess-1");

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toBeUndefined();
    expect(state.injectedBySession["sess-1"]).toBeUndefined();
  });

  it("does not affect other sessions", () => {
    useMemoryStore
      .getState()
      .addEvent("sess-1", { id: "e1", customType: "a", data: null, timestamp: 1 });
    useMemoryStore
      .getState()
      .addEvent("sess-2", { id: "e2", customType: "b", data: null, timestamp: 2 });
    useMemoryStore.getState().addInjected("sess-2", { summary: "s", snippet: "sn" });

    useMemoryStore.getState().clearSession("sess-1");

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toBeUndefined();
    expect(state.eventsBySession["sess-2"]).toHaveLength(1);
    expect(state.injectedBySession["sess-2"]).toHaveLength(1);
  });
});
