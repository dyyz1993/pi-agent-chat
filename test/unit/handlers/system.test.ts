import { describe, it, expect, beforeEach, vi } from "vitest";

import { register } from "../../../src/shared/handlers/system";
import {
  setReadClipboardImageFn,
  setReadClipboardTextFn,
  setWriteClipboardTextFn,
} from "../../../src/shared/lib/native-clipboard";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("system handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    setWriteClipboardTextFn(() => undefined);
    setReadClipboardTextFn(() => null);
    setReadClipboardImageFn(() => null);
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

  describe("system.writeClipboard", () => {
    it("writes text through the desktop native clipboard hook", async () => {
      const write = vi.fn();
      setWriteClipboardTextFn(write);
      const handler = server.handlers.get("system.writeClipboard")!;

      const result = await handler({ text: "copied from desktop" });

      expect(result).toEqual({ ok: true });
      expect(write).toHaveBeenCalledWith("copied from desktop");
    });

    it("returns false when called outside desktop", async () => {
      const webServer = createMockServer();
      register(webServer as unknown as Parameters<typeof register>[0], {
        platform: "web",
      } as Parameters<typeof register>[1]);
      const handler = webServer.handlers.get("system.writeClipboard")!;

      await expect(handler({ text: "web" })).resolves.toEqual({ ok: false });
    });
  });

  describe("system.readClipboard", () => {
    it("reads text through the desktop native clipboard hook", async () => {
      setReadClipboardTextFn(() => "from native clipboard");
      const handler = server.handlers.get("system.readClipboard")!;

      const result = await handler({});

      expect(result).toEqual({ text: "from native clipboard" });
    });

    it("returns null when called outside desktop", async () => {
      const webServer = createMockServer();
      register(webServer as unknown as Parameters<typeof register>[0], {
        platform: "web",
      } as Parameters<typeof register>[1]);
      const handler = webServer.handlers.get("system.readClipboard")!;

      await expect(handler({})).resolves.toEqual({ text: null });
    });
  });

  describe("system.readClipboardImage", () => {
    it("reads png base64 through the desktop native clipboard hook", async () => {
      setReadClipboardImageFn(() => "iVBORw0KGgo=");
      const handler = server.handlers.get("system.readClipboardImage")!;

      const result = await handler({});

      expect(result).toEqual({ pngBase64: "iVBORw0KGgo=" });
    });

    it("returns null when called outside desktop", async () => {
      const webServer = createMockServer();
      register(webServer as unknown as Parameters<typeof register>[0], {
        platform: "web",
      } as Parameters<typeof register>[1]);
      const handler = webServer.handlers.get("system.readClipboardImage")!;

      await expect(handler({})).resolves.toEqual({ pngBase64: null });
    });
  });
});
