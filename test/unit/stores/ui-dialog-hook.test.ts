import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn().mockResolvedValue({}) },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      sessionStatusMap: {},
      updateSessionStatus: vi.fn(),
    })),
  },
}));

import { useUIDialogStore, toolNameToMethod } from "../../../src/mainview/stores/use-ui-dialog-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    sessionId: "sess-1",
    method: "confirm" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIDialogStore.setState({
    pending: [],
    requestStates: new Map(),
    panelOpen: false,
  });
  (useSessionStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    sessionStatusMap: {},
    updateSessionStatus: vi.fn(),
  });
});

describe("useUIDialogStore", () => {
  it("initial state: empty pending, empty Map, panelOpen=false", () => {
    const s = useUIDialogStore.getState();
    expect(s.pending).toEqual([]);
    expect(s.requestStates).toBeInstanceOf(Map);
    expect(s.requestStates.size).toBe(0);
    expect(s.panelOpen).toBe(false);
  });

  it("registerUIRequest adds to pending", () => {
    const req = makeReq();
    useUIDialogStore.getState().registerUIRequest(req);
    expect(useUIDialogStore.getState().pending).toHaveLength(1);
    expect(useUIDialogStore.getState().pending[0].requestId).toBe("req-1");
    expect(useUIDialogStore.getState().requestStates.has("req-1")).toBe(true);
    expect(useUIDialogStore.getState().requestStates.get("req-1")?.status).toBe("pending");
  });

  it("registerUIRequest dedupes by requestId", () => {
    const req = makeReq();
    useUIDialogStore.getState().registerUIRequest(req);
    useUIDialogStore.getState().registerUIRequest(req);
    expect(useUIDialogStore.getState().pending).toHaveLength(1);
  });

  it("respondById calls apiClient.call, removes from pending, closes panel if last", () => {
    const req = makeReq();
    useUIDialogStore.getState().registerUIRequest(req);
    useUIDialogStore.getState().setPanelOpen(true);

    useUIDialogStore.getState().respondById("req-1", { confirmed: true });

    expect(mockCall).toHaveBeenCalledWith("agent.respondUI", {
      sessionId: "sess-1",
      requestId: "req-1",
      response: { confirmed: true },
    });
    expect(useUIDialogStore.getState().pending).toHaveLength(0);
    expect(useUIDialogStore.getState().requestStates.get("req-1")?.status).toBe("responded");
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });

  it("respondById on non-existent requestId is no-op", () => {
    useUIDialogStore.getState().respondById("nonexist", { confirmed: true });
    expect(mockCall).not.toHaveBeenCalled();
    expect(useUIDialogStore.getState().pending).toHaveLength(0);
  });

  it("dismissById calls apiClient.call with cancelled, removes from pending", () => {
    const req = makeReq();
    useUIDialogStore.getState().registerUIRequest(req);
    useUIDialogStore.getState().setPanelOpen(true);

    useUIDialogStore.getState().dismissById("req-1");

    expect(mockCall).toHaveBeenCalledWith("agent.respondUI", {
      sessionId: "sess-1",
      requestId: "req-1",
      response: { cancelled: true },
    });
    expect(useUIDialogStore.getState().pending).toHaveLength(0);
    expect(useUIDialogStore.getState().requestStates.get("req-1")?.status).toBe("dismissed");
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });

  it("dismissById on non-existent requestId is no-op", () => {
    useUIDialogStore.getState().dismissById("nonexist");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("setPanelOpen / togglePanel", () => {
    useUIDialogStore.getState().setPanelOpen(true);
    expect(useUIDialogStore.getState().panelOpen).toBe(true);
    useUIDialogStore.getState().setPanelOpen(false);
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
    useUIDialogStore.getState().togglePanel();
    expect(useUIDialogStore.getState().panelOpen).toBe(true);
    useUIDialogStore.getState().togglePanel();
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });

  it("toolNameToMethod: exact matches", () => {
    expect(toolNameToMethod("ask-confirm")).toBe("confirm");
    expect(toolNameToMethod("ask-select")).toBe("select");
    expect(toolNameToMethod("ask-input")).toBe("input");
    expect(toolNameToMethod("ask-editor")).toBe("editor");
    expect(toolNameToMethod("ask-multiselect")).toBe("select");
  });

  it("toolNameToMethod: fuzzy matches", () => {
    expect(toolNameToMethod("my-confirm-tool")).toBe("confirm");
    expect(toolNameToMethod("my-select-tool")).toBe("select");
    expect(toolNameToMethod("my-input-tool")).toBe("input");
    expect(toolNameToMethod("my-editor-tool")).toBe("editor");
  });

  it("toolNameToMethod: unknown returns undefined", () => {
    expect(toolNameToMethod("ask-unknown")).toBeUndefined();
    expect(toolNameToMethod("")).toBeUndefined();
    expect(toolNameToMethod("random-tool")).toBeUndefined();
  });

  it("panel stays open when multiple pending and one is dismissed", () => {
    const req1 = makeReq({ requestId: "req-1" });
    const req2 = makeReq({ requestId: "req-2" });
    useUIDialogStore.getState().registerUIRequest(req1);
    useUIDialogStore.getState().registerUIRequest(req2);
    useUIDialogStore.getState().setPanelOpen(true);

    useUIDialogStore.getState().dismissById("req-1");

    expect(useUIDialogStore.getState().pending).toHaveLength(1);
    expect(useUIDialogStore.getState().panelOpen).toBe(true);
  });
});
