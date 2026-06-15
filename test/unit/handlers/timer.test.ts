import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { register } from "../../../src/shared/handlers/timer";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("timer handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts timer and emits tick events", async () => {
    const start = server.handlers.get("timer.start")!;
    const result = await start({});

    expect(result).toEqual({ started: true });

    vi.advanceTimersByTime(1000);
    expect(server.emitEvent).toHaveBeenCalledTimes(1);
    expect(server.emitEvent).toHaveBeenCalledWith("timer.tick", {
      count: 1,
      timestamp: expect.any(Number),
    });

    vi.advanceTimersByTime(1000);
    expect(server.emitEvent).toHaveBeenCalledTimes(2);
  });

  it("returns alreadyRunning when started twice", async () => {
    const start = server.handlers.get("timer.start")!;
    await start({});
    const result = await start({});

    expect(result).toEqual({ alreadyRunning: true });
  });

  it("stops the timer", async () => {
    const start = server.handlers.get("timer.start")!;
    const stop = server.handlers.get("timer.stop")!;

    await start({});
    vi.advanceTimersByTime(1000);
    expect(server.emitEvent).toHaveBeenCalledTimes(1);

    await stop({});
    vi.advanceTimersByTime(3000);
    expect(server.emitEvent).toHaveBeenCalledTimes(1);
  });

  it("can restart after stop", async () => {
    const start = server.handlers.get("timer.start")!;
    const stop = server.handlers.get("timer.stop")!;

    await start({});
    await stop({});
    const result = await start({});

    expect(result).toEqual({ started: true });

    vi.advanceTimersByTime(1000);
    expect(server.emitEvent).toHaveBeenCalledWith("timer.tick", {
      count: 1,
      timestamp: expect.any(Number),
    });
  });

  it("stop is idempotent when no timer running", async () => {
    const stop = server.handlers.get("timer.stop")!;
    const result = await stop({});

    expect(result).toEqual({ stopped: true });
  });
});
