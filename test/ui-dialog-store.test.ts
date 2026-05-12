import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      sessionStatusMap: {},
      updateSessionStatus: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

import { useUIDialogStore, toolNameToMethod } from "../src/mainview/stores/use-ui-dialog-store";
import { apiClient } from "../src/mainview/lib/api-client";
import { useSessionStore } from "../src/mainview/stores/use-session-store";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;
const mockedSessionGetState = useSessionStore.getState as ReturnType<typeof vi.fn>;

interface MakeRequestOverrides {
  requestId?: string;
  sessionId?: string;
  method?: "confirm" | "input" | "select" | "editor";
  message?: string;
  title?: string;
  options?: string[];
  multiple?: boolean;
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

function makeRequest(overrides: MakeRequestOverrides = {}) {
  return {
    requestId: `req-${Date.now()}`,
    sessionId: "sess-1",
    method: "confirm" as const,
    message: "Are you sure?",
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
  mockedSessionGetState.mockReturnValue({
    sessionStatusMap: {},
    updateSessionStatus: vi.fn(),
  } as ReturnType<typeof useSessionStore.getState>);
});

describe("registerUIRequest", () => {
  it("registers a new pending request", () => {
    const req = makeRequest();
    useUIDialogStore.getState().registerUIRequest(req);

    const state = useUIDialogStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].requestId).toBe(req.requestId);
    expect(state.requestStates.get(req.requestId)?.status).toBe("pending");
  });

  it("ignores duplicate requestId", () => {
    const req = makeRequest({ requestId: "dup-1" });
    useUIDialogStore.getState().registerUIRequest(req);
    useUIDialogStore.getState().registerUIRequest(req);

    expect(useUIDialogStore.getState().pending).toHaveLength(1);
  });

  it("registers multiple different requests", () => {
    useUIDialogStore.getState().registerUIRequest(makeRequest({ requestId: "r1" }));
    useUIDialogStore.getState().registerUIRequest(makeRequest({ requestId: "r2" }));

    expect(useUIDialogStore.getState().pending).toHaveLength(2);
  });
});

describe("respondById", () => {
  it("removes from pending, updates state to responded, calls API", () => {
    const req = makeRequest({ requestId: "r1" });
    useUIDialogStore.getState().registerUIRequest(req);

    useUIDialogStore.getState().respondById("r1", { confirmed: true });

    const state = useUIDialogStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.requestStates.get("r1")?.status).toBe("responded");
    expect(state.requestStates.get("r1")?.response).toEqual({ confirmed: true });
    expect(mockedCall).toHaveBeenCalledWith("agent.respondUI", {
      sessionId: "sess-1",
      requestId: "r1",
      response: { confirmed: true },
    });
  });

  it("is a no-op for non-existent requestId", () => {
    useUIDialogStore.getState().respondById("nonexistent", { confirmed: true });
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("closes panel when last pending request is responded", () => {
    useUIDialogStore.setState({ panelOpen: true });
    useUIDialogStore.getState().registerUIRequest(makeRequest({ requestId: "r1" }));

    useUIDialogStore.getState().respondById("r1", { confirmed: true });

    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });

  it("keeps panel open when other requests remain", () => {
    useUIDialogStore.setState({ panelOpen: true });
    useUIDialogStore.getState().registerUIRequest(makeRequest({ requestId: "r1" }));
    useUIDialogStore.getState().registerUIRequest(makeRequest({ requestId: "r2" }));

    useUIDialogStore.getState().respondById("r1", { confirmed: true });

    expect(useUIDialogStore.getState().panelOpen).toBe(true);
  });
});

describe("dismissById", () => {
  it("removes from pending, updates state to dismissed, calls API with cancelled", () => {
    const req = makeRequest({ requestId: "r1" });
    useUIDialogStore.getState().registerUIRequest(req);

    useUIDialogStore.getState().dismissById("r1");

    const state = useUIDialogStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.requestStates.get("r1")?.status).toBe("dismissed");
    expect(state.requestStates.get("r1")?.response).toEqual({ cancelled: true });
    expect(mockedCall).toHaveBeenCalledWith("agent.respondUI", {
      sessionId: "sess-1",
      requestId: "r1",
      response: { cancelled: true },
    });
  });

  it("is a no-op for non-existent requestId", () => {
    useUIDialogStore.getState().dismissById("nonexistent");
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe("setPanelOpen / togglePanel", () => {
  it("sets panel open state", () => {
    useUIDialogStore.getState().setPanelOpen(true);
    expect(useUIDialogStore.getState().panelOpen).toBe(true);
    useUIDialogStore.getState().setPanelOpen(false);
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });

  it("toggles panel state", () => {
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
    useUIDialogStore.getState().togglePanel();
    expect(useUIDialogStore.getState().panelOpen).toBe(true);
    useUIDialogStore.getState().togglePanel();
    expect(useUIDialogStore.getState().panelOpen).toBe(false);
  });
});

describe("checkPermissionClear", () => {
  it("updates session status from permission to streaming when no remaining requests", () => {
    const mockUpdateStatus = vi.fn();
    mockedSessionGetState.mockReturnValue({
      sessionStatusMap: { "sess-1": "permission" },
      updateSessionStatus: mockUpdateStatus,
    } as unknown as ReturnType<typeof useSessionStore.getState>);

    const req = makeRequest({ requestId: "r1", sessionId: "sess-1" });
    useUIDialogStore.getState().registerUIRequest(req);

    useUIDialogStore.getState().respondById("r1", { confirmed: true });

    expect(mockUpdateStatus).toHaveBeenCalledWith("sess-1", "streaming");
  });

  it("does not update status when other pending requests remain for same session", () => {
    const mockUpdateStatus = vi.fn();
    mockedSessionGetState.mockReturnValue({
      sessionStatusMap: { "sess-1": "permission" },
      updateSessionStatus: mockUpdateStatus,
    } as unknown as ReturnType<typeof useSessionStore.getState>);

    useUIDialogStore
      .getState()
      .registerUIRequest(makeRequest({ requestId: "r1", sessionId: "sess-1" }));
    useUIDialogStore
      .getState()
      .registerUIRequest(makeRequest({ requestId: "r2", sessionId: "sess-1" }));

    useUIDialogStore.getState().respondById("r1", { confirmed: true });

    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});

describe("toolNameToMethod", () => {
  it("maps known tool names to methods", () => {
    expect(toolNameToMethod("ask-confirm")).toBe("confirm");
    expect(toolNameToMethod("ask-select")).toBe("select");
    expect(toolNameToMethod("ask-input")).toBe("input");
    expect(toolNameToMethod("ask-editor")).toBe("editor");
    expect(toolNameToMethod("ask-multiselect")).toBe("select");
  });

  it("returns undefined for unknown tool names", () => {
    expect(toolNameToMethod("unknown-tool")).toBeUndefined();
  });

  it("handles case-insensitive matching", () => {
    expect(toolNameToMethod("Ask-Confirm")).toBe("confirm");
  });
});
