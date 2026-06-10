import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BashProcess } from "../../../src/shared/modules/bash";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

import { useBashStore } from "../../../src/mainview/stores/use-bash-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockReset();
  useBashStore.setState({
    processesBySession: {},
    subscribedOutputs: new Set<string>(),
    backgroundedIds: new Set<string>(),
  });
});

function makeProc(overrides: Partial<BashProcess> = {}): BashProcess {
  return {
    toolCallId: "tc-1",
    command: "echo hi",
    cwd: "/tmp",
    startedAt: 1000,
    output: "",
    status: "running",
    ...overrides,
  };
}

describe("useBashStore", () => {
  const SID = "sess-1";

  it("initial state: processesBySession={}, subscribedOutputs=Set(), backgroundedIds=Set()", () => {
    const s = useBashStore.getState();
    expect(s.processesBySession).toEqual({});
    expect(s.subscribedOutputs).toBeInstanceOf(Set);
    expect(s.subscribedOutputs.size).toBe(0);
    expect(s.backgroundedIds).toBeInstanceOf(Set);
    expect(s.backgroundedIds.size).toBe(0);
  });

  it("upsertProcess adds new process", () => {
    useBashStore.getState().upsertProcess(SID, makeProc({ toolCallId: "tc-1" }));
    const procs = useBashStore.getState().processesBySession[SID];
    expect(procs).toHaveLength(1);
    expect(procs[0].toolCallId).toBe("tc-1");
  });

  it("upsertProcess with same toolCallId updates instead of appending", () => {
    useBashStore.getState().upsertProcess(SID, makeProc({ toolCallId: "tc-1", output: "old" }));
    useBashStore.getState().upsertProcess(SID, makeProc({ toolCallId: "tc-1", output: "new" }));
    const procs = useBashStore.getState().processesBySession[SID];
    expect(procs).toHaveLength(1);
    expect(procs[0].output).toBe("new");
  });

  it("removeProcess deletes the process", () => {
    useBashStore.getState().upsertProcess(SID, makeProc({ toolCallId: "tc-1" }));
    useBashStore.getState().removeProcess(SID, "tc-1");
    expect(useBashStore.getState().processesBySession[SID]).toHaveLength(0);
  });

  it("clearSession removes the entire session", () => {
    useBashStore.getState().upsertProcess(SID, makeProc());
    useBashStore.getState().clearSession(SID);
    expect(useBashStore.getState().processesBySession[SID]).toBeUndefined();
  });

  it("loadHistory success sets processes", async () => {
    const procs = [makeProc({ toolCallId: "tc-h1", status: "done" })];
    mockCall.mockResolvedValue({ processes: procs });
    await useBashStore.getState().loadHistory(SID);
    expect(mockCall).toHaveBeenCalledWith("bash.list", { sessionId: SID });
  });

  it("subscribeOutput adds toolCallId to subscribedOutputs", async () => {
    mockCall.mockResolvedValue({});
    await useBashStore.getState().subscribeOutput(SID, "tc-1");
    expect(useBashStore.getState().subscribedOutputs.has("tc-1")).toBe(true);
  });

  it("unsubscribeOutput removes toolCallId from subscribedOutputs", async () => {
    mockCall.mockResolvedValue({});
    await useBashStore.getState().subscribeOutput(SID, "tc-1");
    await useBashStore.getState().unsubscribeOutput(SID, "tc-1");
    expect(useBashStore.getState().subscribedOutputs.has("tc-1")).toBe(false);
  });

  it("markBackgrounded adds id to backgroundedIds", () => {
    useBashStore.getState().markBackgrounded("tc-1");
    expect(useBashStore.getState().backgroundedIds.has("tc-1")).toBe(true);
  });

  it("isBackgrounded returns correct boolean", () => {
    expect(useBashStore.getState().isBackgrounded("tc-1")).toBe(false);
    useBashStore.getState().markBackgrounded("tc-1");
    expect(useBashStore.getState().isBackgrounded("tc-1")).toBe(true);
  });
});
