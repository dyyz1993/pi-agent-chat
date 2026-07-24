import { describe, expect, it, vi } from "vitest";

vi.unmock("../../../src/mainview/lib/api-client");

import {
  isPrivateOrLoopbackHost,
  resolveDevApiTarget,
  resolveDevWebSocketTarget,
} from "../../../src/mainview/lib/api-client";

describe("api-client dev websocket target", () => {
  it("should classify loopback and private hosts separately from public hosts", () => {
    expect(isPrivateOrLoopbackHost("localhost")).toBe(true);
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("192.168.1.10")).toBe(true);
    expect(isPrivateOrLoopbackHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.31.0.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.32.0.5")).toBe(false);
    expect(isPrivateOrLoopbackHost("preview.example.test")).toBe(false);
  });

  it("should rewrite loopback API targets to the LAN page host during dev", () => {
    const target = resolveDevApiTarget({
      dev: true,
      configuredTarget: "http://localhost:3102",
      pageHostname: "192.168.1.23",
    });

    expect(target?.toString()).toBe("http://192.168.1.23:3102/");
  });

  it("should skip direct dev API targets for public page hosts", () => {
    expect(
      resolveDevApiTarget({
        dev: true,
        configuredTarget: "http://localhost:3102",
        pageHostname: "preview.example.test",
      }),
    ).toBeNull();

    expect(
      resolveDevWebSocketTarget({
        dev: true,
        configuredTarget: "http://localhost:3102",
        pageHostname: "preview.example.test",
        token: "secret",
      }),
    ).toBeNull();
  });

  it("should preserve direct dev websocket targets for loopback pages", () => {
    expect(
      resolveDevWebSocketTarget({
        dev: true,
        configuredTarget: "http://localhost:3102",
        pageHostname: "localhost",
        token: "secret",
      }),
    ).toBe("ws://localhost:3102/ws?token=secret");
  });
});
