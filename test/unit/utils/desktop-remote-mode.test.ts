import { describe, it, expect, beforeEach } from "vitest";
import { isDesktopRemoteMode, normalizeRemoteWsUrl } from "../../../src/mainview/lib/api-client";

describe("normalizeRemoteWsUrl", () => {
  it("appends /ws when the path is missing", () => {
    expect(normalizeRemoteWsUrl("ws://192.168.1.10:3100")).toBe("ws://192.168.1.10:3100/ws");
  });

  it("appends /ws when only a root path is given", () => {
    expect(normalizeRemoteWsUrl("ws://192.168.1.10:3100/")).toBe("ws://192.168.1.10:3100/ws");
  });

  it("keeps an explicit path and query intact", () => {
    expect(normalizeRemoteWsUrl("ws://host:3100/ws?token=abc")).toBe(
      "ws://host:3100/ws?token=abc",
    );
  });

  it("accepts wss", () => {
    expect(normalizeRemoteWsUrl("wss://agent.example.com")).toBe("wss://agent.example.com/ws");
  });

  it("rejects non-ws schemes and garbage", () => {
    expect(normalizeRemoteWsUrl("http://192.168.1.10:3100")).toBeNull();
    expect(normalizeRemoteWsUrl("https://example.com")).toBeNull();
    expect(normalizeRemoteWsUrl("not a url")).toBeNull();
    expect(normalizeRemoteWsUrl("")).toBeNull();
    expect(normalizeRemoteWsUrl("   ")).toBeNull();
  });
});

describe("isDesktopRemoteMode", () => {
  const bridge = window as unknown as { __electrobunBunBridge?: unknown };

  beforeEach(() => {
    delete bridge.__electrobunBunBridge;
    localStorage.removeItem("rpc-websocket-url");
  });

  it("is false outside the desktop shell", () => {
    localStorage.setItem("rpc-websocket-url", "ws://192.168.1.10:3100/ws");
    expect(isDesktopRemoteMode()).toBe(false);
  });

  it("is false in the desktop shell without a configured url", () => {
    bridge.__electrobunBunBridge = { postMessage: () => {} };
    expect(isDesktopRemoteMode()).toBe(false);
  });

  it("is true in the desktop shell when a remote url is configured", () => {
    bridge.__electrobunBunBridge = { postMessage: () => {} };
    localStorage.setItem("rpc-websocket-url", "ws://192.168.1.10:3100/ws");
    expect(isDesktopRemoteMode()).toBe(true);
  });
});
