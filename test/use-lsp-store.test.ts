import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LspChannelEvent } from "../src/shared/modules/lsp";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn().mockResolvedValue({}) },
}));

import { useLspStore } from "../src/mainview/stores/use-lsp-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

function makeEvent(overrides: Partial<LspChannelEvent> = {}): LspChannelEvent {
  return {
    event: "status_changed",
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useLspStore.setState({ statusBySession: {} });
});

describe("useLspStore", () => {
  const SID = "sess-1";

  it("initial state: empty statusBySession", () => {
    expect(useLspStore.getState().statusBySession).toEqual({});
  });

  it("updateStatus creates new session status with defaults", () => {
    useLspStore.getState().updateStatus(SID, { state: "starting" });
    const status = useLspStore.getState().statusBySession[SID];
    expect(status.state).toBe("starting");
    expect(status.servers).toEqual([]);
    expect(status.mode).toBe("agent_end");
    expect(status.startupLog).toEqual([]);
    expect(status.activeLanguages).toEqual([]);
  });

  it("updateStatus merges partial into existing", () => {
    useLspStore.getState().updateStatus(SID, { state: "starting" });
    useLspStore.getState().updateStatus(SID, { mode: "edit_write" });
    const status = useLspStore.getState().statusBySession[SID];
    expect(status.state).toBe("starting");
    expect(status.mode).toBe("edit_write");
  });

  it("handleLspEvent: startup_begin sets starting state and startupLog", () => {
    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "startup_begin",
        timestamp: 1000,
        totalServers: 2,
        servers: [
          { name: "typescript", fileTypes: [".ts"], state: "starting" },
          { name: "python", fileTypes: [".py"], state: "starting" },
        ],
      }),
    );

    const status = useLspStore.getState().statusBySession[SID];
    expect(status.state).toBe("starting");
    expect(status.startupLog).toHaveLength(2);
    expect(status.startupLog[0].name).toBe("typescript");
    expect(status.startupLog[0].state).toBe("starting");
    expect(status.totalServers).toBe(2);
    expect(status.startupComplete).toBe(false);
  });

  it("handleLspEvent: server_ready updates server state to ready", () => {
    useLspStore.getState().updateStatus(SID, {
      state: "starting",
      servers: [{ name: "typescript", state: "starting", reason: "" }],
      startupLog: [{ name: "typescript", state: "starting", timestamp: 1000 }],
      mode: "agent_end",
      activeLanguages: [],
    });

    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "server_ready",
        serverName: "typescript",
        timestamp: 2000,
        servers: [{ name: "typescript", fileTypes: [".ts"], state: "ready" }],
      }),
    );

    const status = useLspStore.getState().statusBySession[SID];
    expect(status.servers[0].state).toBe("ready");
    expect(status.state).toBe("ready");
    const logEntry = status.startupLog.find((l) => l.name === "typescript");
    expect(logEntry?.state).toBe("ready");
  });

  it("handleLspEvent: server_error updates server state to error", () => {
    useLspStore.getState().updateStatus(SID, {
      state: "starting",
      servers: [{ name: "go", state: "starting", reason: "" }],
      startupLog: [{ name: "go", state: "starting", timestamp: 1000 }],
      mode: "agent_end",
      activeLanguages: [],
    });

    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "server_error",
        serverName: "go",
        timestamp: 2000,
        servers: [{ name: "go", state: "error", status: { reason: "crashed" } }],
      }),
    );

    const status = useLspStore.getState().statusBySession[SID];
    expect(status.servers[0].state).toBe("error");
    expect(status.state).toBe("error");
  });

  it("handleLspEvent: startup_complete sets startupComplete=true, derives activeLanguages", () => {
    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "startup_complete",
        timestamp: 3000,
        servers: [
          { name: "typescript", fileTypes: [".ts", ".tsx"], state: "ready" },
          { name: "python", fileTypes: [".py"], state: "ready" },
        ],
      }),
    );

    const status = useLspStore.getState().statusBySession[SID];
    expect(status.startupComplete).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.activeLanguages).toEqual(expect.arrayContaining([".ts", ".tsx", ".py"]));
    expect(status.startupLog).toEqual([]);
  });

  it("handleLspEvent: mode_changed updates mode", () => {
    useLspStore
      .getState()
      .updateStatus(SID, {
        state: "ready",
        mode: "agent_end",
        servers: [],
        startupLog: [],
        activeLanguages: [],
      });

    useLspStore
      .getState()
      .handleLspEvent(SID, makeEvent({ event: "mode_changed", mode: "edit_write" }));

    expect(useLspStore.getState().statusBySession[SID].mode).toBe("edit_write");
  });

  it("handleLspEvent: diagnostics_update sets lastDiagnostics", () => {
    useLspStore
      .getState()
      .updateStatus(SID, {
        state: "ready",
        mode: "agent_end",
        servers: [],
        startupLog: [],
        activeLanguages: [],
      });

    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "diagnostics_update",
        filePath: "/src/foo.ts",
        timestamp: 5000,
        diagnostics: [{ message: "err" }],
      }),
    );

    const diag = useLspStore.getState().statusBySession[SID].lastDiagnostics;
    expect(diag).toEqual({ filePath: "/src/foo.ts", count: 1, timestamp: 5000 });
  });

  it("handleLspEvent: error sets state to error", () => {
    useLspStore
      .getState()
      .updateStatus(SID, {
        state: "starting",
        mode: "agent_end",
        servers: [],
        startupLog: [],
        activeLanguages: [],
      });

    useLspStore.getState().handleLspEvent(SID, makeEvent({ event: "error", timestamp: 9999 }));

    expect(useLspStore.getState().statusBySession[SID].state).toBe("error");
    expect(useLspStore.getState().statusBySession[SID].startupComplete).toBe(true);
  });

  it("handleLspEvent: language_activated adds to activeLanguages", () => {
    useLspStore.getState().updateStatus(SID, {
      state: "ready",
      servers: [{ name: "rust", state: "starting", reason: "" }],
      mode: "agent_end",
      startupLog: [],
      activeLanguages: [".rs"],
    });

    useLspStore.getState().handleLspEvent(
      SID,
      makeEvent({
        event: "language_activated",
        languages: [".rs", ".toml"],
        serverName: "rust",
        timestamp: 6000,
      }),
    );

    const status = useLspStore.getState().statusBySession[SID];
    expect(status.activeLanguages).toEqual(expect.arrayContaining([".rs", ".toml"]));
  });

  it("loadHistory calls apiClient and populates status", async () => {
    mockCall.mockResolvedValue({
      state: "ready",
      servers: [{ name: "ts", state: "ready", fileTypes: [".ts"], reason: "" }],
      mode: "edit_write",
    });

    await useLspStore.getState().loadHistory("/sessions/s1.jsonl", SID);

    expect(mockCall).toHaveBeenCalledWith("lsp.status", {
      sessionPath: "/sessions/s1.jsonl",
      sessionId: SID,
    });
    const status = useLspStore.getState().statusBySession[SID];
    expect(status.state).toBe("ready");
    expect(status.servers).toHaveLength(1);
    expect(status.mode).toBe("edit_write");
    expect(status.startupComplete).toBe(true);
    expect(status.activeLanguages).toEqual([".ts"]);
  });

  it("loadHistory skips if already loaded", async () => {
    useLspStore.setState({
      statusBySession: {
        [SID]: {
          state: "ready",
          servers: [],
          mode: "agent_end",
          startupLog: [],
          activeLanguages: [],
          startupComplete: true,
        },
      },
    });

    await useLspStore.getState().loadHistory("/sessions/s1.jsonl", SID);

    expect(mockCall).not.toHaveBeenCalled();
  });

  it("clearSession removes from map", () => {
    useLspStore
      .getState()
      .updateStatus(SID, {
        state: "ready",
        servers: [],
        mode: "agent_end",
        startupLog: [],
        activeLanguages: [],
      });
    expect(useLspStore.getState().statusBySession[SID]).toBeDefined();

    useLspStore.getState().clearSession(SID);
    expect(useLspStore.getState().statusBySession[SID]).toBeUndefined();
  });

  it("setMode updates local state + calls apiClient", () => {
    useLspStore
      .getState()
      .updateStatus(SID, {
        state: "ready",
        servers: [],
        mode: "agent_end",
        startupLog: [],
        activeLanguages: [],
      });

    useLspStore.getState().setMode(SID, "disabled");

    expect(useLspStore.getState().statusBySession[SID].mode).toBe("disabled");
    expect(mockCall).toHaveBeenCalledWith("lsp.setMode", { sessionId: SID, mode: "disabled" });
  });
});
