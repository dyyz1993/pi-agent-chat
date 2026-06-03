import { describe, it, expect, beforeEach, vi } from "vitest";

const mockOpenFolder = vi.fn<(opts: { startingFolder?: string }) => Promise<string[]>>();

vi.mock("../src/shared/lib/native-dialog", () => ({
  openFolder: mockOpenFolder,
}));

import { register } from "../src/shared/handlers/project";
import type { HandlerOptions } from "../src/shared/rpc-schema";

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
  };
}

describe("project.browseFolder", () => {
  let server: ReturnType<typeof createMockServer>;
  let browseFolder: (params: unknown) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenFolder.mockReset();
  });

  function setup(platform: "desktop" | "web") {
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], { platform } as HandlerOptions);
    browseFolder = server.handlers.get("project.browseFolder")!;
  }

  it("desktop mode: should return selected folder path", async () => {
    mockOpenFolder.mockResolvedValue(["/Users/test/my-project"]);
    setup("desktop");

    const result = await browseFolder({ defaultPath: "/Users/test" });

    expect(result).toEqual({ path: "/Users/test/my-project" });
    expect(mockOpenFolder).toHaveBeenCalledWith({ startingFolder: "/Users/test" });
  });

  it("desktop mode: should return cancelled when user cancels dialog", async () => {
    mockOpenFolder.mockResolvedValue([]);
    setup("desktop");

    const result = await browseFolder({ defaultPath: "/Users/test" });

    expect(result).toEqual({ cancelled: true });
  });

  it("desktop mode: should work without defaultPath", async () => {
    mockOpenFolder.mockResolvedValue(["/some/folder"]);
    setup("desktop");

    const result = await browseFolder({});

    expect(result).toEqual({ path: "/some/folder" });
    expect(mockOpenFolder).toHaveBeenCalledWith({ startingFolder: undefined });
  });

  it("desktop mode: should return cancelled on openFolder error", async () => {
    mockOpenFolder.mockRejectedValue(new Error("native dialog crashed"));
    setup("desktop");

    const result = await browseFolder({});

    expect(result).toEqual({ cancelled: true });
  });

  it("web mode: should always return cancelled", async () => {
    setup("web");

    const result = await browseFolder({ defaultPath: "/Users/test" });

    expect(result).toEqual({ cancelled: true });
    expect(mockOpenFolder).not.toHaveBeenCalled();
  });
});
