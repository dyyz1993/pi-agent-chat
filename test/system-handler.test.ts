import { describe, it, expect, beforeEach, vi } from "vitest";

import { register } from "../src/shared/handlers/system";

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

describe("system handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {
      platform: "desktop",
    } as Parameters<typeof register>[1]);
  });

  describe("system.ping", () => {
    it("returns pong with platform info", async () => {
      const handler = server.handlers.get("system.ping")!;
      const result = await handler({});

      expect(result).toEqual({
        pong: true,
        timestamp: expect.any(Number),
        platform: "desktop",
      });
    });

    it("returns current timestamp", async () => {
      const handler = server.handlers.get("system.ping")!;
      const before = Date.now();
      const result = (await handler({})) as { timestamp: number };
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("system.hello", () => {
    it("greets with provided name", async () => {
      const handler = server.handlers.get("system.hello")!;
      const result = await handler({ name: "Alice" });

      expect(result).toEqual({
        message: "Hello Alice!",
        timestamp: expect.any(Number),
      });
    });

    it("greets with World when no name", async () => {
      const handler = server.handlers.get("system.hello")!;
      const result = await handler({});

      expect(result).toEqual({
        message: "Hello World!",
        timestamp: expect.any(Number),
      });
    });
  });

  describe("system.echo", () => {
    it("echoes back the params", async () => {
      const handler = server.handlers.get("system.echo")!;
      const params = { foo: "bar", count: 42 };
      const result = await handler(params);

      expect(result).toEqual(params);
    });

    it("echoes back empty object", async () => {
      const handler = server.handlers.get("system.echo")!;
      const result = await handler({});

      expect(result).toEqual({});
    });
  });
});
