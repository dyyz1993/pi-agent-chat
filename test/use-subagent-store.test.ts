import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SubagentSessionInfo, ChatMessage } from "../src/mainview/types";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(() => ({ id: "msg-1", role: "user", content: [], timestamp: 0 })),
}));

vi.mock("../src/mainview/stores/message-batcher", () => ({
  batchMessageUpdate: vi.fn((_subId: string, apply: () => void) => apply()),
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      sessionStatusMap: {},
      sessionContextMap: {},
      updateSessionStatus: vi.fn(),
    })),
  },
}));

vi.mock("../../shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useSubagentStore } from "../src/mainview/stores/use-subagent-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;
const PARENT_PATH = "/sessions/parent-1.jsonl";

function makeSub(overrides: Partial<SubagentSessionInfo> = {}): SubagentSessionInfo {
  return {
    sessionId: "sub-1",
    sessionPath: "/sessions/sub-1.jsonl",
    description: "Test subagent",
    instruction: "Do something",
    startedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSubagentStore.setState({
    subsessionsByParent: {},
    activeSubsessionId: null,
    messagesBySubsession: {},
    loadingByParent: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  });
});

describe("useSubagentStore", () => {
  it("initial state: empty maps, null activeSubsessionId", () => {
    const s = useSubagentStore.getState();
    expect(s.subsessionsByParent).toEqual({});
    expect(s.activeSubsessionId).toBeNull();
    expect(s.messagesBySubsession).toEqual({});
    expect(s.loadingByParent).toEqual({});
    expect(s.subagentStatusMap).toEqual({});
    expect(s.subagentContextMap).toEqual({});
  });

  it("updateSubagentStatus sets status", () => {
    useSubagentStore.getState().updateSubagentStatus("sub-1", "streaming");
    expect(useSubagentStore.getState().subagentStatusMap["sub-1"]).toBe("streaming");
  });

  it("updateSubagentContext merges partial (and creates default if none)", () => {
    useSubagentStore.getState().updateSubagentContext("sub-1", { contextWindow: 128000 });
    expect(useSubagentStore.getState().subagentContextMap["sub-1"]).toEqual({
      tokens: null,
      contextWindow: 128000,
    });

    useSubagentStore.getState().updateSubagentContext("sub-1", { tokens: 5000 });
    expect(useSubagentStore.getState().subagentContextMap["sub-1"]).toEqual({
      tokens: 5000,
      contextWindow: 128000,
    });
  });

  it("loadSubsessions calls apiClient and populates subsessionsByParent", async () => {
    const subs = [makeSub()];
    mockCall.mockResolvedValue({ subsessions: subs });

    const result = await useSubagentStore.getState().loadSubsessions(PARENT_PATH);

    expect(mockCall).toHaveBeenCalledWith("subagent.listBySession", { sessionPath: PARENT_PATH });
    expect(result).toEqual(subs);
    expect(useSubagentStore.getState().subsessionsByParent[PARENT_PATH]).toEqual(subs);
    expect(useSubagentStore.getState().loadingByParent[PARENT_PATH]).toBe(false);
  });

  it("loadSubsessions returns cached if not forced", async () => {
    const cached = [makeSub()];
    useSubagentStore.setState({ subsessionsByParent: { [PARENT_PATH]: cached } });

    const result = await useSubagentStore.getState().loadSubsessions(PARENT_PATH, false);

    expect(mockCall).not.toHaveBeenCalled();
    expect(result).toEqual(cached);
  });

  it("loadSubsessions handles API error gracefully", async () => {
    mockCall.mockRejectedValue(new Error("network fail"));

    const result = await useSubagentStore.getState().loadSubsessions(PARENT_PATH);

    expect(result).toEqual([]);
    expect(useSubagentStore.getState().loadingByParent[PARENT_PATH]).toBe(false);
  });

  it("loadSubsessions prevents concurrent loads", async () => {
    useSubagentStore.setState({ loadingByParent: { [PARENT_PATH]: true } });

    const result = await useSubagentStore.getState().loadSubsessions(PARENT_PATH);

    expect(mockCall).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("setActiveSubsession sets activeSubsessionId", () => {
    useSubagentStore.getState().setActiveSubsession("parent-1", "sub-1");
    expect(useSubagentStore.getState().activeSubsessionId).toBe("sub-1");
  });

  it("setActiveSubsession triggers loadSubHistory when messages empty", async () => {
    const sub = makeSub({ sessionId: "sub-1", sessionPath: "/sessions/sub-1.jsonl" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub] },
      messagesBySubsession: {},
    });
    mockCall.mockResolvedValue({ entries: [] });

    useSubagentStore.getState().setActiveSubsession("parent-1", "sub-1");

    await vi.waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("session.getEntries", {
        sessionPath: "/sessions/sub-1.jsonl",
      });
    });
  });

  it("setSubMessages", () => {
    const msgs: ChatMessage[] = [{ id: "m1", role: "user", content: [], timestamp: 0 }];
    useSubagentStore.getState().setSubMessages("sub-1", msgs);
    expect(useSubagentStore.getState().messagesBySubsession["sub-1"]).toEqual(msgs);
  });

  it("upsertLiveSubagent inserts new subagent", () => {
    useSubagentStore.getState().upsertLiveSubagent(PARENT_PATH, "sub-new", {
      description: "New one",
    });

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs).toHaveLength(1);
    expect(subs[0].sessionId).toBe("sub-new");
    expect(subs[0].description).toBe("New one");
  });

  it("upsertLiveSubagent updates existing subagent", () => {
    const sub = makeSub({ sessionId: "sub-1", description: "Old" });
    useSubagentStore.setState({ subsessionsByParent: { [PARENT_PATH]: [sub] } });

    useSubagentStore.getState().upsertLiveSubagent(PARENT_PATH, "sub-1", {
      description: "Updated",
    });

    const subs = useSubagentStore.getState().subsessionsByParent[PARENT_PATH];
    expect(subs).toHaveLength(1);
    expect(subs[0].description).toBe("Updated");
    expect(subs[0].sessionId).toBe("sub-1");
  });

  it("renameSubagent updates description and calls apiClient", () => {
    const sub = makeSub({ sessionId: "sub-1", description: "Old" });
    useSubagentStore.setState({ subsessionsByParent: { [PARENT_PATH]: [sub] } });

    useSubagentStore.getState().renameSubagent(PARENT_PATH, "sub-1", "New Name");

    expect(useSubagentStore.getState().subsessionsByParent[PARENT_PATH][0].description).toBe(
      "New Name",
    );
    expect(mockCall).toHaveBeenCalledWith("subagent.rename", {
      parentSessionPath: PARENT_PATH,
      subSessionId: "sub-1",
      newDescription: "New Name",
    });
  });

  it("renameSubagent ignores empty/whitespace-only descriptions", () => {
    const sub = makeSub({ sessionId: "sub-1", description: "Original" });
    useSubagentStore.setState({ subsessionsByParent: { [PARENT_PATH]: [sub] } });

    useSubagentStore.getState().renameSubagent(PARENT_PATH, "sub-1", "   ");

    expect(useSubagentStore.getState().subsessionsByParent[PARENT_PATH][0].description).toBe(
      "Original",
    );
  });

  it("deleteSubagent removes from all maps and calls apiClient", () => {
    const sub1 = makeSub({ sessionId: "sub-1" });
    useSubagentStore.setState({
      subsessionsByParent: { [PARENT_PATH]: [sub1] },
      subagentStatusMap: { "sub-1": "streaming" },
      subagentContextMap: { "sub-1": { tokens: 100, contextWindow: 128000 } },
      messagesBySubsession: { "sub-1": [{ id: "m1", role: "user", content: [], timestamp: 0 }] },
      activeSubsessionId: "sub-1",
    });

    useSubagentStore.getState().deleteSubagent(PARENT_PATH, "sub-1");

    expect(useSubagentStore.getState().subsessionsByParent[PARENT_PATH]).toHaveLength(0);
    expect(useSubagentStore.getState().subagentStatusMap["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().subagentContextMap["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().messagesBySubsession["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().activeSubsessionId).toBeNull();
    expect(mockCall).toHaveBeenCalledWith("subagent.delete", {
      parentSessionPath: PARENT_PATH,
      subSessionId: "sub-1",
    });
  });
});
