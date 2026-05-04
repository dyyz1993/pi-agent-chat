import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetProcessManager } = vi.hoisted(() => ({
  mockGetProcessManager: vi.fn(() => null),
}));

vi.mock("../src/shared/handlers/agent", () => ({
  getProcessManager: mockGetProcessManager,
}));

import { register } from "../src/shared/handlers/rules";

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

describe("rules handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
  });

  describe("rules.list", () => {
    it("returns empty rules", async () => {
      const handler = server.handlers.get("rules.list")!;
      const result = await handler({});

      expect(result).toEqual({ rules: [], totalRules: 0 });
    });
  });

  describe("rules.requestSnapshot", () => {
    it("returns empty snapshot when no processManager", async () => {
      mockGetProcessManager.mockReturnValue(null);
      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({ sessionId: "s1" });

      expect(result).toEqual({
        type: "snapshot",
        rules: [],
        injectedRuleNames: [],
        totalRules: 0,
        unconditionalCount: 0,
        conditionalCount: 0,
        matchHistory: [],
        lifecycleLog: [],
        loadedAt: expect.any(Number),
        cacheTTL: 30000,
      });
    });

    it("returns empty snapshot when no sessionId", async () => {
      const pm = { hasSession: vi.fn(), getProjectPath: vi.fn(), callChannel: vi.fn() };
      mockGetProcessManager.mockReturnValue(pm);

      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({});

      expect(result).toEqual(
        expect.objectContaining({ type: "snapshot", totalRules: 0 }),
      );
    });

    it("returns empty snapshot when session not found", async () => {
      const pm = { hasSession: vi.fn(() => false), getProjectPath: vi.fn(), callChannel: vi.fn() };
      mockGetProcessManager.mockReturnValue(pm);

      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({ sessionId: "ghost" });

      expect(result).toEqual(
        expect.objectContaining({ type: "snapshot", totalRules: 0 }),
      );
    });

    it("returns snapshot from channel call", async () => {
      const snapshot = {
        type: "snapshot",
        rules: [{ name: "rule1" }],
        injectedRuleNames: [],
        totalRules: 1,
        unconditionalCount: 1,
        conditionalCount: 0,
        matchHistory: [],
        lifecycleLog: [],
        loadedAt: Date.now(),
        cacheTTL: 30000,
      };
      const pm = {
        hasSession: vi.fn(() => true),
        getProjectPath: vi.fn(() => "/project"),
        callChannel: vi.fn(async () => snapshot),
      };
      mockGetProcessManager.mockReturnValue(pm);

      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({ sessionId: "s1" });

      expect(result).toEqual(snapshot);
      expect(pm.callChannel).toHaveBeenCalledWith("s1", "rules-engine", "getSnapshot", { cwd: "/project" });
    });

    it("returns empty snapshot when channel call fails", async () => {
      const pm = {
        hasSession: vi.fn(() => true),
        getProjectPath: vi.fn(() => "/project"),
        callChannel: vi.fn(async () => {
          throw new Error("channel error");
        }),
      };
      mockGetProcessManager.mockReturnValue(pm);

      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({ sessionId: "s1" });

      expect(result).toEqual(
        expect.objectContaining({ type: "snapshot", totalRules: 0 }),
      );
    });

    it("returns empty snapshot when channel returns non-snapshot", async () => {
      const pm = {
        hasSession: vi.fn(() => true),
        getProjectPath: vi.fn(() => "/project"),
        callChannel: vi.fn(async () => ({ type: "other" })),
      };
      mockGetProcessManager.mockReturnValue(pm);

      const handler = server.handlers.get("rules.requestSnapshot")!;
      const result = await handler({ sessionId: "s1" });

      expect(result).toEqual(
        expect.objectContaining({ type: "snapshot", totalRules: 0 }),
      );
    });
  });
});
