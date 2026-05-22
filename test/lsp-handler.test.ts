import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetCachedLspState = vi.fn();
const mockHasSession = vi.fn();
const mockCallChannel = vi.fn();

vi.mock("../src/shared/handlers/agent", () => ({
  getProcessManager: vi.fn(() => ({
    getCachedLspState: mockGetCachedLspState,
    hasSession: mockHasSession,
    callChannel: mockCallChannel,
  })),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readFile: vi.fn() };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { register } from "../src/shared/handlers/lsp";

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
  };
}

type MockServer = ReturnType<typeof createMockServer>;

describe("lsp handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    mockGetCachedLspState.mockReturnValue(null);
    mockHasSession.mockReturnValue(false);
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
  });

  describe("lsp.status", () => {
    it("returns cached LSP state when available", async () => {
      mockGetCachedLspState.mockReturnValue({
        state: "ready",
        mode: "edit_write",
        servers: [
          {
            name: "typescript-language-server",
            fileTypes: [".ts", ".tsx"],
            state: "ready",
            reason: "",
          },
        ],
      });

      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({
        sessionPath: "/session",
        sessionId: "sess-1",
      })) as Record<string, unknown>;

      expect(result.state).toBe("ready");
      expect(result.mode).toBe("edit_write");
      const servers = result.servers as Array<Record<string, unknown>>;
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("typescript-language-server");
    });

    it("queries process manager when session exists but no cache", async () => {
      mockGetCachedLspState.mockReturnValue(null);
      mockHasSession.mockReturnValue(true);
      mockCallChannel.mockResolvedValue({
        state: "starting",
        servers: [{ name: "gopls", state: "starting", reason: "initializing" }],
        mode: "agent_end",
      });

      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({
        sessionPath: "/session",
        sessionId: "sess-1",
      })) as Record<string, unknown>;

      expect(result.state).toBe("starting");
      expect(result.mode).toBe("agent_end");
      expect(mockCallChannel).toHaveBeenCalledWith("sess-1", "lsp", "getStatus", {});
    });

    it("returns inactive when sessionPath does not exist and no sessionId", async () => {
      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({ sessionPath: "/nonexistent" })) as Record<string, unknown>;

      expect(result.state).toBe("inactive");
      expect(result.servers).toEqual([]);
      expect(result.mode).toBe("agent_end");
    });

    it("returns inactive when process manager call throws", async () => {
      mockHasSession.mockReturnValue(true);
      mockCallChannel.mockRejectedValue(new Error("channel not ready"));

      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({
        sessionPath: "/nonexistent",
        sessionId: "sess-1",
      })) as Record<string, unknown>;

      expect(result.state).toBe("inactive");
    });

    it("extracts server status from nested status object", async () => {
      mockGetCachedLspState.mockReturnValue({
        state: "ready",
        mode: "agent_end",
        servers: [
          {
            name: "ts-ls",
            fileTypes: [".ts"],
            status: {
              state: "ready",
              reason: "",
              transport: "stdio",
              activeCommand: ["node", "server.js"],
              configuredCommand: ["typescript-language-server"],
            },
          },
        ],
      });

      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({
        sessionPath: "/session",
        sessionId: "sess-1",
      })) as Record<string, unknown>;

      const servers = result.servers as Array<Record<string, unknown>>;
      expect(servers[0].state).toBe("ready");
      expect(servers[0].transport).toBe("stdio");
      expect(servers[0].activeCommand).toEqual(["node", "server.js"]);
    });

    it("normalizes server with serverId fallback", async () => {
      mockHasSession.mockReturnValue(true);
      mockCallChannel.mockResolvedValue({
        state: "ready",
        servers: [{ name: "pylsp", state: "ready" }],
        mode: "disabled",
      });

      const handler = server.handlers.get("lsp.status")!;
      const result = (await handler({
        sessionPath: "/session",
        sessionId: "sess-1",
      })) as Record<string, unknown>;

      const servers = result.servers as Array<Record<string, unknown>>;
      expect(servers[0].name).toBe("pylsp");
    });
  });

  describe("lsp.setMode", () => {
    it("calls process manager channel with mode", async () => {
      mockCallChannel.mockResolvedValue({ ok: true, mode: "edit_write" });

      const handler = server.handlers.get("lsp.setMode")!;
      const result = (await handler({
        sessionId: "sess-1",
        mode: "edit_write",
      })) as Record<string, unknown>;

      expect(mockCallChannel).toHaveBeenCalledWith("sess-1", "lsp", "lsp.setMode", {
        mode: "edit_write",
      });
      expect(result).toEqual({ ok: true, mode: "edit_write" });
    });

    it("throws when process manager is not available", async () => {
      const { getProcessManager } = await import("../src/shared/handlers/agent");
      (getProcessManager as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const handler = server.handlers.get("lsp.setMode")!;
      await expect(handler({ sessionId: "sess-1", mode: "disabled" })).rejects.toThrow(
        "No process manager available",
      );
    });
  });
});
