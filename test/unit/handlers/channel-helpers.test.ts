/**
 * Unit tests for `forwardToChannel` in channel-helpers.ts.
 *
 * `forwardToChannel` is the shared utility used by many RPC handlers to delegate
 * a request to a CLI extension channel via the process manager. It must:
 *   - Return `null` when there is no manager or no sessionId (never throw).
 *   - Return `null` when the session is unknown (unless `skipHasSessionCheck`).
 *   - Return the channel result on success.
 *   - Swallow channel errors / timeouts and return `null`.
 *   - Forward the exact (sid, channelName, methodName, payload) tuple.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks --------------------------------------------------------------

// We mock the agent module so `getProcessManager` returns a controllable value.
vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: vi.fn(),
}));

// Mock withTimeout so we don't depend on real timers; it just awaits the
// passed promise and lets rejection propagate (mimicking real behaviour).
vi.mock("../../../src/shared/lib/with-timeout", () => ({
  withTimeout: (promise: Promise<unknown>) => promise,
}));

import { forwardToChannel } from "../../../src/shared/handlers/channel-helpers";
import { getProcessManager } from "../../../src/shared/handlers/agent";

// Build a minimal mock manager used across tests.
function createMockManager() {
  return {
    hasSession: vi.fn(),
    callChannel: vi.fn(),
  };
}

type MockManager = ReturnType<typeof createMockManager>;

const mockedGetProcessManager = getProcessManager as unknown as ReturnType<typeof vi.fn>;

describe("forwardToChannel", () => {
  let manager: MockManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createMockManager();
  });

  // --- Early-return paths -----------------------------------------------

  it("returns null when process manager is null", async () => {
    mockedGetProcessManager.mockReturnValue(null);
    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
    // No manager → hasSession / callChannel must never be touched.
    expect(manager.hasSession).not.toHaveBeenCalled();
    expect(manager.callChannel).not.toHaveBeenCalled();
  });

  it("returns null when sessionId is undefined", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);

    const result = await forwardToChannel(
      { sessionId: undefined },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
    // sessionId is checked before hasSession, so neither should be called.
    expect(manager.hasSession).not.toHaveBeenCalled();
    expect(manager.callChannel).not.toHaveBeenCalled();
  });

  it("returns null when sessionId is an empty string", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);

    const result = await forwardToChannel({ sessionId: "" }, "hooks", "list", {});
    expect(result).toBeNull();
    expect(manager.hasSession).not.toHaveBeenCalled();
    expect(manager.callChannel).not.toHaveBeenCalled();
  });

  it("returns null when manager.hasSession returns false", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(false);

    const result = await forwardToChannel(
      { sessionId: "unknown-session" },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
    expect(manager.hasSession).toHaveBeenCalledWith("unknown-session");
    expect(manager.callChannel).not.toHaveBeenCalled();
  });

  // --- Happy path --------------------------------------------------------

  it("returns callChannel result when session exists", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    const channelResult = { items: ["a", "b"], count: 2 };
    manager.callChannel.mockResolvedValue(channelResult);

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      { scope: "project" },
    );
    expect(result).toEqual(channelResult);
  });

  it("forwards correct (sid, channelName, methodName, payload) to callChannel", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockResolvedValue({ ok: true });

    await forwardToChannel(
      { sessionId: "sess-77" },
      "rules-engine",
      "evaluate",
      { ruleId: "r-1", dry: true },
    );

    expect(manager.callChannel).toHaveBeenCalledTimes(1);
    expect(manager.callChannel).toHaveBeenCalledWith(
      "sess-77",
      "rules-engine",
      "evaluate",
      { ruleId: "r-1", dry: true },
    );
  });

  it("respects custom timeoutMs argument (does not throw with default mocked withTimeout)", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockResolvedValue("done");

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
      5_000,
    );
    expect(result).toBe("done");
  });

  // --- Error swallowing -------------------------------------------------

  it("returns null when callChannel rejects", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockRejectedValue(new Error("channel boom"));

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when callChannel rejects with a non-Error value", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockRejectedValue("string error");

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
  });

  // --- skipHasSessionCheck option --------------------------------------

  it("skips hasSession check when skipHasSessionCheck is true", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    // Even if hasSession would return false, the call should proceed.
    manager.hasSession.mockReturnValue(false);
    manager.callChannel.mockResolvedValue({ skipped: true });

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "supervisor",
      "getStatus",
      {},
      1_000,
      { skipHasSessionCheck: true },
    );
    expect(result).toEqual({ skipped: true });
    expect(manager.hasSession).not.toHaveBeenCalled();
    expect(manager.callChannel).toHaveBeenCalledWith(
      "sess-1",
      "supervisor",
      "getStatus",
      {},
    );
  });

  it("still skips hasSession check even when manager would report false", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(false);
    manager.callChannel.mockResolvedValue(42);

    const result = await forwardToChannel<{ sessionId?: string }, number>(
      { sessionId: "sess-9" },
      "supervisor",
      "getStatus",
      {},
      1_000,
      { skipHasSessionCheck: true },
    );
    expect(result).toBe(42);
  });

  // --- Default option behaviour ----------------------------------------

  it("performs hasSession check by default (options omitted)", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(false);

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
    expect(manager.hasSession).toHaveBeenCalledWith("sess-1");
  });

  it("performs hasSession check when options is an empty object", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockResolvedValue("ok");

    const result = await forwardToChannel(
      { sessionId: "sess-1" },
      "hooks",
      "list",
      {},
      1_000,
      {},
    );
    expect(result).toBe("ok");
    expect(manager.hasSession).toHaveBeenCalledWith("sess-1");
  });

  // --- Edge: params object shape ---------------------------------------

  it("reads sessionId from a params object with extra fields", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);
    manager.callChannel.mockResolvedValue({ ok: true });

    await forwardToChannel(
      { sessionId: "sess-x", extra: "ignored", n: 3 } as unknown as {
        sessionId?: string;
      },
      "hooks",
      "list",
      {},
    );

    expect(manager.callChannel).toHaveBeenCalledWith(
      "sess-x",
      "hooks",
      "list",
      {},
    );
  });

  it("returns null when params has no sessionId key at all", async () => {
    mockedGetProcessManager.mockReturnValue(manager);
    manager.hasSession.mockReturnValue(true);

    const result = await forwardToChannel(
      { other: "value" } as unknown as { sessionId?: string },
      "hooks",
      "list",
      {},
    );
    expect(result).toBeNull();
    expect(manager.callChannel).not.toHaveBeenCalled();
  });
});
