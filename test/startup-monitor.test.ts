import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStartupPerfEvents,
  createStartupTrace,
  getStartupPerfEvents,
} from "../src/mainview/lib/startup-monitor";

describe("startup-monitor", () => {
  beforeEach(() => {
    clearStartupPerfEvents();
  });

  it("records begin, mark, and done events for a startup trace", () => {
    const trace = createStartupTrace("app.restore", { source: "test" });
    trace.mark("restore-tabs.done", { tabCount: 2 });
    trace.done("active-session.selected", { sessionId: "sess_1" });

    const events = getStartupPerfEvents();
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.kind)).toEqual(["mark", "mark", "done"]);
    expect(events.map((event) => event.phase)).toEqual([
      "begin",
      "restore-tabs.done",
      "active-session.selected",
    ]);
    expect(events[0].details).toEqual({ source: "test" });
    expect(events[2].details).toEqual({ sessionId: "sess_1" });
  });

  it("records errors without throwing", () => {
    const trace = createStartupTrace("connection.initialize");
    trace.error("api-client.initialize.failed", new Error("ws timeout"), { attempt: 1 });

    const events = getStartupPerfEvents();
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      phase: "api-client.initialize.failed",
      details: { attempt: 1, error: "ws timeout" },
    });
  });
});
