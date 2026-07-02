/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  abortRetryOperation,
  clearQueueOperation,
  getActiveToolsOperation,
  getContextUsageOperation,
  getMcpServersOperation,
  getQueueOperation,
  restartMcpServerOperation,
  setActiveToolsOperation,
  setAutoRetryOperation,
  setPermissionModeOperation,
  toggleMcpServerOperation,
} from "../../../src/shared/agent/agent-client-session-operations";

function makeManaged(client: Record<string, unknown>, info: Record<string, unknown> = {}) {
  return { client, info };
}

describe("agent client session operations", () => {
  it("forwards retry, permission, tools, and queue calls", async () => {
    const client = {
      setAutoRetry: vi.fn().mockResolvedValue(undefined),
      abortRetry: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue({ mode: "default" }),
      getActiveTools: vi.fn().mockResolvedValue(["read", "write"]),
      setActiveTools: vi.fn().mockResolvedValue(undefined),
      getQueue: vi.fn().mockResolvedValue({ steering: ["s"], followUp: ["f"] }),
      clearQueue: vi.fn().mockResolvedValue({ steering: [], followUp: [] }),
    };
    const managed = makeManaged(client);
    const getActiveManaged = () => managed;
    const ensureManagedClient = vi.fn().mockResolvedValue(managed);

    await setAutoRetryOperation({ sessionId: "sess-1", enabled: true, getActiveManaged });
    await abortRetryOperation({ sessionId: "sess-1", getActiveManaged });
    await expect(
      setPermissionModeOperation({
        sessionId: "sess-1",
        mode: "default",
        getActiveManaged,
        ensureManagedClient,
      }),
    ).resolves.toEqual({ mode: "default" });
    await expect(
      getActiveToolsOperation({ sessionId: "sess-1", getActiveManaged }),
    ).resolves.toEqual({ toolNames: ["read", "write"] });
    await setActiveToolsOperation({
      sessionId: "sess-1",
      toolNames: ["bash"],
      getActiveManaged,
    });
    await expect(getQueueOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual({
      steering: ["s"],
      followUp: ["f"],
    });
    await expect(clearQueueOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual({
      steering: [],
      followUp: [],
    });

    expect(client.setAutoRetry).toHaveBeenCalledWith(true);
    expect(client.abortRetry).toHaveBeenCalledTimes(1);
    expect(client.setPermissionMode).toHaveBeenCalledWith("default");
    expect(client.setActiveTools).toHaveBeenCalledWith(["bash"]);
  });

  it("mirrors setPermissionMode results into managed session info for delegate inheritance", async () => {
    const client = {
      setPermissionMode: vi.fn().mockResolvedValue({ mode: "yolo" }),
    };
    const managed = makeManaged(client, { permissionMode: "normal" });

    await expect(
      setPermissionModeOperation({
        sessionId: "parent-session",
        mode: "yolo",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn().mockResolvedValue(managed),
      }),
    ).resolves.toEqual({ mode: "yolo" });

    expect(managed.info.permissionMode).toBe("yolo");
  });

  it("returns empty or client-not-found fallbacks when no active client exists", async () => {
    const getActiveManaged = () => null;

    await expect(getActiveToolsOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual(
      { toolNames: [] },
    );
    await expect(getQueueOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual({
      steering: [],
      followUp: [],
    });
    await expect(getMcpServersOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual(
      { servers: [] },
    );
    await expect(
      toggleMcpServerOperation({
        sessionId: "sess-1",
        name: "fs",
        enabled: true,
        getActiveManaged,
      }),
    ).resolves.toEqual({ success: false, error: "Client not found" });
  });

  it("returns mcp action errors instead of throwing", async () => {
    const client = {
      getMcpServers: vi.fn().mockResolvedValue([{ name: "fs", enabled: true }]),
      toggleMcpServer: vi.fn().mockRejectedValue(new Error("toggle failed")),
      restartMcpServer: vi.fn().mockResolvedValue(undefined),
    };
    const managed = makeManaged(client);
    const getActiveManaged = () => managed;

    await expect(getMcpServersOperation({ sessionId: "sess-1", getActiveManaged })).resolves.toEqual({
      servers: [{ name: "fs", enabled: true }],
    });
    await expect(
      toggleMcpServerOperation({
        sessionId: "sess-1",
        name: "fs",
        enabled: false,
        getActiveManaged,
      }),
    ).resolves.toEqual({ success: false, error: "toggle failed" });
    await expect(
      restartMcpServerOperation({ sessionId: "sess-1", name: "fs", getActiveManaged }),
    ).resolves.toEqual({ success: true });
  });

  it("cleans up dead clients when context usage fails and ping fails", async () => {
    const client = {
      getContextUsage: vi.fn().mockRejectedValue(new Error("socket closed")),
    };
    const managed = makeManaged(client);
    const cleanupDeadClient = vi.fn();

    await expect(
      getContextUsageOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn().mockResolvedValue(false),
        cleanupDeadClient,
      }),
    ).resolves.toEqual({ tokens: null, contextWindow: 0, percent: null });

    expect(cleanupDeadClient).toHaveBeenCalledWith(
      "sess-1",
      "getContextUsage failed: socket closed",
    );
  });

  it("does not cleanup when context usage query times out", async () => {
    const client = {
      getContextUsage: vi
        .fn()
        .mockRejectedValue(new Error("Timeout waiting for response to get_context_usage")),
    };
    const managed = makeManaged(client);
    const cleanupDeadClient = vi.fn();
    const isClientAlive = vi.fn().mockResolvedValue(true);

    await expect(
      getContextUsageOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive,
        cleanupDeadClient,
      }),
    ).resolves.toEqual({ tokens: null, contextWindow: 0, percent: null });

    expect(isClientAlive).toHaveBeenCalledWith("sess-1", managed);
    expect(cleanupDeadClient).not.toHaveBeenCalled();
  });
});
