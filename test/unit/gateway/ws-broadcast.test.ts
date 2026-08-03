import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { safeWsSend } from "../../../src/gateway/ws-broadcast";

describe("safeWsSend", () => {
  it("sends the message when ws.send succeeds", () => {
    const send = vi.fn();
    const ws = { send } as unknown as Parameters<typeof safeWsSend>[0];

    safeWsSend(ws, "hello");

    expect(send).toHaveBeenCalledWith("hello");
  });

  it("does not throw when ws.send throws", () => {
    const send = vi.fn(() => {
      throw new Error("ws closed");
    });
    const ws = { send } as unknown as Parameters<typeof safeWsSend>[0];

    expect(() => safeWsSend(ws, "hello")).not.toThrow();
  });

  it("does not throw when ws.send rejects a promise", async () => {
    const send = vi.fn(() => Promise.reject(new Error("async ws failure")));
    const ws = { send } as unknown as Parameters<typeof safeWsSend>[0];

    await expect(Promise.resolve(safeWsSend(ws, "hello"))).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith("hello");
  });
});
