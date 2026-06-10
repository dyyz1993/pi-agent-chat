import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GatewayEvent, NotificationChannel } from "../../../src/mainview/lib/notification-gateway";

describe("NotificationGateway", () => {
  let gateway: typeof import("../../../src/mainview/lib/notification-gateway").notificationGateway;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../../src/mainview/lib/notification-gateway");
    gateway = mod.notificationGateway;
  });

  function makeEvent(overrides: Partial<GatewayEvent> = {}): GatewayEvent {
    return {
      type: "session_complete",
      title: "Test",
      body: "Test body",
      level: "info",
      ...overrides,
    };
  }

  it("emit sends event to all registered channels", () => {
    const sent: GatewayEvent[] = [];
    const channel: NotificationChannel = {
      name: "ch1",
      send: (e) => sent.push(e),
    };
    gateway.registerChannel(channel);
    const event = makeEvent();
    gateway.emit(event);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(event);
  });

  it("emit sends to multiple channels", () => {
    const sent1: GatewayEvent[] = [];
    const sent2: GatewayEvent[] = [];
    gateway.registerChannel({ name: "ch1", send: (e) => sent1.push(e) });
    gateway.registerChannel({ name: "ch2", send: (e) => sent2.push(e) });
    gateway.emit(makeEvent());
    expect(sent1).toHaveLength(1);
    expect(sent2).toHaveLength(1);
  });

  it("removeChannel stops delivering to removed channel", () => {
    const sent: GatewayEvent[] = [];
    const channel: NotificationChannel = {
      name: "removable",
      send: (e) => sent.push(e),
    };
    gateway.registerChannel(channel);
    gateway.emit(makeEvent());
    expect(sent).toHaveLength(1);
    gateway.removeChannel("removable");
    gateway.emit(makeEvent());
    expect(sent).toHaveLength(1);
  });

  it("emit with no channels does not throw", () => {
    expect(() => gateway.emit(makeEvent())).not.toThrow();
  });

  it("onVisibilityChange returns unsubscribe function", () => {
    const fn = vi.fn();
    const unsub = gateway.onVisibilityChange(fn);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("appVisible returns a boolean", () => {
    expect(typeof gateway.appVisible).toBe("boolean");
  });

  it("channels are isolated between gateway instances (fresh import)", () => {
    const sent: GatewayEvent[] = [];
    gateway.registerChannel({ name: "iso", send: (e) => sent.push(e) });
    gateway.emit(makeEvent({ title: "T1" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("T1");
  });

  it("removeChannel with nonexistent name does not throw", () => {
    expect(() => gateway.removeChannel("nonexistent")).not.toThrow();
  });
});
