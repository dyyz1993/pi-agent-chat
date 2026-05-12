import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
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

  it("addEvent deduplicates by customType+timestamp", () => {
    useMemoryStore.getState().addEvent(SID, {
      id: "e1",
      customType: "type-a",
      data: {},
      timestamp: 1000,
    });
    useMemoryStore.getState().addEvent(SID, {
      id: "e2",
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

    expect(useMemoryStore.getState().filesBySession[SID]).toEqual(files);
    expect(useMemoryStore.getState().entrypointBySession[SID]).toBe("entry");
  });

  it("loadFiles failure does not crash", async () => {
    mockCall.mockRejectedValue(new Error("fail"));
    await expect(useMemoryStore.getState().loadFiles("/project", SID)).resolves.toBeUndefined();
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
