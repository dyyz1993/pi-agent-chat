/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { resolveBrowserWebSocketUrl } from "../../../src/mainview/lib/api-client";

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

  it("still points loopback dev pages at the local backend port", () => {
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
    ).toBe("ws://localhost:3100/ws?token=tok");
  });

  it("keeps LAN dev pages paired with the same LAN host backend port", () => {
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
    ).toBe("ws://192.168.0.29:3100/ws?token=tok");
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
