import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCallChannel = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/handlers/agent", () => ({
  getProcessManager: vi.fn(() => ({
    callChannel: mockCallChannel,
  })),
}));

import { register } from "../src/shared/handlers/bash";

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
    subscriptions: new Map(),
    emitEvent: vi.fn(),
  };
}

type MockServer = ReturnType<typeof createMockServer>;

describe("bash.command kill idempotent logic", () => {
  let server: MockServer;
  let bashCommand: (params: unknown) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
    bashCommand = server.handlers.get("bash.command")!;
  });

  it("should forward first kill call to process manager", async () => {
    const result = await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-1",
    });

    expect(result).toEqual({ ok: true });
    expect(mockCallChannel).toHaveBeenCalledTimes(1);
    expect(mockCallChannel).toHaveBeenCalledWith("sess-1", "bash", "kill", {
      toolCallId: "tool-1",
      data: undefined,
    });
  });

  it("should forward second kill call for same toolCallId (no dedup)", async () => {
    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-1",
    });

    const result = await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-1",
    });

    expect(result).toEqual({ ok: true });
    expect(mockCallChannel).toHaveBeenCalledTimes(2);
  });

  it("should forward kill for a different toolCallId", async () => {
    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-1",
    });

    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-2",
    });

    expect(mockCallChannel).toHaveBeenCalledTimes(2);
    expect(mockCallChannel).toHaveBeenNthCalledWith(1, "sess-1", "bash", "kill", {
      toolCallId: "tool-1",
      data: undefined,
    });
    expect(mockCallChannel).toHaveBeenNthCalledWith(2, "sess-1", "bash", "kill", {
      toolCallId: "tool-2",
      data: undefined,
    });
  });

  it("should deduplicate kill across different sessions independently", async () => {
    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
      toolCallId: "tool-1",
    });

    await bashCommand({
      sessionId: "sess-2",
      action: "kill",
      toolCallId: "tool-1",
    });

    expect(mockCallChannel).toHaveBeenCalledTimes(2);
  });

  it("should not deduplicate non-kill actions", async () => {
    await bashCommand({
      sessionId: "sess-1",
      action: "background",
      toolCallId: "tool-1",
    });

    await bashCommand({
      sessionId: "sess-1",
      action: "background",
      toolCallId: "tool-1",
    });

    expect(mockCallChannel).toHaveBeenCalledTimes(2);
  });

  it("should not deduplicate kill without toolCallId", async () => {
    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
    });

    await bashCommand({
      sessionId: "sess-1",
      action: "kill",
    });

    expect(mockCallChannel).toHaveBeenCalledTimes(2);
  });
});
