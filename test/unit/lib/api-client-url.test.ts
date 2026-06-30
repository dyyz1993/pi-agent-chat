/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

const { resolveBrowserWebSocketUrl } = await vi.importActual<
  typeof import("../../../src/mainview/lib/api-client")
>("../../../src/mainview/lib/api-client");

describe("resolveBrowserWebSocketUrl", () => {
  it("keeps public reverse-proxy pages on the same origin instead of leaking to :3100", () => {
    expect(
      resolveBrowserWebSocketUrl({
        token: "tok",
        protocol: "https:",
        hostname: "chat.example.com",
        host: "chat.example.com",
        port: "",
        isDev: true,
        viteApiTarget: "http://localhost:3100",
      }),
    ).toBe("wss://chat.example.com/ws?token=tok");
  });

  it("keeps loopback Vite dev pages on the same origin so Vite proxies /ws", () => {
    expect(
      resolveBrowserWebSocketUrl({
        token: "tok",
        protocol: "http:",
        hostname: "localhost",
        host: "localhost:5173",
        port: "5173",
        isDev: true,
        viteApiTarget: "http://localhost:3100",
      }),
    ).toBe("ws://localhost:5173/ws?token=tok");
  });

  it("keeps LAN Vite dev pages on the same origin so reverse proxies do not need :3100", () => {
    expect(
      resolveBrowserWebSocketUrl({
        token: "tok",
        protocol: "http:",
        hostname: "192.168.0.29",
        host: "192.168.0.29:5173",
        port: "5173",
        isDev: true,
        viteApiTarget: "http://localhost:3100",
      }),
    ).toBe("ws://192.168.0.29:5173/ws?token=tok");
  });

  it("honors explicit non-loopback API targets", () => {
    expect(
      resolveBrowserWebSocketUrl({
        token: "tok",
        protocol: "https:",
        hostname: "chat.example.com",
        host: "chat.example.com",
        port: "",
        isDev: true,
        viteApiTarget: "https://api.example.com",
      }),
    ).toBe("wss://api.example.com/ws?token=tok");
  });
});
