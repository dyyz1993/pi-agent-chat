import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

import {
  useBashStore,
  handleBashEvent,
  handleBackgroundExit,
} from "../src/mainview/stores/use-bash-store";
import type { BashProcess, BashChannelEvent } from "../src/shared/modules/bash";

const SID = "sess-1";
const TCID = "tc-1";

function makeProcess(overrides: Partial<BashProcess> = {}): BashProcess {
  return {
    toolCallId: TCID,
    command: "echo hello",
    cwd: "/tmp",
    pid: 1234,
    startedAt: 1000,
    output: "",
    status: "running",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<BashChannelEvent> = {}): BashChannelEvent {
  return {
    type: "output",
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useBashStore.setState({
    processesBySession: {},
    subscribedOutputs: new Set(),
  });
});

describe("handleBashEvent", () => {
  describe("start event", () => {
    it("adds a new process to the store", () => {
      const proc = makeProcess({ status: "running" });
      handleBashEvent(
        SID,
        makeEvent({
          type: "start",
          toolCallId: TCID,
          processes: [proc],
        }),
      );

      const procs = useBashStore.getState().processesBySession[SID];
      expect(procs).toHaveLength(1);
      expect(procs[0].toolCallId).toBe(TCID);
      expect(procs[0].status).toBe("running");
    });

    it("ignores start event when toolCallId does not match any process", () => {
      handleBashEvent(
        SID,
        makeEvent({
          type: "start",
          toolCallId: "nonexistent",
          processes: [makeProcess()],
        }),
      );

      expect(useBashStore.getState().processesBySession[SID]).toBeUndefined();
    });
  });

  describe("background event", () => {
    it("updates process status to background", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running" }));

      handleBashEvent(
        SID,
        makeEvent({
          type: "background",
          toolCallId: TCID,
          processes: [makeProcess({ status: "background", pid: 1234 })],
        }),
      );

      const proc = useBashStore
        .getState()
        .processesBySession[SID].find((p) => p.toolCallId === TCID);
      expect(proc?.status).toBe("background");
    });
  });

  describe("terminated event", () => {
    it("updates process status to terminated", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running" }));

      handleBashEvent(
        SID,
        makeEvent({
          type: "terminated",
          toolCallId: TCID,
          processes: [makeProcess({ status: "terminated" })],
        }),
      );

      const proc = useBashStore
        .getState()
        .processesBySession[SID].find((p) => p.toolCallId === TCID);
      expect(proc?.status).toBe("terminated");
    });
  });

  describe("list event", () => {
    it("replaces all processes for the session", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "old-1" }));

      const newList: BashProcess[] = [
        makeProcess({ toolCallId: "new-1", command: "ls" }),
        { ...makeProcess(), toolCallId: "new-2", command: "pwd" },
      ];

      handleBashEvent(
        SID,
        makeEvent({
          type: "list",
          processes: newList,
        }),
      );

      const procs = useBashStore.getState().processesBySession[SID];
      expect(procs).toHaveLength(2);
      expect(procs[0].toolCallId).toBe("new-1");
      expect(procs[1].toolCallId).toBe("new-2");
    });

    it("ignores list event without processes", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess());

      handleBashEvent(SID, makeEvent({ type: "list" }));

      expect(useBashStore.getState().processesBySession[SID]).toHaveLength(1);
    });
  });

  describe("output event", () => {
    it("updates process with new output", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ output: "first" }));

      handleBashEvent(
        SID,
        makeEvent({
          type: "output",
          toolCallId: TCID,
          processes: [makeProcess({ output: "first\nsecond" })],
        }),
      );

      const proc = useBashStore
        .getState()
        .processesBySession[SID].find((p) => p.toolCallId === TCID);
      expect(proc?.output).toBe("first\nsecond");
    });
  });

  describe("end event", () => {
    it("updates process status to done", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running" }));

      handleBashEvent(
        SID,
        makeEvent({
          type: "end",
          toolCallId: TCID,
          processes: [makeProcess({ status: "done", exitCode: 0 })],
        }),
      );

      const proc = useBashStore
        .getState()
        .processesBySession[SID].find((p) => p.toolCallId === TCID);
      expect(proc?.status).toBe("done");
      expect(proc?.exitCode).toBe(0);
    });
  });

  describe("error event", () => {
    it("updates process status to error", () => {
      useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running" }));

      handleBashEvent(
        SID,
        makeEvent({
          type: "error",
          toolCallId: TCID,
          processes: [makeProcess({ status: "error", exitCode: 1, error: "boom" })],
        }),
      );

      const proc = useBashStore
        .getState()
        .processesBySession[SID].find((p) => p.toolCallId === TCID);
      expect(proc?.status).toBe("error");
      expect(proc?.error).toBe("boom");
    });
  });
});

describe("removeProcess", () => {
  it("removes the process from the session", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "a" }));
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "b" }));

    useBashStore.getState().removeProcess(SID, "a");

    const procs = useBashStore.getState().processesBySession[SID];
    expect(procs).toHaveLength(1);
    expect(procs[0].toolCallId).toBe("b");
  });

  it("is a no-op when process does not exist", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess());

    useBashStore.getState().removeProcess(SID, "nonexistent");

    expect(useBashStore.getState().processesBySession[SID]).toHaveLength(1);
  });

  it("does not affect other sessions", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "a" }));
    useBashStore.getState().upsertProcess("sess-2", makeProcess({ toolCallId: "b" }));

    useBashStore.getState().removeProcess(SID, "a");

    expect(useBashStore.getState().processesBySession[SID]).toHaveLength(0);
    expect(useBashStore.getState().processesBySession["sess-2"]).toHaveLength(1);
  });
});

describe("clearSession", () => {
  it("removes all processes for a session", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "a" }));
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "b" }));
    useBashStore.getState().upsertProcess("sess-2", makeProcess({ toolCallId: "c" }));

    useBashStore.getState().clearSession(SID);

    expect(useBashStore.getState().processesBySession[SID]).toBeUndefined();
    expect(useBashStore.getState().processesBySession["sess-2"]).toHaveLength(1);
  });
});

describe("upsertProcess", () => {
  it("inserts a new process when it does not exist", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess());

    const procs = useBashStore.getState().processesBySession[SID];
    expect(procs).toHaveLength(1);
    expect(procs[0].toolCallId).toBe(TCID);
  });

  it("updates an existing process with same toolCallId", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running", output: "" }));
    useBashStore
      .getState()
      .upsertProcess(SID, makeProcess({ status: "done", output: "hello", exitCode: 0 }));

    const procs = useBashStore.getState().processesBySession[SID];
    expect(procs).toHaveLength(1);
    expect(procs[0].status).toBe("done");
    expect(procs[0].output).toBe("hello");
  });

  it("appends a second process with different toolCallId", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "a" }));
    useBashStore.getState().upsertProcess(SID, makeProcess({ toolCallId: "b" }));

    expect(useBashStore.getState().processesBySession[SID]).toHaveLength(2);
  });
});

describe("BashRenderer state merge logic", () => {
  function computeEffectiveState(
    blockStatus: string,
    bashProcessStatus?: string,
    details?: { background?: unknown; terminated?: unknown },
  ) {
    const storeStatus = bashProcessStatus;
    const isBackground = !!details?.background || storeStatus === "background";
    const isTerminated = !!details?.terminated || storeStatus === "terminated";
    const isRunning = blockStatus === "running" && !isBackground && !isTerminated;
    return { isBackground, isTerminated, isRunning };
  }

  it("block running + store background → isBackground=true, isRunning=false", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ status: "background" }));

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("background");

    const state = computeEffectiveState("running", proc?.status);
    expect(state.isBackground).toBe(true);
    expect(state.isRunning).toBe(false);
    expect(state.isTerminated).toBe(false);
  });

  it("block running + store terminated → isTerminated=true, isRunning=false", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ status: "terminated" }));

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("terminated");

    const state = computeEffectiveState("running", proc?.status);
    expect(state.isTerminated).toBe(true);
    expect(state.isRunning).toBe(false);
    expect(state.isBackground).toBe(false);
  });

  it("block running + no store process → isRunning=true", () => {
    const state = computeEffectiveState("running", undefined);
    expect(state.isRunning).toBe(true);
    expect(state.isBackground).toBe(false);
    expect(state.isTerminated).toBe(false);
  });

  it("block running + store running → isRunning=true", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ status: "running" }));

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    const state = computeEffectiveState("running", proc?.status);
    expect(state.isRunning).toBe(true);
    expect(state.isBackground).toBe(false);
    expect(state.isTerminated).toBe(false);
  });

  it("block done + store background → isBackground=true (details not needed)", () => {
    useBashStore.getState().upsertProcess(SID, makeProcess({ status: "background" }));

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    const state = computeEffectiveState("done", proc?.status);
    expect(state.isBackground).toBe(true);
    expect(state.isRunning).toBe(false);
  });

  it("details.background flag overrides store status", () => {
    const state = computeEffectiveState("running", undefined, { background: { pid: 1 } });
    expect(state.isBackground).toBe(true);
    expect(state.isRunning).toBe(false);
  });

  it("details.terminated flag overrides store status", () => {
    const state = computeEffectiveState("running", undefined, { terminated: { pid: 1 } });
    expect(state.isTerminated).toBe(true);
    expect(state.isRunning).toBe(false);
  });

  it("block error status is not affected by store", () => {
    const state = computeEffectiveState("error", "background");
    expect(state.isBackground).toBe(true);
    expect(state.isRunning).toBe(false);
  });
});

describe("handleBackgroundExit", () => {
  it("updates matching background process to done with exitCode 0", () => {
    const startedAt = 10000;
    useBashStore.getState().upsertProcess(
      SID,
      makeProcess({
        status: "background",
        command: "sleep 10",
        startedAt,
      }),
    );

    handleBackgroundExit(SID, {
      customType: "bash_background_exit",
      content: "",
      details: {
        command: "sleep 10",
        exitCode: 0,
        startedAt,
        endedAt: 20000,
        durationMs: 10000,
        logPath: "/tmp/sleep.log",
      },
      display: "info",
    });

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("done");
    expect(proc?.exitCode).toBe(0);
    expect(proc?.endedAt).toBe(20000);
    expect(proc?.logPath).toBe("/tmp/sleep.log");
  });

  it("updates matching background process to error with non-zero exitCode", () => {
    const startedAt = 10000;
    useBashStore.getState().upsertProcess(
      SID,
      makeProcess({
        status: "background",
        command: "fail_cmd",
        startedAt,
      }),
    );

    handleBackgroundExit(SID, {
      customType: "bash_background_exit",
      content: "Error: something failed",
      details: {
        command: "fail_cmd",
        exitCode: 1,
        startedAt,
        endedAt: 15000,
        durationMs: 5000,
      },
      display: "warning",
    });

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("error");
    expect(proc?.exitCode).toBe(1);
    expect(proc?.error).toBe("Error: something failed");
  });

  it("does nothing when no matching process found", () => {
    useBashStore.getState().upsertProcess(
      SID,
      makeProcess({
        status: "running",
        command: "echo hello",
      }),
    );

    handleBackgroundExit(SID, {
      customType: "bash_background_exit",
      content: "",
      details: {
        command: "different_command",
        exitCode: 0,
        startedAt: 1000,
        endedAt: 2000,
        durationMs: 1000,
      },
      display: "info",
    });

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("running");
  });

  it("matches process within 5s startedAt tolerance", () => {
    useBashStore.getState().upsertProcess(
      SID,
      makeProcess({
        status: "background",
        command: "tolerance_test",
        startedAt: 10000,
      }),
    );

    handleBackgroundExit(SID, {
      customType: "bash_background_exit",
      content: "",
      details: {
        command: "tolerance_test",
        exitCode: 0,
        startedAt: 13000,
        endedAt: 20000,
        durationMs: 7000,
      },
      display: "info",
    });

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("done");
  });

  it("does not match when startedAt differs by more than 5s", () => {
    useBashStore.getState().upsertProcess(
      SID,
      makeProcess({
        status: "background",
        command: "tolerance_test",
        startedAt: 10000,
      }),
    );

    handleBackgroundExit(SID, {
      customType: "bash_background_exit",
      content: "",
      details: {
        command: "tolerance_test",
        exitCode: 0,
        startedAt: 16000,
        endedAt: 20000,
        durationMs: 4000,
      },
      display: "info",
    });

    const proc = useBashStore
      .getState()
      .processesBySession[SID]?.find((p) => p.toolCallId === TCID);
    expect(proc?.status).toBe("background");
  });
});

describe("session isolation", () => {
  it("processes in different sessions do not interfere", () => {
    useBashStore
      .getState()
      .upsertProcess("sess-a", makeProcess({ toolCallId: "a", status: "running" }));
    useBashStore
      .getState()
      .upsertProcess("sess-b", makeProcess({ toolCallId: "b", status: "running" }));

    handleBashEvent(
      "sess-a",
      makeEvent({
        type: "background",
        toolCallId: "a",
        processes: [makeProcess({ toolCallId: "a", status: "background" })],
      }),
    );

    expect(useBashStore.getState().processesBySession["sess-a"][0].status).toBe("background");
    expect(useBashStore.getState().processesBySession["sess-b"][0].status).toBe("running");
  });
});
