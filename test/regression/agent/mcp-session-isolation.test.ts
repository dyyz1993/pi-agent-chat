/**
 * @vitest-environment node
 *
 * Regression: MCP server state must be isolated per session.
 *
 * Root cause: `useStatusStore.mcpServers` was a single global array.
 * `handleAgentEvent(sessionId, event)` discarded `sessionId` and wrote MCP
 * connection changes into that global array, so a background session's MCP
 * status bled into the active session's StatusPanel.
 *
 * Fix: `mcpServers` became `mcpServersBySession: Record<sessionId, MCPServerInfo[]>`.
 * The `mcp_connection_change` handler now keys its upsert by the sessionId
 * argument; `fetchInitialState` guards on active session before writing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result", "memory_inject"]),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        activeSessionId: "sess-a",
        sessionsByProject: {},
        addLog: vi.fn(),
        sessionStatusMap: {},
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        activeSessionId: "sess-a",
        sessionsByProject: {},
        addLog: vi.fn(),
        sessionStatusMap: {},
      }),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { activeSubsessionId: null };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSubsessionId: null }), setState: vi.fn() },
  ),
}));

vi.mock("../../../src/mainview/stores/use-session-queue-store", () => ({
  useSessionQueueStore: { getState: () => ({ setSessionQueue: vi.fn() }), setState: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: () => ({
      appendMessage: vi.fn(),
      updateStreamingMessage: vi.fn(),
      setMessages: vi.fn(),
      addToolExecBlock: vi.fn(),
      updateToolExecBlock: vi.fn(),
      messagesBySession: {},
      setMcpApprovalPending: vi.fn(),
      clearMcpApproval: vi.fn(),
    }),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../../../src/mainview/lib/message-batcher", () => ({
  flushNow: vi.fn(),
  enqueueMessage: vi.fn(),
}));

// useStatusStore uses the REAL implementation so we can assert on
// mcpServersBySession state after dispatching events.
import { useStatusStore } from "../../../src/mainview/stores/use-status-store";
import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";

const SESS_A = "sess-a";
const SESS_B = "sess-b";

function mcpEvent(
  name: string,
  status: "connecting" | "connected" | "error" | "disconnected",
  tools: Array<{ originalName: string; fullName: string; description: string }> = [],
) {
  return {
    type: "mcp_connection_change" as const,
    name,
    status,
    tools,
  };
}

describe("MCP session isolation (regression)", () => {
  beforeEach(() => {
    useStatusStore.setState({ mcpServersBySession: {} });
  });

  it("mcp_connection_change from session A does not pollute session B's slot", () => {
    handleAgentEvent(SESS_A, mcpEvent("filesystem", "connected", [
      { originalName: "read", fullName: "filesystem__read", description: "read" },
    ]));

    expect(useStatusStore.getState().mcpServersBySession[SESS_A]?.map((s) => s.name)).toEqual([
      "filesystem",
    ]);
    // B must be untouched.
    expect(useStatusStore.getState().mcpServersBySession[SESS_B]).toBeUndefined();
  });

  it("two sessions with same server name stay isolated", () => {
    handleAgentEvent(SESS_A, mcpEvent("shared", "connected"));
    handleAgentEvent(SESS_B, mcpEvent("shared", "error", []));

    expect(useStatusStore.getState().mcpServersBySession[SESS_A]?.[0].status).toBe("connected");
    expect(useStatusStore.getState().mcpServersBySession[SESS_B]?.[0].status).toBe("error");
  });

  it("upsert within a session preserves scope/disabled from prior setMcpServers", () => {
    useStatusStore.getState().setMcpServers(SESS_A, [
      {
        name: "github",
        status: "connecting",
        toolCount: 0,
        tools: [],
        scope: "project",
        disabled: true,
      },
    ]);

    handleAgentEvent(SESS_A, mcpEvent("github", "connected", [
      { originalName: "repo", fullName: "github__repo", description: "repo" },
    ]));

    const slot = useStatusStore.getState().mcpServersBySession[SESS_A];
    expect(slot?.[0].status).toBe("connected");
    expect(slot?.[0].scope).toBe("project"); // preserved
    expect(slot?.[0].disabled).toBe(true); // preserved
    expect(slot?.[0].toolCount).toBe(1); // updated from event tools
  });

  it("clearMcpSession only removes the target slot", () => {
    useStatusStore.getState().setMcpServers(SESS_A, [
      { name: "a", status: "connected", toolCount: 0, tools: [], scope: "project" },
    ]);
    useStatusStore.getState().setMcpServers(SESS_B, [
      { name: "b", status: "connected", toolCount: 0, tools: [], scope: "global" },
    ]);

    useStatusStore.getState().clearMcpSession(SESS_A);

    expect(useStatusStore.getState().mcpServersBySession[SESS_A]).toBeUndefined();
    expect(useStatusStore.getState().mcpServersBySession[SESS_B]).toBeDefined();
  });
});
